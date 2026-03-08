// SPDX-License-Identifier: Apache-2.0
/**
 * Cron Worker v6: Thin orchestrator.
 *
 * HN crawling logic lives in src/lib/hn-bot.ts.
 * This file handles:
 * - Cron scheduling (scheduled handler)
 * - HTTP endpoints: /trigger, /calibrate, /calibrate/check, /recalc, /health
 * - Coverage-driven crawl integration
 * - Event pruning
 */

import {
  extractDomain,
  getEnabledModelsFromDb,
  type EvalScore,
} from '../src/lib/shared-eval';
import { logEvent, pruneEvents } from '../src/lib/events';
import { CALIBRATION_SET, LITE_CALIBRATION_SET, LITE_DRIFT_THRESHOLDS, runCalibrationCheck } from '../src/lib/calibration';
import { shouldAutoDisableFromCalibration, raterHealthKvKey, emptyRaterHealth, type RaterHealthState } from '../src/lib/rater-health';
import { getPipelineHealth, computeModelComparisonBlob, MODEL_COMPARISON_KV_KEY, MODEL_COMPARISON_TTL, computeHomepageBlob, HOMEPAGE_BLOB_KEY, HOMEPAGE_BLOB_TTL } from '../src/lib/db';
import { safeBatch, writeDb } from '../src/lib/db-utils';
import { runScheduledCoverageStrategy } from '../src/lib/coverage-crawl';
import {
  computeAggregates,
  computeDerivedScoreFields,
  computeStoryLevelAggregates,
  computeFairWitnessAggregates,
  type DcpElement,
} from '../src/lib/compute-aggregates';
import { runCrawlCycle, dispatchFreeModelEvals, dispatchFrontPageFreeEvals, preloadContentCache } from '../src/lib/hn-bot';
import { refreshDomainAggregate } from '../src/lib/eval-write';
import { getModelQueue, PRIMARY_MODEL_ID } from '../src/lib/shared-eval';
import {
  sweepFailed, sweepSkipped, sweepCoverage, sweepContentDrift,
  sweepAlgoliaBackfill, sweepRefreshDomainAggregates, sweepBackfillPtScore, sweepSetlSpikes,
  sweepRefreshUserAggregates, sweepExpandFromSubmitted, sweepRefreshArticlePairStats,
  sweepLiteReeval, sweepRefreshConsensusScores, sweepUpgradeLite,
  sweepBrowserAudit,
  sweepKagiScoreAudit, sweepKagiUrlCheck, sweepKagiDomainEnrich, sweepKagiCalibrationOracle,
  sweepBackfillCountry,
  sweepBackfillRs,
  sweepBackfillAc,
  sweepBackfillCar,
  sweepTestRetest,
  type SweepContext,
} from './sweeps';

export interface Env {
  DB: D1Database;
  EVAL_QUEUE: Queue;
  DEEPSEEK_QUEUE: Queue;
  TRINITY_QUEUE: Queue;
  NEMOTRON_QUEUE: Queue;
  STEP_QUEUE: Queue;
  QWEN_QUEUE: Queue;
  LLAMA_QUEUE: Queue;
  MISTRAL_QUEUE: Queue;
  HERMES_QUEUE: Queue;
  GPT_OSS_QUEUE: Queue;
  GEMMA_QUEUE: Queue;
  QWEN_CODER_QUEUE: Queue;
  WORKERS_AI_QUEUE?: Queue;
  BROWSER_AUDIT_QUEUE?: Queue;
  CONTENT_CACHE: KVNamespace;
  CONTENT_SNAPSHOTS?: R2Bucket;
  CRON_SECRET?: string;
  DAILY_EVAL_BUDGET?: string;
  KAGI_API_KEY?: string;
  AP_PUBLISH_TOKEN?: string;
}

