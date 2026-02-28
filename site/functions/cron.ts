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
import { CALIBRATION_SET, LIGHT_CALIBRATION_SET, LIGHT_DRIFT_THRESHOLDS, runCalibrationCheck } from '../src/lib/calibration';
import { shouldAutoDisableFromCalibration, raterHealthKvKey, emptyRaterHealth, type RaterHealthState } from '../src/lib/rater-health';
import { getPipelineHealth } from '../src/lib/db';
import { runScheduledCoverageStrategy, runCoverageStrategy, STRATEGY_NAMES, type StrategyName, type StrategyOptions, searchAlgolia, insertAlgoliaHits } from '../src/lib/coverage-crawl';
import { checkContentDrift } from '../src/lib/content-drift';
import {
  computeAggregates,
  computeDerivedScoreFields,
  computeStoryLevelAggregates,
  computeFairWitnessAggregates,
  type DcpElement,
} from '../src/lib/compute-aggregates';
import { runCrawlCycle, enqueueForEvaluation, dispatchFreeModelEvals, preloadContentCache } from '../src/lib/hn-bot';
import { refreshDomainAggregate, refreshAllDomainAggregates } from '../src/lib/eval-write';
import { getModelQueue, PRIMARY_MODEL_ID } from '../src/lib/shared-eval';

interface Env {
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
  WORKERS_AI_QUEUE?: Queue;
  CONTENT_CACHE: KVNamespace;
  CONTENT_SNAPSHOTS?: R2Bucket;
  CRON_SECRET?: string;
  DAILY_EVAL_BUDGET?: string;
}

// --- Main cron handler ---

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = env.DB;
    const minute = new Date(event.scheduledTime).getMinutes();

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
                  avg_eq, avg_so, avg_td, avg_valence, avg_arousal, dominant_tone)
               SELECT domain, ?, story_count, evaluated_count,
                      avg_hrcb, avg_setl, avg_editorial, avg_structural,
                      avg_eq, avg_so, avg_td, avg_valence, avg_arousal, dominant_tone
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

    if (minute === 0) {
      const pruned = await pruneEvents(db, 90);
      if (pruned > 0) console.log(`[events] Pruned ${pruned} events older than 90 days`);
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

      const db = env.DB;
      const rawLimit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

      if (sweep === 'failed') {
        const { meta } = await db
          .prepare(
            `UPDATE stories SET eval_status = 'pending', eval_error = NULL
             WHERE hn_id IN (
               SELECT hn_id FROM stories
               WHERE eval_status = 'failed'
               ORDER BY hn_time DESC
               LIMIT ?
             )`
          )
          .bind(rawLimit)
          .run();
        const promoted = meta?.changes ?? 0;

        if (promoted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep: reset ${promoted} failed stories to pending`,
          details: { sweep: 'failed', promoted, limit: rawLimit },
        });

        return new Response(JSON.stringify({ sweep: 'failed', promoted, description: `Reset ${promoted} failed stories to pending` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'skipped') {
        const minScore = parseInt(url.searchParams.get('min_score') || '50', 10) || 50;

        const { meta } = await db
          .prepare(
            `UPDATE stories SET eval_status = 'pending', eval_error = NULL
             WHERE hn_id IN (
               SELECT hn_id FROM stories
               WHERE eval_status = 'skipped'
                 AND eval_error LIKE 'Not in top%pages'
                 AND url IS NOT NULL
                 AND hn_score >= ?
               ORDER BY hn_score DESC
               LIMIT ?
             )`
          )
          .bind(minScore, rawLimit)
          .run();
        const promoted = meta?.changes ?? 0;

        if (promoted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep: promoted ${promoted} skipped stories to pending (min_score=${minScore})`,
          details: { sweep: 'skipped', promoted, limit: rawLimit, min_score: minScore },
        });

        return new Response(JSON.stringify({ sweep: 'skipped', promoted, description: `Promoted ${promoted} skipped stories with hn_score >= ${minScore} to pending` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'coverage') {
        const strategyParam = url.searchParams.get('strategy') || 'all';

        if (strategyParam !== 'all' && !STRATEGY_NAMES.includes(strategyParam as StrategyName)) {
          return new Response(JSON.stringify({
            error: `Unknown strategy: ${strategyParam}`,
            valid_strategies: ['all', ...STRATEGY_NAMES],
          }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const articleParam = url.searchParams.get('article');
        const strategyOptions: StrategyOptions = {};
        if (articleParam) strategyOptions.article = articleParam;

        const results = await runCoverageStrategy(
          strategyParam as StrategyName | 'all',
          db,
          strategyOptions,
        );

        const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);

        if (totalInserted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
        }

        await logEvent(db, {
          event_type: 'coverage_crawl',
          severity: 'info',
          message: `Coverage sweep: ${strategyParam}, ${totalInserted} stories inserted`,
          details: { sweep: 'coverage', strategy: strategyParam, total_inserted: totalInserted, results },
        });

        return new Response(JSON.stringify({ sweep: 'coverage', strategy: strategyParam, results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'content_drift') {
        const result = await checkContentDrift(db, rawLimit);

        if (result.drifted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Content drift: checked ${result.checked}, drifted ${result.drifted}, errors ${result.errors}`,
          details: { sweep: 'content_drift', ...result, limit: rawLimit },
        });

        return new Response(JSON.stringify({ sweep: 'content_drift', ...result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'algolia_backfill') {
        const minScore = parseInt(url.searchParams.get('min_score') || '500', 10) || 500;
        const daysBack = parseInt(url.searchParams.get('days_back') || '365', 10) || 365;

        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = nowSec - daysBack * 86400;

        const hits = await searchAlgolia({
          tags: 'story',
          numericFilters: `points>=${minScore},created_at_i>=${startSec}`,
          hitsPerPage: rawLimit,
          byDate: true,
        });

        const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'algolia_backfill');

        if (inserted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Algolia backfill: ${inserted} inserted, ${skipped} skipped (min_score=${minScore}, days_back=${daysBack})`,
          details: { sweep: 'algolia_backfill', inserted, skipped, min_score: minScore, days_back: daysBack, limit: rawLimit },
        });

        return new Response(JSON.stringify({ sweep: 'algolia_backfill', inserted, skipped, hits_fetched: hits.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'refresh_domain_aggregates') {
        const guardKey = 'sweep:refresh_domain_aggregates:running';
        const isRunning = await env.CONTENT_CACHE.get(guardKey).catch(() => null);
        if (isRunning) {
          return new Response(
            JSON.stringify({ error: 'Refresh already in progress', retry_after_seconds: 60 }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          );
        }
        await env.CONTENT_CACHE.put(guardKey, new Date().toISOString(), { expirationTtl: 300 });

        const chunkSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get('chunk_size') || '100', 10)));
        const minEvaluated = Math.max(0, parseInt(url.searchParams.get('min_evaluated') || '1', 10));

        ctx.waitUntil(
          (async () => {
            try {
              const result = await refreshAllDomainAggregates(db, { chunkSize, minEvaluated });
              // Invalidate domain KV caches so next request gets fresh data
              const cacheKeys = [
                'q:domainSignalProfiles', 'q:allDomainStats:count:50', 'q:allDomainStats:count:200',
                'q:allDomainStats:score:200', 'q:allDomainStats:setl:200', 'q:allDomainStats:conf:200',
                'q:domainIntelligence', 'q:mostGatekeptDomains',
              ];
              await Promise.all(cacheKeys.map(k => env.CONTENT_CACHE.delete(k).catch(() => {})));
              await logEvent(db, {
                event_type: 'trigger',
                severity: 'info',
                message: `Sweep refresh_domain_aggregates: ${result.refreshed} refreshed, ${result.errors} errors in ${result.durationMs}ms`,
                details: { sweep: 'refresh_domain_aggregates', ...result, chunk_size: chunkSize, min_evaluated: minEvaluated },
              });
            } catch (err) {
              await logEvent(db, {
                event_type: 'cron_error',
                severity: 'error',
                message: `Sweep refresh_domain_aggregates failed: ${String(err).slice(0, 300)}`,
                details: { sweep: 'refresh_domain_aggregates', error: String(err) },
              }).catch(() => {});
            } finally {
              env.CONTENT_CACHE.delete(guardKey).catch(() => {});
            }
          })(),
        );

        return new Response(
          JSON.stringify({
            sweep: 'refresh_domain_aggregates',
            status: 'started',
            description: 'Refreshing all domain_aggregates from stories table. Check /status/events for completion.',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ error: `Unknown sweep type: ${sweep}`, valid_types: ['failed', 'skipped', 'coverage', 'algolia_backfill', 'content_drift', 'refresh_domain_aggregates'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /calibrate — enqueue 15 calibration URLs for evaluation (all enabled models)
    // POST /calibrate?mode=light — insert light calibration URLs as pending for standalone evaluator
    if (path === '/calibrate' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = env.DB;
      const mode = url.searchParams.get('mode');

      // Light mode: insert LIGHT_CALIBRATION_SET stories as pending (hn_ids -2001 to -2015).
      // Evaluation is done by the local evaluate-standalone.mjs script, not Cloudflare queues.
      if (mode === 'light') {
        // Generate a calibration_run ID (unix timestamp) — stored in KV so ingest.ts can tag rows in calibration_evals
        const calibrationRun = Math.floor(Date.now() / 1000);
        try {
          await env.CONTENT_CACHE.put('calibration:light:current_run', String(calibrationRun), { expirationTtl: 30 * 24 * 60 * 60 });
        } catch { /* non-fatal */ }

        // Clean up previous light calibration rater_evals so the queue filter doesn't skip them
        const lightCalIds = LIGHT_CALIBRATION_SET.map((_, i) => -(2000 + i + 1));
        const lightPlaceholders = lightCalIds.map(() => '?').join(',');
        try {
          await db.batch([
            db.prepare(`DELETE FROM rater_evals WHERE hn_id IN (${lightPlaceholders}) AND prompt_mode = 'light'`).bind(...lightCalIds),
            db.prepare(`DELETE FROM calibration_runs WHERE model IN ('light-1.3', 'light-1.4') AND created_at < datetime('now', '-30 days')`),
          ]);
        } catch (err) {
          console.warn('[calibrate] Light cleanup failed (non-fatal):', err);
        }
        for (let i = 0; i < LIGHT_CALIBRATION_SET.length; i++) {
          const cal = LIGHT_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const domain = extractDomain(cal.url);
          await db
            .prepare(
              `INSERT INTO stories (hn_id, title, url, domain, hn_score, hn_comments, hn_time, hn_type, eval_status)
               VALUES (?, ?, ?, ?, 0, 0, ?, 'calibration', 'pending')
               ON CONFLICT(hn_id) DO UPDATE SET url = excluded.url, domain = excluded.domain, title = excluded.title, eval_status = 'pending', evaluated_at = NULL`,
            )
            .bind(syntheticId, `[CAL-LIGHT] ${cal.label} (${cal.slot})`, cal.url, domain, Math.floor(Date.now() / 1000))
            .run();
        }
        await logEvent(db, {
          event_type: 'calibration',
          severity: 'info',
          message: `Light calibration queued: ${LIGHT_CALIBRATION_SET.length} URLs inserted as pending`,
          details: { mode: 'light', calibration_ids: LIGHT_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)) },
        });
        return new Response(JSON.stringify({
          mode: 'light',
          calibration_run: calibrationRun,
          queued: LIGHT_CALIBRATION_SET.length,
          calibration_ids: LIGHT_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)),
          note: 'Stories inserted as pending. Run: node scripts/evaluate-standalone.mjs --mode light',
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
    // Optional: ?mode=light to check the light-1.4 calibration set (hn_ids -2001 to -2015)
    if (path === '/calibrate/check' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = env.DB;
      const modeParam = url.searchParams.get('mode');

      // Light mode: read from rater_evals (prompt_mode='light') for hn_ids -2001 to -2015
      if (modeParam === 'light') {
        const lightScores = new Map<string, number | null>();
        let lightPending = 0;

        for (let i = 0; i < LIGHT_CALIBRATION_SET.length; i++) {
          const cal = LIGHT_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const row = await db
            .prepare(
              `SELECT eval_status, hcb_weighted_mean FROM rater_evals
               WHERE hn_id = ? AND prompt_mode = 'light'
               ORDER BY evaluated_at DESC LIMIT 1`,
            )
            .bind(syntheticId)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            lightScores.set(cal.url, row.hcb_weighted_mean);
          } else {
            lightScores.set(cal.url, null);
            if (row && (row.eval_status === 'pending' || row.eval_status === 'queued')) lightPending++;
          }
        }

        const lightSummary = runCalibrationCheck(lightScores, LIGHT_CALIBRATION_SET, LIGHT_DRIFT_THRESHOLDS);

        await db
          .prepare(
            `INSERT INTO calibration_runs (model, methodology_hash, total_urls, passed, failed, skipped, status, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            'light-1.4',
            'light-1.4',
            LIGHT_CALIBRATION_SET.length,
            lightSummary.passed,
            lightSummary.failed,
            lightSummary.skipped,
            lightSummary.status,
            JSON.stringify({
              results: lightSummary.results,
              classOrderingOk: lightSummary.classOrderingOk,
              pairChecks: lightSummary.pairChecks,
              warned: lightSummary.warned,
            }),
          )
          .run();

        await logEvent(db, {
          event_type: 'calibration',
          severity: lightSummary.status === 'fail' ? 'error' : lightSummary.status === 'warn' ? 'warn' : 'info',
          message: `Light calibration check: ${lightSummary.status} (${lightSummary.passed} pass, ${lightSummary.failed} fail, ${lightSummary.skipped} skip)`,
          details: {
            mode: 'light',
            status: lightSummary.status,
            passed: lightSummary.passed,
            failed: lightSummary.failed,
            warned: lightSummary.warned,
            skipped: lightSummary.skipped,
            classOrderingOk: lightSummary.classOrderingOk,
            pending: lightPending,
          },
        });

        return new Response(JSON.stringify({ ...lightSummary, pending: lightPending, model: 'light-1.4' }), {
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

      const db = env.DB;

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
          for (let i = 0; i < scoreStmts.length; i += 100) {
            await db.batch(scoreStmts.slice(i, i + 100));
          }

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
      const health = await getPipelineHealth(env.DB);
      return new Response(JSON.stringify(health), {
        status: health.healthy ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('HN HRCB Cron Worker v6 (hn-bot + eval pipeline)', { status: 200 });
  },
};