// --- Main cron handler ---

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = writeDb(env.DB);
    const minute = new Date(event.scheduledTime).getMinutes();

    // ─── Pre-compute model comparison blob (lock-free, safe to overlap) ───
    // This runs outside the cron lock because it's read-only + KV write.
    // Heavy multi-model queries run here (30s CPU budget) so the Pages
    // function (10ms CPU limit) can read a single KV blob.
    if (minute % 10 === 5) {
      try {
        const blob = await computeModelComparisonBlob(db);
        await env.CONTENT_CACHE.put(
          MODEL_COMPARISON_KV_KEY,
          JSON.stringify(blob),
          { expirationTtl: MODEL_COMPARISON_TTL }
        );
        console.log(`[cron] Model comparison blob computed: ${blob.totalStories} stories, ${blob.modelIds.length} models`);
      } catch (err) {
        console.error('[cron] Model comparison blob failed (non-fatal):', err);
      }
    }

    // ─── Pre-compute homepage data blob (lock-free, read-only + KV write) ───
    if (minute % 5 === 0) {
      try {
        const blob = await computeHomepageBlob(db);
        await env.CONTENT_CACHE.put(HOMEPAGE_BLOB_KEY, JSON.stringify(blob), { expirationTtl: HOMEPAGE_BLOB_TTL });
        console.log(`[cron] Homepage blob computed: ${blob.statusCounts.done} evaluated, ${blob.topDomains.length} domains`);
      } catch (err) {
        console.error('[cron] Homepage blob failed (non-fatal):', err);
      }
    }

    // ─── Distributed lock (prevent overlapping cron cycles) ───
    const lockKey = 'cron:lock';
    try {
      const existing = await env.CONTENT_CACHE.get(lockKey);
      if (existing) {
        console.warn('[cron] Lock held, skipping cycle');
        return;
      }
      await env.CONTENT_CACHE.put(lockKey, new Date().toISOString(), { expirationTtl: 120 });
    } catch (err) {
      console.warn('[cron] KV lock check failed (non-fatal):', err);
    }

    try {
    // ─── Front-page free model dispatch (every minute) ───

    try {
      const fpResults = await dispatchFrontPageFreeEvals(db, env as unknown as Record<string, any>, 20);
      const fpTotal = fpResults.reduce((sum, r) => sum + r.dispatched, 0);
      if (fpTotal > 0) {
        console.log(`[fp-free] Dispatched ${fpTotal} evals across ${fpResults.filter(r => r.dispatched > 0).length} models`);
      }
    } catch (err) {
      console.error('[fp-free] Front-page dispatch failed (non-fatal):', err);
    }

    // ─── HN crawl cycle (fetch, diff, insert, refresh, comments, users, re-eval, enqueue) ───

    let crawlResult: Awaited<ReturnType<typeof runCrawlCycle>>;
    try {
      crawlResult = await runCrawlCycle(db, env.EVAL_QUEUE, env.CONTENT_CACHE, minute, env.WORKERS_AI_QUEUE, env as unknown as Record<string, any>);
    } catch (err) {
      console.error('[cron] Crawl cycle failed (non-fatal):', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'error', message: `Crawl cycle failed`, details: { phase: 'crawl', error: String(err) } }).catch(() => {});
      crawlResult = { stories_new: 0, stories_found: 0, feeds: {}, score_refresh: { updates: 0, sweep: 0 } };
    }

    // ─── Pre-warm content cache for pending stories ───

    try {
      const preloaded = await preloadContentCache(db, env.CONTENT_CACHE, 20);
      if (preloaded > 0) console.log(`[cron] pre-cached ${preloaded} story URLs`);
    } catch (err) {
      console.error('[cron] Content cache preload failed (non-fatal):', err);
    }

    // ─── Multi-model dispatch (every 5 minutes) ───

    if (minute % 5 === 0) {
      try {
        const multiModelResults = await dispatchFreeModelEvals(db, env as unknown as Record<string, any>, 50);
        const totalDispatched = multiModelResults.reduce((sum, r) => sum + r.dispatched, 0);
        if (totalDispatched > 0) {
          console.log(`[multi-model] Dispatched ${totalDispatched} total evals across ${multiModelResults.length} models`);
        }
      } catch (err) {
        console.error('Multi-model dispatch failed (non-fatal):', err);
        await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Multi-model dispatch failed`, details: { phase: 'multi_model', error: String(err) } });
      }
    }

    // ─── Coverage-driven crawl strategies ───

    try {
      const coverageResult = await runScheduledCoverageStrategy(minute, db);
      if (coverageResult && coverageResult.inserted > 0) {
        console.log(`[coverage] ${coverageResult.strategy}: inserted ${coverageResult.inserted} stories`);
        await logEvent(db, {
          event_type: 'coverage_crawl',
          severity: 'info',
          message: `Coverage crawl: ${coverageResult.strategy} inserted ${coverageResult.inserted} stories`,
          details: coverageResult,
        });
      }
    } catch (err) {
      console.error('Coverage crawl failed (non-fatal):', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Coverage crawl failed`, details: { phase: 'coverage_crawl', error: String(err) } });
    }

    // ─── Phase 31A: Auto-retry failed stories (every 10 min) ───

    if (minute % 10 === 0) {
      try {
        const { meta: retryMeta } = await db
          .prepare(
            `UPDATE stories SET eval_status = 'pending', eval_error = NULL
             WHERE eval_status = 'failed'
               AND hn_score >= 50
               AND created_at > datetime('now', '-7 days')
               AND eval_error NOT LIKE '%binary%'
               AND eval_error NOT LIKE '%Content gate%'
               AND eval_error NOT LIKE '%no readable%'
             LIMIT 20`
          )
          .run();
        const retried = retryMeta?.changes ?? 0;
        if (retried > 0) {
          console.log(`[auto-retry] Reset ${retried} failed stories to pending`);
          await logEvent(db, {
            event_type: 'auto_retry',
            severity: 'info',
            message: `Auto-retry: reset ${retried} failed stories to pending`,
            details: { retried },
          });
        }
      } catch (err) {
        console.error('[auto-retry] Failed (non-fatal):', err);
      }
    }

    // ─── Phase 31B: DLQ auto-replay (every hour) ───

    if (minute === 0) {
      try {
        const { results: dlqRows } = await db
          .prepare(
            `SELECT id, hn_id, url, title, domain, eval_model, eval_provider
             FROM dlq_messages
             WHERE status = 'pending'
               AND manual_review_required = 0
               AND auto_replay_at IS NOT NULL
               AND auto_replay_at <= datetime('now')
             LIMIT 20`
          )
          .all<{ id: number; hn_id: number; url: string | null; title: string; domain: string | null; eval_model: string | null; eval_provider: string | null }>();

        for (const row of dlqRows) {
          try {
            const targetQueue = getModelQueue(row.eval_model || PRIMARY_MODEL_ID, env as unknown as Record<string, any>);
            if (!targetQueue) {
              await db.prepare(`UPDATE dlq_messages SET manual_review_required = 1 WHERE id = ?`).bind(row.id).run();
              continue;
            }
            await targetQueue.send({
              hn_id: row.hn_id,
              url: row.url,
              title: row.title,
              hn_text: null,
              domain: row.domain,
              eval_model: row.eval_model || undefined,
              eval_provider: row.eval_provider || undefined,
            });
            await db
              .prepare(`UPDATE dlq_messages SET status = 'replayed', resolved_at = datetime('now') WHERE id = ?`)
              .bind(row.id)
              .run();
            await logEvent(db, {
              hn_id: row.hn_id,
              event_type: 'dlq_auto_replay',
              severity: 'info',
              message: `DLQ auto-replay: message ${row.id} re-enqueued`,
              details: { dlq_id: row.id, eval_model: row.eval_model },
            });
          } catch (err) {
            console.error(`[dlq-auto-replay] Failed for dlq_id=${row.id}:`, err);
          }
        }
      } catch (err) {
        console.error('[dlq-auto-replay] Failed (non-fatal):', err);
      }
    }

    // ─── Phase 31C: Auto-calibrate weekly (Sunday 03:00 UTC) ───

    const now = new Date();
    if (now.getUTCDay() === 0 && now.getUTCHours() === 3 && minute === 0) {
      try {
        const lastCal = await db
          .prepare(`SELECT MAX(created_at) as last FROM calibration_runs`)
          .first<{ last: string | null }>();
        const lastMs = lastCal?.last ? new Date(lastCal.last).getTime() : 0;
        const sixDaysMs = 6 * 24 * 60 * 60 * 1000;

        if (Date.now() - lastMs >= sixDaysMs) {
          // Cleanup stale calibration data
          const calIds = Array.from({ length: 15 }, (_, i) => -(1000 + i + 1));
          const placeholders = calIds.map(() => '?').join(',');
          await db.batch([
            db.prepare(`DELETE FROM eval_history WHERE hn_id IN (${placeholders})`).bind(...calIds),
            db.prepare(`DELETE FROM rater_witness WHERE hn_id IN (${placeholders})`).bind(...calIds),
            db.prepare(`DELETE FROM rater_evals WHERE hn_id IN (${placeholders})`).bind(...calIds),
            db.prepare(`DELETE FROM calibration_runs WHERE created_at < datetime('now', '-30 days')`),
          ]);

          // Re-enqueue calibration set
          const enabledModels = await getEnabledModelsFromDb(db);
          for (let i = 0; i < 15; i++) {
            const syntheticId = -(1000 + i + 1);
            await env.EVAL_QUEUE.send({
              hn_id: syntheticId, url: null, title: `[AUTO-CAL] ${syntheticId}`, hn_text: null, domain: null,
            } as any).catch(() => {});
          }

          await logEvent(db, {
            event_type: 'auto_calibration',
            severity: 'info',
            message: `Auto-calibration triggered (weekly Sunday 03:00 UTC)`,
            details: { models: enabledModels.map(m => m.id) },
          });
        }
      } catch (err) {
        console.error('[auto-calibration] Failed (non-fatal):', err);
      }
    }

    // ─── DCP staleness alerting (hourly) ───

    if (minute === 0) {
      try {
        const { results: staleDomains } = await db
          .prepare(
            `SELECT d.domain
             FROM domain_dcp d
             JOIN stories s ON s.domain = d.domain
             WHERE s.eval_status = 'done'
             GROUP BY d.domain
             HAVING COUNT(s.hn_id) > 20
               AND MAX(d.cached_at) < datetime('now', '-30 days')`
          )
          .all<{ domain: string }>();

        for (const { domain } of staleDomains) {
          // Only log if no dcp_stale event in last 24h for this domain
          const existing = await db
            .prepare(
              `SELECT 1 FROM events
               WHERE event_type = 'dcp_stale'
                 AND json_extract(details, '$.domain') = ?
                 AND created_at >= datetime('now', '-1 day')
               LIMIT 1`
            )
            .bind(domain)
            .first();
          if (!existing) {
            await logEvent(db, {
              event_type: 'dcp_stale',
              severity: 'warn',
              message: `DCP stale >30 days for domain ${domain} (>20 done stories)`,
              details: { domain },
            });
          }
        }
      } catch (err) {
        console.error('[dcp-stale] Failed (non-fatal):', err);
      }
    }

    // ─── R2 snapshot retention cleanup (weekly, guarded by KV flag) ───

    if (minute === 0 && env.CONTENT_SNAPSHOTS) {
      try {
        const r2CleanupKey = 'r2:cleanup:last_run';
        const lastRun = await env.CONTENT_CACHE.get(r2CleanupKey);
        if (!lastRun) {
          // Set 7-day flag immediately (prevents repeat runs even if cleanup fails)
          await env.CONTENT_CACHE.put(r2CleanupKey, new Date().toISOString(), { expirationTtl: 7 * 24 * 3600 });

          const cutoffDate = new Date(Date.now() - 90 * 24 * 3600 * 1000);
          const cutoffStr = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD

          let deleted = 0;
          let cursor: string | undefined;
          const maxDelete = 200;

          while (deleted < maxDelete) {
            const list = await env.CONTENT_SNAPSHOTS.list({ cursor, limit: 100 });
            const toDelete: string[] = [];

            for (const obj of list.objects) {
              // Key format: {hn_id}/{YYYY-MM-DD}.txt
              const match = obj.key.match(/^-?\d+\/(\d{4}-\d{2}-\d{2})\.txt$/);
              if (match && match[1] < cutoffStr) {
                // Check if story is done in DB
                const hnId = parseInt(obj.key.split('/')[0], 10);
                const storyRow = await db
                  .prepare(`SELECT 1 FROM stories WHERE hn_id = ? AND eval_status = 'done' LIMIT 1`)
                  .bind(hnId)
                  .first();
                if (storyRow) toDelete.push(obj.key);
              }
              if (deleted + toDelete.length >= maxDelete) break;
            }

            for (const key of toDelete) {
              await env.CONTENT_SNAPSHOTS.delete(key);
              deleted++;
            }

            if (list.truncated && deleted < maxDelete) {
              cursor = list.cursor;
            } else {
              break;
            }
          }

          if (deleted > 0) {
            await logEvent(db, {
              event_type: 'r2_cleanup',
              severity: 'info',
              message: `R2 cleanup: deleted ${deleted} snapshots older than 90 days`,
              details: { deleted, cutoff: cutoffStr },
            });
            console.log(`[r2-cleanup] Deleted ${deleted} old snapshots`);
          }
        }
      } catch (err) {
        console.error('[r2-cleanup] Failed (non-fatal):', err);
      }
    }

    // ─── Phase 37B: Daily model trust scores (once per hour) ───

    if (minute === 0) {
      try {
        const today = new Date().toISOString().slice(0, 10);

        // Get all models that have had any eval activity in last 7 days
        const { results: activeModels } = await db
          .prepare(
            `SELECT eval_model,
                    COUNT(*) as total,
                    COUNT(CASE WHEN eval_status = 'done' THEN 1 END) as done_count
             FROM rater_evals
             WHERE evaluated_at >= datetime('now', '-7 days')
             GROUP BY eval_model`
          )
          .all<{ eval_model: string; total: number; done_count: number }>();

        for (const modelRow of activeModels) {
          const modelId = modelRow.eval_model;
          const parseSuccessRate = modelRow.total > 0 ? modelRow.done_count / modelRow.total : null;
          const evalCount = modelRow.done_count;

          // Calibration accuracy: latest calibration_run for this model
          const calRun = await db
            .prepare(
              `SELECT passed, total_urls FROM calibration_runs
               WHERE model = ? AND status IN ('pass', 'fail')
               ORDER BY created_at DESC LIMIT 1`
            )
            .bind(modelId)
            .first<{ passed: number; total_urls: number }>();
          const calibrationAccuracy = calRun && calRun.total_urls > 0
            ? calRun.passed / calRun.total_urls
            : null;

          // Consensus agreement: avg(1 - |model_score - consensus_score| / 2) for recent done evals
          const consensusRow = await db
            .prepare(
              `SELECT AVG(1.0 - MIN(ABS(re.hcb_weighted_mean - s.consensus_score) / 2.0, 1.0)) as avg_agreement
               FROM rater_evals re
               JOIN stories s ON s.hn_id = re.hn_id
               WHERE re.eval_model = ?
                 AND re.eval_status = 'done'
                 AND re.hcb_weighted_mean IS NOT NULL
                 AND s.consensus_score IS NOT NULL
                 AND s.consensus_model_count >= 2
                 AND re.evaluated_at >= datetime('now', '-7 days')`
            )
            .bind(modelId)
            .first<{ avg_agreement: number | null }>();
          const consensusAgreement = consensusRow?.avg_agreement ?? null;

          // Composite trust score
          let trustScore: number | null = null;
          const parts: number[] = [];
          const weights: number[] = [];
          if (calibrationAccuracy !== null) { parts.push(calibrationAccuracy * 0.40); weights.push(0.40); }
          if (consensusAgreement !== null)   { parts.push(consensusAgreement * 0.35);  weights.push(0.35); }
          if (parseSuccessRate !== null)     { parts.push(parseSuccessRate * 0.25);    weights.push(0.25); }
          if (weights.length > 0) {
            const totalWeight = weights.reduce((s, w) => s + w, 0);
            trustScore = parts.reduce((s, p) => s + p, 0) / totalWeight;
          }

          await db
            .prepare(
              `INSERT INTO model_trust_snapshots
                 (model_id, day, calibration_accuracy, consensus_agreement, parse_success_rate, trust_score, eval_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(model_id, day) DO UPDATE SET
                 calibration_accuracy = excluded.calibration_accuracy,
                 consensus_agreement  = excluded.consensus_agreement,
                 parse_success_rate   = excluded.parse_success_rate,
                 trust_score          = excluded.trust_score,
                 eval_count           = excluded.eval_count`
            )
            .bind(modelId, today, calibrationAccuracy, consensusAgreement, parseSuccessRate, trustScore, evalCount)
            .run();
        }

        // Flag models with trust < 0.3 for 7 consecutive days
        const { results: lowTrustModels } = await db
          .prepare(
            `SELECT model_id, COUNT(*) as bad_days
             FROM model_trust_snapshots
             WHERE trust_score < 0.3
               AND day >= date('now', '-7 days')
             GROUP BY model_id
             HAVING bad_days >= 7`
          )
          .all<{ model_id: string; bad_days: number }>();

        for (const { model_id, bad_days } of lowTrustModels) {
          await logEvent(db, {
            event_type: 'rater_auto_disable',
            severity: 'warn',
            message: `Model ${model_id} trust score <0.3 for ${bad_days} consecutive days — review recommended`,
            details: { model: model_id, bad_days, source: 'trust_index' },
          });
        }
      } catch (err) {
        console.error('[trust-index] Failed (non-fatal):', err);
      }
    }

    // ─── Daily domain profile snapshots (once per day, KV-guarded) ───

    if (minute === 5) {
      try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const snapKey = `snapshot:domain:${today}`;
        const alreadyRan = await env.CONTENT_CACHE.get(snapKey);
        if (!alreadyRan) {
          await env.CONTENT_CACHE.put(snapKey, '1', { expirationTtl: 25 * 3600 }); // 25h: covers DST edge

          await db
            .prepare(
              `INSERT OR IGNORE INTO domain_profile_snapshots
                 (domain, snapshot_date, story_count, evaluated_count,
                  avg_hrcb, avg_setl, avg_editorial, avg_structural,
                  avg_eq, avg_so, avg_td, avg_valence, avg_arousal, dominant_tone,
                  avg_confidence, avg_sr, avg_pt_count, avg_pt_score,
                  avg_dominance, avg_fw_ratio,
                  dominant_scope, dominant_reading_level, dominant_sentiment)
               SELECT domain, ?, story_count, evaluated_count,
                      avg_hrcb, avg_setl, avg_editorial, avg_structural,
                      avg_eq, avg_so, avg_td, avg_valence, avg_arousal, dominant_tone,
                      avg_confidence, avg_sr, avg_pt_count, avg_pt_score,
                      avg_dominance, avg_fw_ratio,
                      dominant_scope, dominant_reading_level, dominant_sentiment
               FROM domain_aggregates
               WHERE evaluated_count >= 1`
            )
            .bind(today)
            .run();

          console.log(`[domain-snapshot] Inserted domain profile snapshots for ${today}`);
        }
      } catch (err) {
        console.error('[domain-snapshot] Failed (non-fatal):', err);
      }
    }

    // ─── Event pruning (90-day retention, once per hour) ───

    // ─── Stale domain aggregate self-heal (every 30 minutes) ───
    // Refreshes domains not updated in 6+ hours — catches aggregates made stale by migrations
    // or other direct DB writes that don't go through the normal eval write path.

    if (minute % 30 === 0) {
      try {
        const staleKey = 'cron:stale_domain_refresh:running';
        const isRunning = await env.CONTENT_CACHE.get(staleKey);
        if (!isRunning) {
          await env.CONTENT_CACHE.put(staleKey, '1', { expirationTtl: 600 });
          const { results: staleDomains } = await db
            .prepare(
              `SELECT domain FROM domain_aggregates
               WHERE last_updated_at < datetime('now', '-6 hours')
                 AND evaluated_count >= 1
               ORDER BY last_updated_at ASC
               LIMIT 50`,
            )
            .all<{ domain: string }>();
          for (const { domain } of staleDomains) {
            await refreshDomainAggregate(db, domain);
          }
          if (staleDomains.length > 0) {
            console.log(`[cron] Refreshed ${staleDomains.length} stale domain aggregates`);
          }
          env.CONTENT_CACHE.delete(staleKey).catch(() => {});
        }
      } catch (err) {
        console.error('[cron] Stale domain refresh failed (non-fatal):', err);
      }
    }

    // ─── Browser audit dispatch (every 6 hours) ───

    if (minute === 0 && new Date().getUTCHours() % 6 === 0 && env.BROWSER_AUDIT_QUEUE) {
      try {
        const staleRows = await db
          .prepare(
            `SELECT DISTINCT s.domain FROM stories s
             LEFT JOIN domain_browser_audit ba ON ba.domain = s.domain
             WHERE s.domain IS NOT NULL
               AND s.eval_status = 'done'
               AND (ba.domain IS NULL OR ba.audited_at < datetime('now', '-7 days'))
             ORDER BY RANDOM()
             LIMIT 20`
          )
          .all<{ domain: string }>();
        const domains = staleRows.results.map(r => r.domain);
        for (const domain of domains) {
          await env.BROWSER_AUDIT_QUEUE.send({ domain });
        }
        if (domains.length > 0) {
          console.log(`[cron] Browser audit dispatched: ${domains.length} domains`);
        }
      } catch (err) {
        console.error('[cron] Browser audit dispatch failed (non-fatal):', err);
      }
    }

    if (minute === 0) {
      const pruned = await pruneEvents(db, 90);
      if (pruned > 0) console.log(`[events] Pruned ${pruned} events older than 90 days`);
    }

    // ─── WebSub hub ping (notify subscribers of feed updates) ───

    if (crawlResult.stories_new > 0) {
      try {
        const feedUrl = 'https://observatory.unratified.org/feed.xml';
        const hubUrl = 'https://hub.superfeedr.com/';
        const resp = await fetch(hubUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `hub.mode=publish&hub.url=${encodeURIComponent(feedUrl)}`,
        });
        if (resp.ok) {
          console.log(`[websub] Hub pinged (${crawlResult.stories_new} new stories)`);
        } else {
          console.warn(`[websub] Hub ping returned ${resp.status}`);
        }
      } catch (err) {
        console.warn('[websub] Hub ping failed (non-fatal):', err);
      }
    }

    // ─── ActivityPub publish (post newly evaluated stories to Fediverse) ───

    // AP publish runs every cron cycle — KV dedup prevents duplicate posts.
    // (minute%N slotting doesn't work: cron lock causes unpredictable minute selection)
    if (env.AP_PUBLISH_TOKEN) {
      const AP_BURST_LIMIT = 3;   // max posts per 5-min cycle — prevents Fediverse flooding
      const AP_RECENCY_DAYS = 7;  // only publish stories evaluated in last 7 days
      const AP_DEDUP_TTL = 30 * 24 * 3600; // 30-day KV dedup TTL
      try {
        // Composite "worth sharing" filter: RS gate + quality composite + engagement
        // Candidates are all qualifying unpublished stories (not just last 6 min)
        const candidates = await db.prepare(
          `SELECT hn_id, title, url, COALESCE(hcb_weighted_mean, hcb_editorial_mean) as score,
                  hcb_classification, eval_model, rs_score, eq_score, so_score, hn_score
           FROM stories
           WHERE eval_status = 'done' AND hn_id > 0
             AND evaluated_at > datetime('now', '-${AP_RECENCY_DAYS} days')
             AND COALESCE(rs_score, 0) >= 0.10
             AND (COALESCE(rs_score, 0) * 0.5 + COALESCE(eq_score, 0) * 0.3 + COALESCE(so_score, 0) * 0.2) >= 0.45
             AND COALESCE(hn_score, 0) >= 20
           ORDER BY evaluated_at DESC LIMIT 20`
        ).all<{ hn_id: number; title: string; url: string | null; score: number | null; hcb_classification: string | null; eval_model: string | null; rs_score: number | null; eq_score: number | null; so_score: number | null; hn_score: number | null }>();

        // KV dedup: skip already-published stories
        let published = 0;
        let skippedDedup = 0;
        for (const story of candidates.results) {
          if (published >= AP_BURST_LIMIT) break;

          const dedupKey = `ap:pub:${story.hn_id}`;
          const already = await env.CONTENT_CACHE.get(dedupKey);
          if (already) { skippedDedup++; continue; }

          const score = story.score != null ? (story.score > 0 ? '+' : '') + story.score.toFixed(2) : '?';
          const classification = story.hcb_classification ?? 'pending';
          const rs = story.rs_score != null ? story.rs_score.toFixed(2) : '?';
          const eq = story.eq_score != null ? story.eq_score.toFixed(2) : '?';
          const so = story.so_score != null ? story.so_score.toFixed(2) : '?';
          const storyUrl = `https://observatory.unratified.org/item/${story.hn_id}`;
          const summary = `HRCB ${score} (${classification}) · RS ${rs} · EQ ${eq} · SO ${so} — ${story.title}`;

          const resp = await fetch('https://unratified.org/ap/publish', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.AP_PUBLISH_TOKEN}`,
            },
            body: JSON.stringify({
              actor: 'observatory',
              post: {
                id: `observatory-eval-${story.hn_id}`,
                title: story.title,
                summary,
                url: storyUrl,
                published: new Date().toISOString(),
                tags: ['hrcb', 'humanrights', 'udhr', classification].filter(Boolean),
              },
            }),
          });

          if (resp.ok) {
            published++;
            await env.CONTENT_CACHE.put(dedupKey, new Date().toISOString(), { expirationTtl: AP_DEDUP_TTL });
            await logEvent(db, { event_type: 'ap_publish', severity: 'info', message: `Published to Fediverse: ${story.title}`, hn_id: story.hn_id, details: { score, rs, classification } }).catch(() => {});
          } else {
            const body = await resp.text().catch(() => '');
            console.warn(`[ap] Publish failed for ${story.hn_id}: ${resp.status} ${body}`);
            await logEvent(db, { event_type: 'ap_publish', severity: 'warn', message: `AP publish failed: ${resp.status}`, hn_id: story.hn_id, details: { status: resp.status, body: body.slice(0, 200) } }).catch(() => {});
          }
        }

        if (candidates.results.length > 0 || published > 0) {
          console.log(`[ap] AP check: ${candidates.results.length} qualifying, ${skippedDedup} already published, ${published} new`);
        }
      } catch (err) {
        console.warn('[ap] ActivityPub publish failed (non-fatal):', err);
        await logEvent(db, { event_type: 'ap_publish', severity: 'error', message: `AP publish error: ${String(err)}`, details: { error: String(err) } }).catch(() => {});
      }
    }

    // ─── Log cron run event ───

    await logEvent(db, {
      event_type: 'cron_run',
      severity: 'info',
      message: `Cron: ${crawlResult.stories_new} new, ${crawlResult.stories_found} unique stories`,
      details: {
        ...crawlResult,
      },
    });

    console.log('Cron cycle complete');

    } catch (err) {
      console.error('[cron] Scheduled handler error:', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'error', message: `Scheduled handler failed: ${String(err).slice(0, 500)}`, details: { error: String(err) } }).catch(() => {});
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth check helper
    const checkAuth = (): Response | null => {
      if (env.CRON_SECRET) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.CRON_SECRET}`) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
      }
      return null;
    };

    if (path === '/trigger') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const sweep = url.searchParams.get('sweep');

      // No sweep param → full cron cycle
      if (!sweep) {
        ctx.waitUntil(
          this.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' } as ScheduledEvent, env, ctx)
        );
        return new Response('Cron triggered', { status: 200 });
      }

      const SWEEP_HANDLERS: Record<string, (ctx: SweepContext) => Promise<Response>> = {
        failed: sweepFailed,
        skipped: sweepSkipped,
        coverage: sweepCoverage,
        content_drift: sweepContentDrift,
        algolia_backfill: sweepAlgoliaBackfill,
        refresh_domain_aggregates: sweepRefreshDomainAggregates,
        backfill_pt_score: sweepBackfillPtScore,
        setl_spikes: sweepSetlSpikes,
        refresh_user_aggregates: sweepRefreshUserAggregates,
        expand_from_submitted: sweepExpandFromSubmitted,
        refresh_article_pair_stats: sweepRefreshArticlePairStats,
        lite_reeval: sweepLiteReeval,
        refresh_consensus_scores: sweepRefreshConsensusScores,
        upgrade_lite: sweepUpgradeLite,
        browser_audit: sweepBrowserAudit,
        kagi_score_audit: sweepKagiScoreAudit,
        kagi_url_check: sweepKagiUrlCheck,
        kagi_domain_enrich: sweepKagiDomainEnrich,
        kagi_calibration_oracle: sweepKagiCalibrationOracle,
        backfill_country: sweepBackfillCountry,
        backfill_rs: sweepBackfillRs,
        backfill_ac: sweepBackfillAc,
        backfill_car: sweepBackfillCar,
        test_retest: sweepTestRetest,
      };

      const handler = SWEEP_HANDLERS[sweep];
      if (!handler) {
        return new Response(JSON.stringify({
          error: `Unknown sweep type: ${sweep}`,
          valid_types: Object.keys(SWEEP_HANDLERS),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return handler({ db: writeDb(env.DB), env, ctx, url });
    }

    // POST /calibrate — enqueue 15 calibration URLs for evaluation (all enabled models)
    // POST /calibrate?mode=lite — insert lite calibration URLs as pending for standalone evaluator
    if (path === '/calibrate' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = writeDb(env.DB);
      const mode = url.searchParams.get('mode');

      // Lite mode: insert LITE_CALIBRATION_SET stories as pending (hn_ids -2001 to -2015).
      // Evaluation is done by the local evaluate-standalone.mjs script, not Cloudflare queues.
      if (mode === 'lite' || mode === 'light') {
        // Generate a calibration_run ID (unix timestamp) — stored in KV so ingest.ts can tag rows in calibration_evals
        const calibrationRun = Math.floor(Date.now() / 1000);
        try {
          await env.CONTENT_CACHE.put('calibration:lite:current_run', String(calibrationRun), { expirationTtl: 30 * 24 * 60 * 60 });
        } catch { /* non-fatal */ }

        // Clean up previous lite calibration rater_evals so the queue filter doesn't skip them
        const liteCalIds = LITE_CALIBRATION_SET.map((_, i) => -(2000 + i + 1));
        const litePlaceholders = liteCalIds.map(() => '?').join(',');
        try {
          await db.batch([
            db.prepare(`DELETE FROM rater_evals WHERE hn_id IN (${litePlaceholders}) AND prompt_mode IN ('light', 'lite')`).bind(...liteCalIds),
            db.prepare(`DELETE FROM calibration_runs WHERE model IN ('light-1.3', 'light-1.4', 'lite-1.4') AND created_at < datetime('now', '-30 days')`),
          ]);
        } catch (err) {
          console.warn('[calibrate] Lite cleanup failed (non-fatal):', err);
        }
        for (let i = 0; i < LITE_CALIBRATION_SET.length; i++) {
          const cal = LITE_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const domain = extractDomain(cal.url);
          await db
            .prepare(
              `INSERT INTO stories (hn_id, title, url, domain, hn_score, hn_comments, hn_time, hn_type, eval_status)
               VALUES (?, ?, ?, ?, 0, 0, ?, 'calibration', 'pending')
               ON CONFLICT(hn_id) DO UPDATE SET url = excluded.url, domain = excluded.domain, title = excluded.title, eval_status = 'pending', evaluated_at = NULL`,
            )
            .bind(syntheticId, `[CAL-LITE] ${cal.label} (${cal.slot})`, cal.url, domain, Math.floor(Date.now() / 1000))
            .run();
        }
        await logEvent(db, {
          event_type: 'calibration',
          severity: 'info',
          message: `Lite calibration queued: ${LITE_CALIBRATION_SET.length} URLs inserted as pending`,
          details: { mode: 'lite', calibration_ids: LITE_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)) },
        });
        return new Response(JSON.stringify({
          mode: 'lite',
          calibration_run: calibrationRun,
          queued: LITE_CALIBRATION_SET.length,
          calibration_ids: LITE_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)),
          note: 'Stories inserted as pending. Run: node scripts/evaluate-standalone.mjs --mode lite',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Clean up stale calibration data before re-enqueue
      try {
        const calIds = CALIBRATION_SET.map((_, i) => -(1000 + i + 1));
        const placeholders = calIds.map(() => '?').join(',');
        await db.batch([
          db.prepare(`DELETE FROM eval_history WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM rater_witness WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM rater_evals WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM calibration_runs WHERE created_at < datetime('now', '-30 days')`),
        ]);
      } catch (err) {
        console.warn('[calibrate] Cleanup failed (non-fatal):', err);
      }

      let enqueued = 0;
      const enabledModels = await getEnabledModelsFromDb(db);

      for (let i = 0; i < CALIBRATION_SET.length; i++) {
        const cal = CALIBRATION_SET[i];
        const syntheticId = -(1000 + i + 1);
        const domain = extractDomain(cal.url);

        await db
          .prepare(
            `INSERT INTO stories (hn_id, title, url, domain, hn_score, hn_comments, hn_time, hn_type, eval_status)
             VALUES (?, ?, ?, ?, 0, 0, ?, 'calibration', 'pending')
             ON CONFLICT(hn_id) DO UPDATE SET eval_status = 'pending', evaluated_at = NULL`,
          )
          .bind(syntheticId, `[CAL] ${cal.label} (${cal.slot})`, cal.url, domain, Math.floor(Date.now() / 1000))
          .run();

        // Primary model (no eval_model field = default)
        await env.EVAL_QUEUE.send({
          hn_id: syntheticId,
          url: cal.url,
          title: `[CAL] ${cal.label} (${cal.slot})`,
          hn_text: null,
          domain,
        });
        enqueued++;

        // Non-primary enabled models — route to per-model queues
        for (const model of enabledModels) {
          if (model.id === PRIMARY_MODEL_ID) continue; // primary already sent
          const modelQueue = getModelQueue(model.id, env as unknown as Record<string, any>);
          await modelQueue.send({
            hn_id: syntheticId,
            url: cal.url,
            title: `[CAL] ${cal.label} (${cal.slot})`,
            hn_text: null,
            domain,
            eval_model: model.id,
            eval_provider: model.provider,
            prompt_mode: model.prompt_mode,
          });

          // UPSERT rater_evals as queued (include prompt_mode so shell row is accurate)
          await db
            .prepare(
              `INSERT INTO rater_evals (hn_id, eval_model, eval_provider, eval_status, prompt_mode)
               VALUES (?, ?, ?, 'queued', ?)
               ON CONFLICT(hn_id, eval_model) DO UPDATE SET eval_status = 'queued', prompt_mode = excluded.prompt_mode`
            )
            .bind(syntheticId, model.id, model.provider, model.prompt_mode ?? 'full')
            .run();
          enqueued++;
        }
      }

      await logEvent(db, {
        event_type: 'calibration',
        severity: 'info',
        message: `Calibration run started: ${enqueued} URLs enqueued across ${enabledModels.length} models`,
        details: { enqueued, models: enabledModels.map(m => m.id) },
      });

      return new Response(JSON.stringify({ enqueued, models: enabledModels.map(m => m.id), calibration_ids: CALIBRATION_SET.map((_, i) => -(1000 + i + 1)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /calibrate/check — collect results and run drift check
    // Optional: ?model=deepseek-v3.2 to check a specific model's calibration from rater_evals
    // Optional: ?mode=lite to check the lite-1.4 calibration set (hn_ids -2001 to -2015)
    if (path === '/calibrate/check' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = writeDb(env.DB);
      const modeParam = url.searchParams.get('mode');

      // Lite mode: read from rater_evals (prompt_mode='lite') for hn_ids -2001 to -2015
      if (modeParam === 'lite' || modeParam === 'light') {
        const liteScores = new Map<string, number | null>();
        let litePending = 0;

        for (let i = 0; i < LITE_CALIBRATION_SET.length; i++) {
          const cal = LITE_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const row = await db
            .prepare(
              `SELECT eval_status, hcb_weighted_mean FROM rater_evals
               WHERE hn_id = ? AND prompt_mode IN ('lite', 'light')
               ORDER BY evaluated_at DESC LIMIT 1`,
            )
            .bind(syntheticId)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            liteScores.set(cal.url, row.hcb_weighted_mean);
          } else {
            liteScores.set(cal.url, null);
            if (row && (row.eval_status === 'pending' || row.eval_status === 'queued')) litePending++;
          }
        }

        const liteSummary = runCalibrationCheck(liteScores, LITE_CALIBRATION_SET, LITE_DRIFT_THRESHOLDS);

        await db
          .prepare(
            `INSERT INTO calibration_runs (model, methodology_hash, total_urls, passed, failed, skipped, status, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            'lite-1.4',
            'lite-1.4',
            LITE_CALIBRATION_SET.length,
            liteSummary.passed,
            liteSummary.failed,
            liteSummary.skipped,
            liteSummary.status,
            JSON.stringify({
              results: liteSummary.results,
              classOrderingOk: liteSummary.classOrderingOk,
              pairChecks: liteSummary.pairChecks,
              warned: liteSummary.warned,
            }),
          )
          .run();

        await logEvent(db, {
          event_type: 'calibration',
          severity: liteSummary.status === 'fail' ? 'error' : liteSummary.status === 'warn' ? 'warn' : 'info',
          message: `Lite calibration check: ${liteSummary.status} (${liteSummary.passed} pass, ${liteSummary.failed} fail, ${liteSummary.skipped} skip)`,
          details: {
            mode: 'lite',
            status: liteSummary.status,
            passed: liteSummary.passed,
            failed: liteSummary.failed,
            warned: liteSummary.warned,
            skipped: liteSummary.skipped,
            classOrderingOk: liteSummary.classOrderingOk,
            pending: litePending,
          },
        });

        return new Response(JSON.stringify({ ...liteSummary, pending: litePending, model: 'lite-1.4' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const modelParam = url.searchParams.get('model');

      const scores = new Map<string, number | null>();
      let pendingCount = 0;

      for (let i = 0; i < CALIBRATION_SET.length; i++) {
        const cal = CALIBRATION_SET[i];
        const syntheticId = -(1000 + i + 1);

        if (modelParam) {
          // Read from rater_evals for specific model
          const row = await db
            .prepare(`SELECT eval_status, hcb_weighted_mean FROM rater_evals WHERE hn_id = ? AND eval_model = ?`)
            .bind(syntheticId, modelParam)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            scores.set(cal.url, row.hcb_weighted_mean);
          } else {
            scores.set(cal.url, null);
            if (row && (row.eval_status === 'pending' || row.eval_status === 'queued')) pendingCount++;
          }
        } else {
          // Default: read from stories (primary model)
          const row = await db
            .prepare(`SELECT eval_status, hcb_weighted_mean FROM stories WHERE hn_id = ?`)
            .bind(syntheticId)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            scores.set(cal.url, row.hcb_weighted_mean);
          } else {
            scores.set(cal.url, null);
            if (row && row.eval_status === 'pending') pendingCount++;
          }
        }
      }

      const summary = runCalibrationCheck(scores);

      const model = modelParam || 'unknown';
      let methodologyHash = 'unknown';
      if (modelParam) {
        const hashRow = await db
          .prepare(`SELECT methodology_hash FROM rater_evals WHERE hn_id < -1000 AND hn_id >= -1015 AND eval_model = ? AND methodology_hash IS NOT NULL LIMIT 1`)
          .bind(modelParam)
          .first<{ methodology_hash: string }>();
        if (hashRow) methodologyHash = hashRow.methodology_hash;
      } else {
        const hashRow = await db
          .prepare(`SELECT methodology_hash FROM stories WHERE hn_id < -1000 AND hn_id >= -1015 AND methodology_hash IS NOT NULL LIMIT 1`)
          .first<{ methodology_hash: string }>();
        if (hashRow) methodologyHash = hashRow.methodology_hash;

        const modelRow = await db
          .prepare(`SELECT eval_model FROM eval_history WHERE hn_id < -1000 AND hn_id >= -1015 ORDER BY id DESC LIMIT 1`)
          .first<{ eval_model: string }>();
        if (modelRow && model === 'unknown') {
          // Use detected model
        }
      }

      await db
        .prepare(
          `INSERT INTO calibration_runs (model, methodology_hash, total_urls, passed, failed, skipped, status, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          model,
          methodologyHash,
          CALIBRATION_SET.length,
          summary.passed,
          summary.failed,
          summary.skipped,
          summary.status,
          JSON.stringify({
            results: summary.results,
            classOrderingOk: summary.classOrderingOk,
            pairChecks: summary.pairChecks,
            warned: summary.warned,
          }),
        )
        .run();

      await logEvent(db, {
        event_type: 'calibration',
        severity: summary.status === 'fail' ? 'error' : summary.status === 'warn' ? 'warn' : 'info',
        message: `Calibration check: ${summary.status} model=${model} (${summary.passed} pass, ${summary.failed} fail, ${summary.skipped} skip)`,
        details: {
          status: summary.status,
          model,
          passed: summary.passed,
          failed: summary.failed,
          warned: summary.warned,
          skipped: summary.skipped,
          classOrderingOk: summary.classOrderingOk,
          pending: pendingCount,
        },
      });

      // Phase 31D: auto-disable model on calibration drift
      if (model !== 'unknown') {
        const calDisable = shouldAutoDisableFromCalibration(summary, model);
        if (calDisable.disable) {
          try {
            const healthKey = raterHealthKvKey(model);
            let health: RaterHealthState = emptyRaterHealth();
            const stored = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null;
            if (stored) health = stored;
            health = { ...health, disabled_at: new Date().toISOString(), disabled_reason: calDisable.reason };
            await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 });
            await logEvent(db, {
              event_type: 'rater_auto_disable',
              severity: 'warn',
              message: `Model ${model} auto-disabled after calibration drift`,
              details: { model, reason: calDisable.reason, calibration_status: summary.status, classOrderingOk: summary.classOrderingOk },
            });
          } catch (err) {
            console.error('[calibrate/check] Auto-disable failed (non-fatal):', err);
          }
        }
      }

      return new Response(JSON.stringify({ ...summary, pending: pendingCount, model, methodologyHash }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /recalc — recompute aggregates for stories with eval_status='rescoring'
    if (path === '/recalc' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = writeDb(env.DB);

      // Content type → channel weights lookup (from methodology section 2)
      const CHANNEL_WEIGHTS: Record<string, { editorial: number; structural: number }> = {
        ED: { editorial: 0.6, structural: 0.4 },
        PO: { editorial: 0.3, structural: 0.7 },
        LP: { editorial: 0.3, structural: 0.7 },
        PR: { editorial: 0.5, structural: 0.5 },
        AC: { editorial: 0.4, structural: 0.6 },
        MI: { editorial: 0.7, structural: 0.3 },
        AD: { editorial: 0.2, structural: 0.8 },
        HR: { editorial: 0.5, structural: 0.5 },
        CO: { editorial: 0.4, structural: 0.6 },
        ME: { editorial: 0.5, structural: 0.5 },
        MX: { editorial: 0.5, structural: 0.5 },
      };

      const { results: stories } = await db
        .prepare(
          `SELECT hn_id, domain, content_type FROM stories
           WHERE eval_status = 'rescoring'
           LIMIT 50`
        )
        .all<{ hn_id: number; domain: string | null; content_type: string | null }>();

      if (stories.length === 0) {
        return new Response(JSON.stringify({ rescored: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let rescored = 0;
      const errors: string[] = [];

      for (const story of stories) {
        try {
          // Read from rater_scores using story's eval_model
          const rescoreModel = story.eval_model;
          const { results: scoreRows } = await db
            .prepare(
              `SELECT section, editorial, structural, evidence, directionality, note, editorial_note, structural_note
               FROM rater_scores WHERE hn_id = ? AND eval_model = ? ORDER BY sort_order`
            )
            .bind(story.hn_id, rescoreModel)
            .all<{
              section: string;
              editorial: number | null;
              structural: number | null;
              evidence: string | null;
              directionality: string;
              note: string;
              editorial_note: string | null;
              structural_note: string | null;
            }>();

          if (scoreRows.length === 0) {
            errors.push(`hn_id=${story.hn_id}: no scores found`);
            await db.prepare(`UPDATE stories SET eval_status = 'failed', eval_error = 'no scores for rescoring' WHERE hn_id = ?`).bind(story.hn_id).run();
            continue;
          }

          const { results: fwRows } = await db
            .prepare(`SELECT section, fact_type, fact_text FROM rater_witness WHERE hn_id = ? AND eval_model = ?`)
            .bind(story.hn_id, rescoreModel)
            .all<{ section: string; fact_type: string; fact_text: string }>();

          const witnessBySection = new Map<string, { facts: string[]; inferences: string[] }>();
          for (const fw of fwRows) {
            let entry = witnessBySection.get(fw.section);
            if (!entry) { entry = { facts: [], inferences: [] }; witnessBySection.set(fw.section, entry); }
            if (fw.fact_type === 'observable') entry.facts.push(fw.fact_text);
            else entry.inferences.push(fw.fact_text);
          }

          const rawScores = scoreRows.map(r => {
            let dir: string[] = [];
            try { dir = JSON.parse(r.directionality || '[]'); } catch { /* ignore */ }
            const fw = witnessBySection.get(r.section);
            return {
              section: r.section,
              editorial: r.editorial,
              structural: r.structural,
              directionality: dir,
              evidence: r.evidence,
              editorial_note: r.editorial_note || '',
              structural_note: r.structural_note || '',
              note: r.note || r.editorial_note || r.structural_note || '',
              witness_facts: fw?.facts,
              witness_inferences: fw?.inferences,
            };
          });

          const contentType = story.content_type || 'MX';
          const channelWeights = CHANNEL_WEIGHTS[contentType] || CHANNEL_WEIGHTS['MX'];

          let dcpElements: Record<string, DcpElement> | null = null;
          if (story.domain) {
            try {
              const dcpRow = await db
                .prepare(`SELECT dcp_json FROM domain_dcp WHERE domain = ? LIMIT 1`)
                .bind(story.domain)
                .first<{ dcp_json: string }>();
              if (dcpRow?.dcp_json) {
                const parsed = JSON.parse(dcpRow.dcp_json);
                dcpElements = parsed.elements || parsed;
              }
            } catch { /* no DCP available */ }
          }

          const derivedScores = computeDerivedScoreFields(rawScores as EvalScore[], channelWeights, dcpElements);
          const aggregates = computeAggregates(derivedScores, channelWeights);
          const storyLevel = computeStoryLevelAggregates(derivedScores);
          const fwAgg = computeFairWitnessAggregates(derivedScores);

          const scoreStmts = derivedScores.map(s => {
            return db
              .prepare(
                `UPDATE rater_scores SET final = ?, combined = ?, context_modifier = ?
                 WHERE hn_id = ? AND eval_model = ? AND section = ?`
              )
              .bind(s.final, s.combined ?? null, s.context_modifier ?? null, story.hn_id, rescoreModel, s.section);
          });
          await safeBatch(db, scoreStmts);

          const hcbJson = JSON.stringify({
            schema_version: '3.7',
            evaluation: {
              content_type: { primary: contentType, secondary: [] },
              channel_weights: channelWeights,
            },
            scores: derivedScores,
            aggregates,
          });

          await db
            .prepare(
              `UPDATE stories SET
                hcb_weighted_mean = ?,
                hcb_classification = ?,
                hcb_signal_sections = ?,
                hcb_nd_count = ?,
                hcb_evidence_h = ?,
                hcb_evidence_m = ?,
                hcb_evidence_l = ?,
                hcb_json = ?,
                eval_model = ?,
                fw_ratio = ?,
                fw_observable_count = ?,
                fw_inference_count = ?,
                hcb_editorial_mean = ?,
                hcb_structural_mean = ?,
                hcb_setl = ?,
                hcb_confidence = ?,
                eval_status = 'done',
                eval_error = NULL
              WHERE hn_id = ?`
            )
            .bind(
              aggregates.weighted_mean,
              aggregates.classification,
              aggregates.signal_sections,
              aggregates.nd_count,
              aggregates.evidence_profile?.H ?? 0,
              aggregates.evidence_profile?.M ?? 0,
              aggregates.evidence_profile?.L ?? 0,
              hcbJson,
              rescoreModel,
              fwAgg.fw_ratio,
              fwAgg.fw_observable_count,
              fwAgg.fw_inference_count,
              storyLevel.hcb_editorial_mean,
              storyLevel.hcb_structural_mean,
              storyLevel.hcb_setl,
              storyLevel.hcb_confidence,
              story.hn_id,
            )
            .run();

          rescored++;
        } catch (err) {
          errors.push(`hn_id=${story.hn_id}: ${err}`);
          await db.prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`).bind(String(err).slice(0, 500), story.hn_id).run();
        }
      }

      await logEvent(db, {
        event_type: 'trigger',
        severity: 'info',
        message: `Recalc: rescored ${rescored}/${stories.length} stories`,
        details: { rescored, total: stories.length, errors: errors.length > 0 ? errors : undefined },
      });

      return new Response(JSON.stringify({ rescored, total: stories.length, errors: errors.length > 0 ? errors : undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /health — pipeline health check (no auth required)
    if (path === '/health' && request.method === 'GET') {
      const health = await getPipelineHealth(writeDb(env.DB));
      return new Response(JSON.stringify(health), {
        status: health.healthy ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('HN HRCB Cron Worker v6 (hn-bot + eval pipeline)', { status: 200 });
  },
};
