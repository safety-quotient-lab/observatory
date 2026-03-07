// SPDX-License-Identifier: Apache-2.0
/**
 * Sweep handler functions for the cron worker's /trigger?sweep=X endpoint.
 *
 * Each exported function handles one sweep mode. The cron fetch handler
 * dispatches to these via a lookup map, keeping cron.ts thin.
 */

import { logEvent } from '../src/lib/events';
import { enqueueForEvaluation } from '../src/lib/hn-bot';
import { checkContentDrift } from '../src/lib/content-drift';
import {
  runCoverageStrategy,
  STRATEGY_NAMES,
  type StrategyName,
  type StrategyOptions,
  searchAlgolia,
  insertAlgoliaHits,
} from '../src/lib/coverage-crawl';
import { refreshAllDomainAggregates, backfillPtScores, refreshAllUserAggregates, refreshUserAggregate, updateConsensusScore, updatePsqConsensus } from '../src/lib/eval-write';
import { refreshArticlePairStats } from '../src/lib/db-analytics';
import { getEnabledFreeModels } from '../src/lib/models';
import { safeBatch, writeDb } from '../src/lib/db-utils';
import { computeRightsSalience, computeAcScore, computeCarScore } from '../src/lib/compute-aggregates';
import type { EvalScore } from '../src/lib/shared-eval';
import { CALIBRATION_SET } from '../src/lib/calibration';
import type { Env } from './cron';

export interface SweepContext {
  db: D1Database;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseLimit(url: URL, defaultVal = 50, max = 200): number {
  return Math.min(parseInt(url.searchParams.get('limit') || String(defaultVal), 10) || defaultVal, max);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Sweep: failed ──────────────────────────────────────────────────────────

/** Reset failed stories to pending, then enqueue. */
export async function sweepFailed({ db, env, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url);

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
    .bind(limit)
    .run();
  const promoted = meta?.changes ?? 0;

  if (promoted > 0) {
    await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep: reset ${promoted} failed stories to pending`,
    details: { sweep: 'failed', promoted, limit },
  });

  return json({ sweep: 'failed', promoted, description: `Reset ${promoted} failed stories to pending` });
}

// ─── Sweep: skipped ─────────────────────────────────────────────────────────

/** Re-promote rank-skipped stories with hn_score >= min_score, then enqueue. */
export async function sweepSkipped({ db, env, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url);
  const minScore = Math.min(parseInt(url.searchParams.get('min_score') || '50', 10) || 50, 100000);

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
    .bind(minScore, limit)
    .run();
  const promoted = meta?.changes ?? 0;

  if (promoted > 0) {
    await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep: promoted ${promoted} skipped stories to pending (min_score=${minScore})`,
    details: { sweep: 'skipped', promoted, limit, min_score: minScore },
  });

  return json({ sweep: 'skipped', promoted, description: `Promoted ${promoted} skipped stories with hn_score >= ${minScore} to pending` });
}

// ─── Sweep: coverage ────────────────────────────────────────────────────────

/** Run coverage-driven crawl strategies, then enqueue inserted stories. */
export async function sweepCoverage({ db, env, url }: SweepContext): Promise<Response> {
  const strategyParam = url.searchParams.get('strategy') || 'all';

  if (strategyParam !== 'all' && !STRATEGY_NAMES.includes(strategyParam as StrategyName)) {
    return json({
      error: `Unknown strategy: ${strategyParam}`,
      valid_strategies: ['all', ...STRATEGY_NAMES],
    }, 400);
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

  return json({ sweep: 'coverage', strategy: strategyParam, results });
}

// ─── Sweep: content_drift ───────────────────────────────────────────────────

/** Re-evaluate stories whose content has changed since last eval. */
export async function sweepContentDrift({ db, env, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url);
  const result = await checkContentDrift(db, limit);

  if (result.drifted > 0) {
    await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Content drift: checked ${result.checked}, drifted ${result.drifted}, errors ${result.errors}`,
    details: { sweep: 'content_drift', ...result, limit },
  });

  return json({ sweep: 'content_drift', ...result });
}

// ─── Sweep: algolia_backfill ────────────────────────────────────────────────

/** Backfill stories from Algolia HN search API by score and date range. */
export async function sweepAlgoliaBackfill({ db, env, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url);
  const minScore = Math.min(parseInt(url.searchParams.get('min_score') || '500', 10) || 500, 100000);
  const daysBack = Math.min(parseInt(url.searchParams.get('days_back') || '365', 10) || 365, 3650);

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - daysBack * 86400;

  const hits = await searchAlgolia({
    tags: 'story',
    numericFilters: `points>=${minScore},created_at_i>=${startSec}`,
    hitsPerPage: limit,
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
    details: { sweep: 'algolia_backfill', inserted, skipped, min_score: minScore, days_back: daysBack, limit },
  });

  return json({ sweep: 'algolia_backfill', inserted, skipped, hits_fetched: hits.length });
}

// ─── Sweep: refresh_domain_aggregates ───────────────────────────────────────

/**
 * Rebuild all domain_aggregates rows from stories (background via waitUntil).
 * Uses a KV guard to prevent concurrent runs. Returns 202 immediately.
 */
export async function sweepRefreshDomainAggregates({ db, env, ctx, url }: SweepContext): Promise<Response> {
  const guardKey = 'sweep:refresh_domain_aggregates:running';
  const isRunning = await env.CONTENT_CACHE.get(guardKey).catch(() => null);
  if (isRunning) {
    return json({ error: 'Refresh already in progress', retry_after_seconds: 60 }, 429);
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

  return json({
    sweep: 'refresh_domain_aggregates',
    status: 'started',
    description: 'Refreshing all domain_aggregates from stories table. Check /status/events for completion.',
  }, 202);
}

// ─── Sweep: setl_spikes ──────────────────────────────────────────────────────

/**
 * Detect SETL spikes: domains whose avg_setl crossed 0.3 today and jumped >0.15
 * since yesterday. Emits a 'setl_spike' event per affected domain.
 * Requires domain_profile_snapshots rows for today and yesterday.
 */
export async function sweepSetlSpikes({ db }: SweepContext): Promise<Response> {
  const { results } = await db
    .prepare(
      `WITH today AS (
         SELECT domain, avg_setl FROM domain_profile_snapshots WHERE snapshot_date = DATE('now')
       ),
       yesterday AS (
         SELECT domain, avg_setl FROM domain_profile_snapshots WHERE snapshot_date = DATE('now', '-1 day')
       )
       SELECT t.domain,
              t.avg_setl                                   AS setl_today,
              y.avg_setl                                   AS setl_yesterday,
              t.avg_setl - COALESCE(y.avg_setl, 0)        AS setl_delta
       FROM today t
       LEFT JOIN yesterday y ON t.domain = y.domain
       WHERE t.avg_setl > 0.3
         AND (y.avg_setl IS NULL OR t.avg_setl - y.avg_setl > 0.15)
       ORDER BY setl_delta DESC
       LIMIT 20`
    )
    .all<{ domain: string; setl_today: number; setl_yesterday: number | null; setl_delta: number }>();

  let emitted = 0;
  for (const row of results) {
    await logEvent(db, {
      event_type: 'setl_spike',
      severity: 'warn',
      message: `SETL spike: ${row.domain} avg_setl=${row.setl_today.toFixed(3)} (Δ=${row.setl_delta.toFixed(3)})`,
      details: {
        domain: row.domain,
        setl_today: row.setl_today,
        setl_yesterday: row.setl_yesterday,
        setl_delta: row.setl_delta,
      },
    }).catch(() => {});
    emitted++;
  }

  return json({ sweep: 'setl_spikes', detected: results.length, emitted });
}

// ─── Sweep: backfill_pt_score ────────────────────────────────────────────────

/**
 * Compute pt_score from pt_flags_json for stories missing it (background via waitUntil).
 * Returns 202 immediately.
 */
export async function sweepBackfillPtScore({ db, ctx, url }: SweepContext): Promise<Response> {
  const limit = Math.min(2000, Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10)));

  ctx.waitUntil(
    (async () => {
      try {
        const result = await backfillPtScores(db, { limit });
        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep backfill_pt_score: ${result.updated} updated, ${result.errors} errors`,
          details: { sweep: 'backfill_pt_score', ...result },
        });
      } catch (err) {
        await logEvent(db, {
          event_type: 'cron_error',
          severity: 'error',
          message: `Sweep backfill_pt_score failed: ${String(err).slice(0, 300)}`,
          details: { sweep: 'backfill_pt_score', error: String(err) },
        }).catch(() => {});
      }
    })(),
  );

  return json({
    sweep: 'backfill_pt_score',
    status: 'started',
    limit,
    description: 'Backfilling pt_score from pt_flags_json for stories without it.',
  }, 202);
}

// ─── Sweep: refresh_user_aggregates ─────────────────────────────────────────

/**
 * Bulk-refresh all user_aggregates rows from current stories table state.
 * Required after migration 0054 or after bulk data corrections.
 * Returns 202 immediately; runs in background via waitUntil.
 */
export async function sweepRefreshUserAggregates({ db, env, ctx }: SweepContext): Promise<Response> {
  const kvKey = 'sweep:refresh_user_aggregates:running';
  const kv = env.CONTENT_CACHE;

  const running = await kv.get(kvKey);
  if (running) {
    return json({ sweep: 'refresh_user_aggregates', status: 'already_running' }, 409);
  }
  await kv.put(kvKey, '1', { expirationTtl: 600 });

  ctx.waitUntil(
    (async () => {
      try {
        const result = await refreshAllUserAggregates(db, { chunkSize: 50 });
        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep refresh_user_aggregates: ${result.refreshed} refreshed, ${result.errors} errors in ${result.durationMs}ms`,
          details: { sweep: 'refresh_user_aggregates', ...result },
        });
      } catch (err) {
        await logEvent(db, {
          event_type: 'cron_error',
          severity: 'error',
          message: `Sweep refresh_user_aggregates failed: ${String(err).slice(0, 300)}`,
          details: { sweep: 'refresh_user_aggregates', error: String(err) },
        }).catch(() => {});
      } finally {
        await kv.delete(kvKey);
      }
    })(),
  );

  return json({ sweep: 'refresh_user_aggregates', status: 'started' }, 202);
}

// ─── Sweep: expand_from_submitted ───────────────────────────────────────────

/**
 * For top-karma users, fetch their HN-API submitted array and insert unknown
 * story-type items as pending. Expands coverage without a full Algolia crawl.
 * Rate-limited: max 5 users per run, max 10 unknown IDs checked per user.
 */
export async function sweepExpandFromSubmitted({ db, env }: SweepContext): Promise<Response> {
  const limit = 5;

  const { results: topUsers } = await db
    .prepare(
      `SELECT username FROM hn_users
       WHERE submitted_count IS NOT NULL AND submitted_count > 0 AND karma IS NOT NULL
       ORDER BY karma DESC LIMIT ?`
    )
    .bind(limit)
    .all<{ username: string }>();

  if (topUsers.length === 0) {
    return json({ sweep: 'expand_from_submitted', inserted: 0, note: 'No users with submitted_count' });
  }

  let totalInserted = 0;

  for (const { username } of topUsers) {
    try {
      const data = await fetch(
        `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`,
        { headers: { 'User-Agent': 'HRCB-Crawler/1.0' } }
      ).then(r => r.json<{ submitted?: number[] }>());

      const submittedIds: number[] = data?.submitted?.slice(0, 50) ?? [];
      if (submittedIds.length === 0) continue;

      // Find which IDs are already in stories
      const placeholders = submittedIds.map(() => '?').join(',');
      const { results: existing } = await db
        .prepare(`SELECT hn_id FROM stories WHERE hn_id IN (${placeholders})`)
        .bind(...submittedIds)
        .all<{ hn_id: number }>();
      const existingSet = new Set(existing.map(r => r.hn_id));

      const unknownIds = submittedIds.filter(id => !existingSet.has(id)).slice(0, 10);
      if (unknownIds.length === 0) continue;

      // Fetch and insert unknown items
      const items = await Promise.all(
        unknownIds.map(id =>
          fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
            headers: { 'User-Agent': 'HRCB-Crawler/1.0' },
          })
            .then(r => r.json<{ id: number; type: string; title?: string; url?: string; by?: string; score?: number; descendants?: number; time?: number }>())
            .catch(() => null)
        )
      );

      const storyItems = items.filter(
        (item): item is NonNullable<typeof item> =>
          item !== null && item.type === 'story' && !!item.title
      );

      if (storyItems.length === 0) continue;

      const stmts = storyItems.map(item =>
        db
          .prepare(
            `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, eval_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'story', 'pending')`
          )
          .bind(
            item.id,
            item.url || null,
            item.title || 'Untitled',
            item.url ? item.url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '') : null,
            item.score || null,
            item.descendants || null,
            item.by || null,
            item.time || Math.floor(Date.now() / 1000),
          )
      );

      const { meta } = await db.batch(stmts).then(results => ({ meta: { changes: results.filter(r => r.meta.changes > 0).length } }));
      totalInserted += meta.changes;

      // Refresh user_aggregates so stories count stays current (else lags until next eval/crawl)
      if (meta.changes > 0) {
        await refreshUserAggregate(db, username).catch(() => {});
      }
    } catch {
      // Non-fatal per user
    }
  }

  return json({ sweep: 'expand_from_submitted', users_checked: topUsers.length, inserted: totalInserted });
}

// ─── Refresh Article Pair Stats ──────────────────────────────────────────────

export async function sweepRefreshArticlePairStats({ db, env, ctx }: SweepContext): Promise<Response> {
  ctx.waitUntil(
    (async () => {
      try {
        const result = await refreshArticlePairStats(db);
        await logEvent(db, {
          event_type: 'trigger',
          message: `Article pair stats refreshed: ${result.pairs} pairs in ${result.ms}ms`,
        });
        // Invalidate KV cache so next page load gets fresh data
        await env.CONTENT_CACHE.delete('sys:articlePairStats').catch(() => {});
      } catch (err) {
        console.error('[sweepRefreshArticlePairStats] error:', err);
      }
    })()
  );

  return new Response(JSON.stringify({ sweep: 'refresh_article_pair_stats', status: 'accepted' }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Sweep: lite_reeval ─────────────────────────────────────────────────────

/**
 * Re-evaluate existing lite-1.4 stories under the lite-1.5 prompt.
 * Produces longitudinal comparison data (before/after two-dimension split).
 * Old evals are preserved in eval_history (append-only INSERT with full hcb_json).
 * rater_evals rows are UPSERTed (overwriting lite-1.4 with lite-1.5).
 */
export async function sweepLiteReeval({ db, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url, 50, 200);

  // Find stories with pre-two-dimension lite evals
  const { results: candidates } = await db
    .prepare(
      `SELECT re.hn_id, s.url, s.title, s.domain, s.hn_text
       FROM rater_evals re
       JOIN stories s ON s.hn_id = re.hn_id
       WHERE re.schema_version IN ('lite-1.4', 'lite', 'light-1.4')
         AND re.prompt_mode = 'lite'
         AND re.eval_status = 'done'
         AND (s.url IS NOT NULL OR s.hn_text IS NOT NULL)
       ORDER BY s.hn_time DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; url: string | null; title: string; domain: string | null; hn_text: string | null }>();

  if (candidates.length === 0) {
    return json({ sweep: 'lite_reeval', dispatched: 0, note: 'No lite-1.4 evals found' });
  }

  const freeModels = getEnabledFreeModels().filter(m => m.provider === 'workers-ai');
  let dispatched = 0;

  for (const model of freeModels) {
    const stmts = candidates.map(c =>
      db.prepare(
        `INSERT OR IGNORE INTO eval_queue (hn_id, target_provider, target_model, prompt_mode, priority, batch_id)
         VALUES (?, 'workers-ai', ?, ?, 0, 'lite_reeval')`
      ).bind(c.hn_id, model.id, model.prompt_mode)
    );
    if (stmts.length > 0) {
      await safeBatch(db, stmts);
      dispatched += candidates.length;
    }
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep lite_reeval: dispatched ${dispatched} evals for ${candidates.length} stories across ${freeModels.length} models`,
    details: { sweep: 'lite_reeval', candidates: candidates.length, dispatched, models: freeModels.map(m => m.id) },
  });

  return json({ sweep: 'lite_reeval', candidates: candidates.length, dispatched });
}

// ─── Sweep: refresh_consensus_scores ────────────────────────────────────────

/**
 * Recompute consensus_score / consensus_spread / consensus_model_count for all
 * stories that have ≥2 done rater_evals. Runs in background via waitUntil.
 *
 * Use after changing confidence weighting logic — recomputes correct weights
 * without requiring new model evaluations. Returns 202 immediately.
 */
export async function sweepRefreshConsensusScores({ db, env, ctx }: SweepContext): Promise<Response> {
  const guardKey = 'sweep:refresh_consensus_scores:running';
  const isRunning = await env.CONTENT_CACHE.get(guardKey).catch(() => null);
  if (isRunning) {
    return json({ error: 'Refresh already in progress', retry_after_seconds: 60 }, 429);
  }
  await env.CONTENT_CACHE.put(guardKey, new Date().toISOString(), { expirationTtl: 600 });

  ctx.waitUntil(
    (async () => {
      let refreshed = 0;
      let errors = 0;
      const start = Date.now();
      try {
        const { results } = await db
          .prepare(
            `SELECT hn_id FROM rater_evals
             WHERE eval_status = 'done' AND hn_id > 0
             GROUP BY hn_id HAVING COUNT(*) >= 2`
          )
          .all<{ hn_id: number }>();

        for (const { hn_id } of results) {
          try {
            await updateConsensusScore(db, hn_id);
            await updatePsqConsensus(db, hn_id);
            refreshed++;
          } catch {
            errors++;
          }
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep refresh_consensus_scores: ${refreshed} refreshed, ${errors} errors in ${Date.now() - start}ms`,
          details: { sweep: 'refresh_consensus_scores', refreshed, errors, durationMs: Date.now() - start },
        });
      } catch (err) {
        await logEvent(db, {
          event_type: 'cron_error',
          severity: 'error',
          message: `Sweep refresh_consensus_scores failed: ${String(err).slice(0, 300)}`,
          details: { sweep: 'refresh_consensus_scores', error: String(err) },
        }).catch(() => {});
      } finally {
        env.CONTENT_CACHE.delete(guardKey).catch(() => {});
      }
    })(),
  );

  return json({
    sweep: 'refresh_consensus_scores',
    status: 'started',
    description: 'Recomputing consensus scores for all stories with ≥2 evals. Check /status/events for completion.',
  }, 202);
}

// ─── Sweep: upgrade_lite ─────────────────────────────────────────────────────

/**
 * Promote lite-only stories (no full eval yet, hn_score >= min_score) to
 * pending so the full-model pipeline evaluates them. Closes the coverage gap
 * between stories that received only a Workers AI lite pass and the richer
 * 31-section full evaluation.
 *
 * Defaults: min_score=50, limit=50, max limit=200.
 */
export async function sweepUpgradeLite({ db, env, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url);
  const minScore = Math.min(parseInt(url.searchParams.get('min_score') || '50', 10) || 50, 100000);

  const { meta } = await db
    .prepare(
      `UPDATE stories SET eval_status = 'pending', eval_error = NULL
       WHERE hn_id IN (
         SELECT s.hn_id FROM stories s
         WHERE s.eval_status = 'done'
           AND s.hn_score >= ?
           AND s.gate_category IS NULL
           AND s.url IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM rater_evals re
             WHERE re.hn_id = s.hn_id AND re.prompt_mode = 'full'
           )
           AND EXISTS (
             SELECT 1 FROM rater_evals re
             WHERE re.hn_id = s.hn_id AND re.prompt_mode IN ('lite', 'lite-v2')
           )
         ORDER BY s.hn_score DESC
         LIMIT ?
       )`
    )
    .bind(minScore, limit)
    .run();
  const promoted = meta?.changes ?? 0;

  if (promoted > 0) {
    await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep: promoted ${promoted} lite-only stories to pending for full eval (min_score=${minScore})`,
    details: { sweep: 'upgrade_lite', promoted, limit, min_score: minScore },
  });

  return json({ sweep: 'upgrade_lite', promoted, description: `Promoted ${promoted} lite-only stories (hn_score >= ${minScore}) to pending for full eval` });
}

// ─── Sweep: browser_audit ───────────────────────────────────────────────────

/**
 * Dispatch domains for headless browser audit via CF Browser Rendering.
 * Audits tracking, security headers, accessibility, and consent patterns.
 *
 * Params: domain (single domain), limit (default 20, max 100).
 */
export async function sweepBrowserAudit({ db, env, url }: SweepContext): Promise<Response> {
  if (!env.BROWSER_AUDIT_QUEUE) {
    return json({ sweep: 'browser_audit', error: 'BROWSER_AUDIT_QUEUE not bound' }, 500);
  }

  const singleDomain = url.searchParams.get('domain');
  const limit = parseLimit(url, 20, 100);

  let domains: string[];
  if (singleDomain) {
    domains = [singleDomain];
  } else {
    const rows = await db
      .prepare(
        `SELECT DISTINCT s.domain FROM stories s
         LEFT JOIN domain_browser_audit ba ON ba.domain = s.domain
         WHERE s.domain IS NOT NULL
           AND s.eval_status = 'done'
           AND (ba.domain IS NULL OR ba.audited_at < datetime('now', '-7 days'))
         ORDER BY RANDOM()
         LIMIT ?`
      )
      .bind(limit)
      .all<{ domain: string }>();
    domains = rows.results.map(r => r.domain);
  }

  // Dispatch to browser audit queue
  for (const domain of domains) {
    await env.BROWSER_AUDIT_QUEUE.send({ domain });
  }

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep: dispatched ${domains.length} domain(s) for browser audit`,
    details: { sweep: 'browser_audit', count: domains.length, domains: domains.slice(0, 10) },
  });

  return json({
    sweep: 'browser_audit',
    dispatched: domains.length,
    domains: domains.slice(0, 20),
    description: `Dispatched ${domains.length} domain(s) for browser audit`,
  });
}

// ─── Kagi API Helpers ────────────────────────────────────────────────────────

interface KagiFastGPTResponse {
  data: { output: string; tokens: number; references?: { title: string; url: string; snippet: string }[] };
  meta?: { id: string; node: string; ms: number };
}

interface KagiSummarizerResponse {
  data: { output: string; tokens: number };
  meta?: { id: string; node: string; ms: number };
}

interface KagiEnrichResponse {
  data: { title: string; url: string; description: string; published?: string }[];
  meta?: { id: string; node: string; ms: number };
}

const KAGI_BACKOFF_KEY = 'kagi:backoff';

async function checkKagiBackoff(env: Env): Promise<string | null> {
  const until = await env.CONTENT_CACHE.get(KAGI_BACKOFF_KEY);
  if (until && new Date(until) > new Date()) return until;
  return null;
}

async function setKagiBackoff(env: Env, minutes: number): Promise<void> {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await env.CONTENT_CACHE.put(KAGI_BACKOFF_KEY, until, { expirationTtl: minutes * 60 });
}

class KagiRateLimitError extends Error {
  constructor(endpoint: string, status: number) {
    super(`Kagi ${endpoint} rate limited (${status})`);
    this.name = 'KagiRateLimitError';
  }
}

async function kagiFastGPT(apiKey: string, query: string): Promise<KagiFastGPTResponse> {
  const res = await fetch('https://kagi.com/api/v0/fastgpt', {
    method: 'POST',
    headers: { 'Authorization': `Bot ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (res.status === 429) throw new KagiRateLimitError('FastGPT', res.status);
  if (!res.ok) throw new Error(`Kagi FastGPT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<KagiFastGPTResponse>;
}

async function kagiSummarize(apiKey: string, url: string): Promise<KagiSummarizerResponse> {
  const res = await fetch(`https://kagi.com/api/v0/summarize?url=${encodeURIComponent(url)}`, {
    headers: { 'Authorization': `Bot ${apiKey}` },
  });
  if (res.status === 429) throw new KagiRateLimitError('Summarizer', res.status);
  if (!res.ok) throw new Error(`Kagi Summarizer ${res.status}: ${await res.text()}`);
  return res.json() as Promise<KagiSummarizerResponse>;
}

async function kagiEnrichNews(apiKey: string, query: string): Promise<KagiEnrichResponse> {
  const res = await fetch(`https://kagi.com/api/v0/enrich/news?q=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': `Bot ${apiKey}` },
  });
  if (res.status === 429) throw new KagiRateLimitError('Enrich', res.status);
  if (!res.ok) throw new Error(`Kagi Enrich ${res.status}: ${await res.text()}`);
  return res.json() as Promise<KagiEnrichResponse>;
}

type DirectionalAssessment = 'positive' | 'neutral' | 'negative';

function parseDirectionalAssessment(output: string): DirectionalAssessment {
  const lower = output.toLowerCase();
  const posSignals = ['rights-positive', 'promotes human rights', 'supports human rights', 'positive impact', 'upholds', 'advances rights', 'protects rights'];
  const negSignals = ['rights-negative', 'violates', 'undermines', 'negative impact', 'threatens rights', 'restricts rights', 'harms'];
  let posCount = 0;
  let negCount = 0;
  for (const s of posSignals) if (lower.includes(s)) posCount++;
  for (const s of negSignals) if (lower.includes(s)) negCount++;
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

function assessmentToNumeric(a: DirectionalAssessment): number {
  return a === 'positive' ? 1 : a === 'negative' ? -1 : 0;
}

function classifyDivergence(ourScore: number, kagiDir: DirectionalAssessment): 'aligned' | 'minor' | 'major' {
  const ourDir = ourScore > 0.05 ? 'positive' : ourScore < -0.05 ? 'negative' : 'neutral';
  if (ourDir === kagiDir) return 'aligned';
  if (ourDir === 'neutral' || kagiDir === 'neutral') return 'minor';
  return 'major';
}

// ─── Sweep: kagi_score_audit ─────────────────────────────────────────────────

/** Cross-validate HRCB scores against Kagi FastGPT UDHR assessment. */
export async function sweepKagiScoreAudit({ db, env, url }: SweepContext): Promise<Response> {
  const apiKey = env.KAGI_API_KEY;
  if (!apiKey) return json({ error: 'KAGI_API_KEY not configured' }, 500);
  const backoffUntil = await checkKagiBackoff(env);
  if (backoffUntil) return json({ sweep: 'kagi_score_audit', skipped: true, backoff_until: backoffUntil, description: 'Kagi API in backoff period' });

  const limit = parseLimit(url, 10, 50);

  const { results: stories } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.domain, s.hcb_weighted_mean
       FROM stories s
       WHERE s.eval_status = 'done'
         AND s.hcb_weighted_mean IS NOT NULL
         AND ABS(s.hcb_weighted_mean) > 0.15
         AND NOT EXISTS (
           SELECT 1 FROM events e
           WHERE e.hn_id = s.hn_id
             AND e.event_type = 'kagi_audit'
             AND json_extract(e.details, '$.audit_type') = 'score_audit'
         )
       ORDER BY ABS(s.hcb_weighted_mean) DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; title: string; domain: string | null; hcb_weighted_mean: number }>();

  if (stories.length === 0) return json({ sweep: 'kagi_score_audit', audited: 0, description: 'No unaudited stories with |score| > 0.15' });

  const results: { hn_id: number; title: string; our_score: number; kagi_dir: DirectionalAssessment; divergence: string }[] = [];

  for (const story of stories) {
    try {
      const query = `What UDHR (Universal Declaration of Human Rights) provisions does "${story.title}" (${story.domain || 'unknown domain'}) implicate? Is the content rights-positive, neutral, or rights-negative?`;
      const resp = await kagiFastGPT(apiKey, query);
      const kagiDir = parseDirectionalAssessment(resp.data.output);
      const divergence = classifyDivergence(story.hcb_weighted_mean, kagiDir);

      results.push({ hn_id: story.hn_id, title: story.title, our_score: story.hcb_weighted_mean, kagi_dir: kagiDir, divergence });

      await logEvent(db, {
        hn_id: story.hn_id,
        event_type: 'kagi_audit',
        severity: divergence === 'major' ? 'warn' : 'info',
        message: `Kagi score audit: ${divergence} (ours=${story.hcb_weighted_mean.toFixed(3)}, kagi=${kagiDir})`,
        details: { audit_type: 'score_audit', our_score: story.hcb_weighted_mean, kagi_direction: kagiDir, divergence, kagi_output: resp.data.output.slice(0, 500), tokens: resp.data.tokens },
      });
    } catch (err) {
      if (err instanceof KagiRateLimitError) {
        await setKagiBackoff(env, 30);
        await logEvent(db, { event_type: 'kagi_audit', severity: 'warn', message: 'Kagi rate limited — backoff 30min', details: { audit_type: 'score_audit', backoff_minutes: 30 } });
        break;
      }
      console.error(`[kagi_score_audit] Error for hn_id=${story.hn_id}:`, err);
    }
  }

  const counts = { aligned: 0, minor: 0, major: 0 };
  for (const r of results) counts[r.divergence as keyof typeof counts]++;

  return json({ sweep: 'kagi_score_audit', audited: results.length, counts, results, description: `Audited ${results.length} stories: ${counts.aligned} aligned, ${counts.minor} minor, ${counts.major} major divergence` });
}

// ─── Sweep: kagi_url_check ───────────────────────────────────────────────────

/** Dead URL detection via Kagi Summarizer. */
export async function sweepKagiUrlCheck({ db, env, url }: SweepContext): Promise<Response> {
  const apiKey = env.KAGI_API_KEY;
  if (!apiKey) return json({ error: 'KAGI_API_KEY not configured' }, 500);
  const backoffUntil = await checkKagiBackoff(env);
  if (backoffUntil) return json({ sweep: 'kagi_url_check', skipped: true, backoff_until: backoffUntil, description: 'Kagi API in backoff period' });

  const limit = parseLimit(url, 20, 100);

  const { results: stories } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.url, s.domain
       FROM stories s
       WHERE s.eval_status = 'done'
         AND s.url IS NOT NULL
         AND s.evaluated_at < datetime('now', '-7 days')
         AND NOT EXISTS (
           SELECT 1 FROM events e
           WHERE e.hn_id = s.hn_id
             AND e.event_type = 'kagi_audit'
             AND json_extract(e.details, '$.audit_type') = 'url_check'
             AND e.created_at > datetime('now', '-30 days')
         )
       ORDER BY s.hn_score DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; title: string; url: string; domain: string | null }>();

  if (stories.length === 0) return json({ sweep: 'kagi_url_check', checked: 0, description: 'No URLs due for checking' });

  const results: { hn_id: number; url: string; status: 'alive' | 'dead' | 'degraded' | 'error'; detail: string }[] = [];
  const deadSignals = ['404', 'not found', 'page not found', 'access denied', 'no longer available', 'has been removed', 'does not exist'];

  for (const story of stories) {
    try {
      const resp = await kagiSummarize(apiKey, story.url);
      const output = resp.data.output.toLowerCase();
      const outputLen = resp.data.output.length;

      let status: 'alive' | 'dead' | 'degraded' = 'alive';
      if (deadSignals.some(sig => output.includes(sig))) {
        status = 'dead';
      } else if (outputLen < 100) {
        status = 'degraded';
      }

      results.push({ hn_id: story.hn_id, url: story.url, status, detail: resp.data.output.slice(0, 200) });

      await logEvent(db, {
        hn_id: story.hn_id,
        event_type: 'kagi_audit',
        severity: status === 'dead' ? 'warn' : 'info',
        message: `Kagi URL check: ${status} (${story.domain || story.url})`,
        details: { audit_type: 'url_check', url: story.url, status, summary_length: outputLen, tokens: resp.data.tokens },
      });
    } catch (err) {
      if (err instanceof KagiRateLimitError) {
        await setKagiBackoff(env, 30);
        await logEvent(db, { event_type: 'kagi_audit', severity: 'warn', message: 'Kagi rate limited — backoff 30min', details: { audit_type: 'url_check', backoff_minutes: 30 } });
        break;
      }
      results.push({ hn_id: story.hn_id, url: story.url, status: 'error', detail: String(err) });
    }
  }

  const counts = { alive: 0, dead: 0, degraded: 0, error: 0 };
  for (const r of results) counts[r.status]++;

  return json({ sweep: 'kagi_url_check', checked: results.length, counts, results: results.slice(0, 50), description: `Checked ${results.length} URLs: ${counts.alive} alive, ${counts.dead} dead, ${counts.degraded} degraded, ${counts.error} errors` });
}

// ─── Sweep: kagi_domain_enrich ───────────────────────────────────────────────

/** Enrich domain DCP with Kagi news intelligence. Background (202). */
export async function sweepKagiDomainEnrich({ db, env, ctx, url }: SweepContext): Promise<Response> {
  const apiKey = env.KAGI_API_KEY;
  if (!apiKey) return json({ error: 'KAGI_API_KEY not configured' }, 500);
  const backoffUntil = await checkKagiBackoff(env);
  if (backoffUntil) return json({ sweep: 'kagi_domain_enrich', skipped: true, backoff_until: backoffUntil, description: 'Kagi API in backoff period' });

  const limit = parseLimit(url, 10, 50);

  const { results: domains } = await db
    .prepare(
      `SELECT da.domain
       FROM domain_aggregates da
       WHERE da.evaluated_count >= 3
         AND NOT EXISTS (
           SELECT 1 FROM domain_dcp dd
           WHERE dd.domain = da.domain
             AND json_extract(dd.dcp_json, '$.kagi_news') IS NOT NULL
         )
       ORDER BY da.evaluated_count DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ domain: string }>();

  if (domains.length === 0) return json({ sweep: 'kagi_domain_enrich', enriched: 0, description: 'No domains need enrichment' }, 200);

  ctx.waitUntil((async () => {
    let enriched = 0;
    for (const { domain } of domains) {
      try {
        const resp = await kagiEnrichNews(apiKey, domain);
        const articles = resp.data.slice(0, 5).map(a => ({ title: a.title, url: a.url, published: a.published }));

        // Read existing DCP, merge kagi_news
        const existing = await db
          .prepare(`SELECT dcp_json FROM domain_dcp WHERE domain = ?`)
          .bind(domain)
          .first<{ dcp_json: string }>();

        let dcp: Record<string, unknown> = {};
        if (existing?.dcp_json) {
          try { dcp = JSON.parse(existing.dcp_json); } catch { /* fresh */ }
        }
        dcp.kagi_news = { articles, fetched_at: new Date().toISOString() };

        await db
          .prepare(
            `INSERT INTO domain_dcp (domain, dcp_json, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(domain) DO UPDATE SET dcp_json = excluded.dcp_json, updated_at = excluded.updated_at`
          )
          .bind(domain, JSON.stringify(dcp))
          .run();

        enriched++;

        await logEvent(db, {
          event_type: 'kagi_audit',
          severity: 'info',
          message: `Kagi domain enrich: ${domain} (${articles.length} articles)`,
          details: { audit_type: 'domain_enrich', domain, article_count: articles.length },
        });
      } catch (err) {
        if (err instanceof KagiRateLimitError) {
          await setKagiBackoff(env, 30);
          await logEvent(db, { event_type: 'kagi_audit', severity: 'warn', message: 'Kagi rate limited — backoff 30min', details: { audit_type: 'domain_enrich', backoff_minutes: 30 } });
          break;
        }
        console.error(`[kagi_domain_enrich] Error for ${domain}:`, err);
      }
    }
  })());

  return json({ sweep: 'kagi_domain_enrich', queued: domains.length, description: `Enriching ${domains.length} domain(s) in background` }, 202);
}

// ─── Sweep: kagi_calibration_oracle ──────────────────────────────────────────

/** Validate calibration set against Kagi FastGPT UDHR assessment. */
export async function sweepKagiCalibrationOracle({ db, env, url }: SweepContext): Promise<Response> {
  const apiKey = env.KAGI_API_KEY;
  if (!apiKey) return json({ error: 'KAGI_API_KEY not configured' }, 500);
  const backoffUntil = await checkKagiBackoff(env);
  if (backoffUntil) return json({ sweep: 'kagi_calibration_oracle', skipped: true, backoff_until: backoffUntil, description: 'Kagi API in backoff period' });

  const results: {
    slot: string; label: string; expectedClass: string;
    expectedMin: number; expectedMax: number;
    kagi_dir: DirectionalAssessment; kagi_numeric: number;
    class_match: boolean;
  }[] = [];

  for (const cal of CALIBRATION_SET) {
    try {
      const query = `Evaluate the UDHR (Universal Declaration of Human Rights) implications of ${cal.url} ("${cal.label}"). Is this content rights-positive, neutral, or rights-negative from a human rights perspective?`;
      const resp = await kagiFastGPT(apiKey, query);
      const kagiDir = parseDirectionalAssessment(resp.data.output);
      const kagiNum = assessmentToNumeric(kagiDir);

      // Check if Kagi's direction matches expected class
      const classMatch =
        (cal.expectedClass === 'EP' && kagiDir === 'positive') ||
        (cal.expectedClass === 'EN' && kagiDir === 'neutral') ||
        (cal.expectedClass === 'EX' && kagiDir === 'negative');

      results.push({
        slot: cal.slot, label: cal.label, expectedClass: cal.expectedClass,
        expectedMin: cal.expectedMeanMin, expectedMax: cal.expectedMeanMax,
        kagi_dir: kagiDir, kagi_numeric: kagiNum, class_match: classMatch,
      });
    } catch (err) {
      if (err instanceof KagiRateLimitError) {
        await setKagiBackoff(env, 30);
        await logEvent(db, { event_type: 'kagi_audit', severity: 'warn', message: 'Kagi rate limited — backoff 30min', details: { audit_type: 'calibration_oracle', backoff_minutes: 30 } });
        break;
      }
      console.error(`[kagi_calibration_oracle] Error for ${cal.slot}:`, err);
    }
  }

  const matched = results.filter(r => r.class_match).length;
  const total = results.length;

  await logEvent(db, {
    event_type: 'kagi_audit',
    severity: matched < 10 ? 'warn' : 'info',
    message: `Kagi calibration oracle: ${matched}/${total} class matches`,
    details: { audit_type: 'calibration_oracle', matched, total, results },
  });

  return json({
    sweep: 'kagi_calibration_oracle',
    matched, total,
    accuracy: total > 0 ? +(matched / total).toFixed(3) : null,
    results,
    description: `Calibration oracle: ${matched}/${total} class matches (${total > 0 ? ((matched / total) * 100).toFixed(1) : 0}%)`,
  });
}

// ─── Sweep: backfill_country ────────────────────────────────────────────────

/** Backfill source_country from domain TLD heuristics. */
export async function sweepBackfillCountry({ db, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url, 500, 5000);

  // ccTLD → country name mapping (ISO 3166-1 common TLDs)
  const TLD_COUNTRY: Record<string, string> = {
    'co.uk': 'United Kingdom', 'org.uk': 'United Kingdom', 'ac.uk': 'United Kingdom',
    'com.au': 'Australia', 'org.au': 'Australia',
    'co.nz': 'New Zealand',
    'co.jp': 'Japan', 'or.jp': 'Japan',
    'co.kr': 'South Korea',
    'co.in': 'India', 'org.in': 'India',
    'co.za': 'South Africa',
    'com.br': 'Brazil',
    'com.mx': 'Mexico',
    'co.il': 'Israel',
    uk: 'United Kingdom', de: 'Germany', fr: 'France', it: 'Italy', es: 'Spain',
    nl: 'Netherlands', be: 'Belgium', at: 'Austria', ch: 'Switzerland',
    se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', ie: 'Ireland',
    pt: 'Portugal', pl: 'Poland', cz: 'Czechia', ro: 'Romania', hu: 'Hungary',
    gr: 'Greece', bg: 'Bulgaria', hr: 'Croatia', sk: 'Slovakia', si: 'Slovenia',
    lt: 'Lithuania', lv: 'Latvia', ee: 'Estonia',
    ru: 'Russia', ua: 'Ukraine', by: 'Belarus',
    jp: 'Japan', kr: 'South Korea', cn: 'China', tw: 'Taiwan', hk: 'Hong Kong',
    sg: 'Singapore', my: 'Malaysia', ph: 'Philippines', th: 'Thailand', vn: 'Vietnam',
    id: 'Indonesia', in: 'India', pk: 'Pakistan', bd: 'Bangladesh', lk: 'Sri Lanka',
    au: 'Australia', nz: 'New Zealand',
    ca: 'Canada', mx: 'Mexico', br: 'Brazil', ar: 'Argentina', cl: 'Chile', co: 'Colombia',
    za: 'South Africa', ng: 'Nigeria', ke: 'Kenya', gh: 'Ghana', tz: 'Tanzania',
    eg: 'Egypt', ma: 'Morocco', tn: 'Tunisia',
    il: 'Israel', ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar',
    tr: 'Turkey', ir: 'Iran',
  };

  function countryFromDomain(domain: string): string | null {
    const parts = domain.toLowerCase().split('.');
    if (parts.length < 2) return null;
    // Try compound TLD first (co.uk, com.au, etc.)
    if (parts.length >= 3) {
      const compound = parts.slice(-2).join('.');
      if (TLD_COUNTRY[compound]) return TLD_COUNTRY[compound];
    }
    // Try single TLD
    const tld = parts[parts.length - 1];
    return TLD_COUNTRY[tld] || null;
  }

  // Get stories with domains but no source_country
  const { results: stories } = await db
    .prepare(
      `SELECT hn_id, domain FROM stories
       WHERE domain IS NOT NULL
         AND source_country IS NULL
         AND hn_id > 0
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; domain: string }>();

  if (stories.length === 0) return json({ sweep: 'backfill_country', updated: 0, description: 'No stories need country backfill' });

  let updated = 0;
  const countryCounts: Record<string, number> = {};
  const batch: D1PreparedStatement[] = [];

  for (const story of stories) {
    const country = countryFromDomain(story.domain);
    if (country) {
      batch.push(
        db.prepare(`UPDATE stories SET source_country = ? WHERE hn_id = ?`).bind(country, story.hn_id)
      );
      countryCounts[country] = (countryCounts[country] || 0) + 1;
      updated++;
    }
  }

  if (batch.length > 0) {
    await safeBatch(db, batch);
  }

  const topCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return json({
    sweep: 'backfill_country',
    scanned: stories.length,
    updated,
    skipped: stories.length - updated,
    top_countries: topCountries,
    description: `Backfilled ${updated}/${stories.length} stories with TLD-derived country. Top: ${topCountries.slice(0, 5).map(([c, n]) => `${c}(${n})`).join(', ')}`,
  });
}

// ─── Sweep: backfill_rs ─────────────────────────────────────────────────────

/** Backfill Rights Salience (RS) from rater_scores for full evals missing rs_score. */
export async function sweepBackfillRs({ db, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url, 200, 2000);

  // Find full-eval stories missing rs_score
  const { results: stories } = await db
    .prepare(
      `SELECT DISTINCT re.hn_id, re.eval_model
       FROM rater_evals re
       WHERE re.eval_status = 'done'
         AND re.prompt_mode = 'full'
         AND re.rs_score IS NULL
         AND re.hn_id > 0
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; eval_model: string }>();

  if (!stories || stories.length === 0) {
    return json({ sweep: 'backfill_rs', scanned: 0, updated: 0, description: 'No full evals missing RS' });
  }

  let updated = 0;
  const rsBatch: D1PreparedStatement[] = [];

  for (const { hn_id, eval_model } of stories) {
    // Fetch per-section scores for this rater eval
    const { results: scores } = await db
      .prepare(
        `SELECT section, final, editorial, structural, evidence
         FROM rater_scores
         WHERE hn_id = ? AND eval_model = ?`
      )
      .bind(hn_id, eval_model)
      .all<{ section: string; final: number | null; editorial: number | null; structural: number | null; evidence: string | null }>();

    if (!scores || scores.length === 0) continue;

    const evalScores: EvalScore[] = scores.map(s => ({
      section: s.section,
      final: s.final,
      editorial: s.editorial,
      structural: s.structural,
      evidence: s.evidence,
      directionality: [],
      note: '',
      editorial_note: '',
      structural_note: '',
      combined: null,
      context_modifier: null,
      witness_facts: [],
      witness_inferences: [],
    }));

    const rs = computeRightsSalience(evalScores);

    // Update rater_evals
    rsBatch.push(
      db.prepare(
        `UPDATE rater_evals SET rs_score = ?, rs_breadth = ?, rs_depth = ?, rs_intensity = ?
         WHERE hn_id = ? AND eval_model = ?`
      ).bind(rs.rs_score, rs.rs_breadth, rs.rs_depth, rs.rs_intensity, hn_id, eval_model)
    );

    // Update stories (only if this is the story's primary eval_model)
    rsBatch.push(
      db.prepare(
        `UPDATE stories SET rs_score = ?, rs_breadth = ?, rs_depth = ?, rs_intensity = ?
         WHERE hn_id = ? AND eval_model = ? AND rs_score IS NULL`
      ).bind(rs.rs_score, rs.rs_breadth, rs.rs_depth, rs.rs_intensity, hn_id, eval_model)
    );

    updated++;
  }

  if (rsBatch.length > 0) {
    await safeBatch(db, rsBatch);
  }

  // Compute distribution summary for the response
  const { results: dist } = await db
    .prepare(
      `SELECT
         ROUND(AVG(rs_score), 4) as mean,
         MIN(rs_score) as min,
         MAX(rs_score) as max,
         COUNT(*) as total,
         SUM(CASE WHEN rs_score < 0.01 THEN 1 ELSE 0 END) as below_001,
         SUM(CASE WHEN rs_score < 0.05 THEN 1 ELSE 0 END) as below_005,
         SUM(CASE WHEN rs_score < 0.10 THEN 1 ELSE 0 END) as below_010
       FROM rater_evals
       WHERE rs_score IS NOT NULL AND prompt_mode = 'full' AND hn_id > 0`
    )
    .all();

  return json({
    sweep: 'backfill_rs',
    scanned: stories.length,
    updated,
    distribution: dist?.[0] ?? null,
    description: `Computed RS for ${updated} full evals from rater_scores`,
  });
}

// ─── Sweep: backfill_ac ─────────────────────────────────────────────────────

/** Backfill Accessibility Compliance (AC) from existing CL columns on stories. */
export async function sweepBackfillAc({ db, url }: SweepContext): Promise<Response> {
  const limit = parseLimit(url, 500, 5000);

  const { results: stories } = await db
    .prepare(
      `SELECT hn_id, cl_reading_level, cl_jargon_density, cl_assumed_knowledge
       FROM stories
       WHERE eval_status = 'done' AND hn_id > 0
         AND cl_reading_level IS NOT NULL
         AND ac_score IS NULL
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; cl_reading_level: string; cl_jargon_density: string; cl_assumed_knowledge: string }>();

  if (!stories || stories.length === 0) {
    return json({ sweep: 'backfill_ac', scanned: 0, updated: 0, description: 'No stories missing AC score' });
  }

  const batch: D1PreparedStatement[] = [];
  for (const s of stories) {
    const ac = computeAcScore(s.cl_reading_level, s.cl_jargon_density, s.cl_assumed_knowledge);
    if (ac != null) {
      batch.push(
        db.prepare('UPDATE stories SET ac_score = ? WHERE hn_id = ?').bind(ac, s.hn_id)
      );
    }
  }

  if (batch.length > 0) await safeBatch(db, batch);

  return json({
    sweep: 'backfill_ac',
    scanned: stories.length,
    updated: batch.length,
    description: `Computed AC for ${batch.length} stories from CL columns`,
  });
}

// ─── Sweep: backfill_car ────────────────────────────────────────────────────

/** Backfill Consent Architecture Rating (CAR) from browser audit data. */
export async function sweepBackfillCar({ db }: SweepContext): Promise<Response> {
  const { results: audits } = await db
    .prepare(
      `SELECT domain, has_https, has_hsts, has_csp, tracker_count, has_lang_attr, has_skip_nav
       FROM domain_browser_audit
       WHERE audit_error IS NULL AND car_score IS NULL`
    )
    .all<{ domain: string; has_https: number | null; has_hsts: number | null; has_csp: number | null; tracker_count: number | null; has_lang_attr: number | null; has_skip_nav: number | null }>();

  if (!audits || audits.length === 0) {
    return json({ sweep: 'backfill_car', scanned: 0, updated: 0, description: 'No audits missing CAR score' });
  }

  const batch: D1PreparedStatement[] = [];
  for (const a of audits) {
    const car = computeCarScore(a);
    batch.push(
      db.prepare('UPDATE domain_browser_audit SET car_score = ? WHERE domain = ?').bind(car, a.domain)
    );
    // Also update domain_aggregates if row exists
    batch.push(
      db.prepare('UPDATE domain_aggregates SET car_score = ? WHERE domain = ?').bind(car, a.domain)
    );
  }

  if (batch.length > 0) await safeBatch(db, batch);

  return json({
    sweep: 'backfill_car',
    scanned: audits.length,
    updated: audits.length,
    description: `Computed CAR for ${audits.length} domains from browser audit data`,
  });
}

// ─── Sweep: test_retest ────────────────────────────────────────────────────

/**
 * Phase 1 (dispatch): Find stories with full evals >= min_days old, store
 * original scores in test_retest_pairs, delete old rater data, re-enqueue.
 * Phase 2 (check): Fill in retest scores from completed re-evaluations.
 *
 * Usage:
 *   sweep=test_retest              — dispatch new re-evaluations (default)
 *   sweep=test_retest&phase=check  — collect completed re-eval scores
 *   sweep=test_retest&min_days=14  — minimum age gap (default 14)
 */
export async function sweepTestRetest({ db, env, url }: SweepContext): Promise<Response> {
  const phase = url.searchParams.get('phase') || 'dispatch';
  const limit = parseLimit(url, 50, 100);
  const minDays = parseInt(url.searchParams.get('min_days') || '14', 10) || 14;

  if (phase === 'check') {
    // Phase 2: collect completed re-evaluations
    const pending = await db.prepare(
      `SELECT trp.id, trp.hn_id, trp.eval_model,
              re.hcb_weighted_mean as retest_score,
              re.hcb_editorial_mean as retest_editorial,
              re.hcb_structural_mean as retest_structural,
              re.hcb_setl as retest_setl,
              re.evaluated_at as retest_evaluated_at
       FROM test_retest_pairs trp
       INNER JOIN rater_evals re ON re.hn_id = trp.hn_id AND re.eval_model = trp.eval_model
         AND re.eval_status = 'done' AND re.prompt_mode = 'full'
       WHERE trp.status = 'pending'
       LIMIT ?`
    ).bind(limit).all<{
      id: number; hn_id: number; eval_model: string;
      retest_score: number | null; retest_editorial: number | null;
      retest_structural: number | null; retest_setl: number | null;
      retest_evaluated_at: string | null;
    }>();

    const batch: D1PreparedStatement[] = [];
    for (const row of pending.results) {
      batch.push(db.prepare(
        `UPDATE test_retest_pairs
         SET retest_score = ?, retest_editorial = ?, retest_structural = ?,
             retest_setl = ?, retest_evaluated_at = ?, status = 'done'
         WHERE id = ?`
      ).bind(
        row.retest_score, row.retest_editorial, row.retest_structural,
        row.retest_setl, row.retest_evaluated_at, row.id
      ));
    }
    if (batch.length > 0) await safeBatch(db, batch);

    // Compute summary stats if we have completed pairs
    const stats = await db.prepare(
      `SELECT COUNT(*) as n,
              ROUND(AVG(ABS(original_score - retest_score)), 4) as mae,
              ROUND(AVG((original_score - retest_score) * (original_score - retest_score)), 6) as mse
       FROM test_retest_pairs WHERE status = 'done'`
    ).first<{ n: number; mae: number | null; mse: number | null }>();

    return json({
      sweep: 'test_retest', phase: 'check',
      collected: pending.results.length,
      total_done: stats?.n ?? 0,
      mae: stats?.mae,
      rmse: stats?.mse != null ? Math.round(Math.sqrt(stats.mse) * 10000) / 10000 : null,
      description: `Collected ${pending.results.length} re-eval results (${stats?.n ?? 0} total pairs done)`,
    });
  }

  // Phase 1: dispatch re-evaluations
  // Find stories with a full eval from the primary model, old enough for retest
  const candidates = await db.prepare(
    `SELECT re.hn_id, re.eval_model, re.eval_provider,
            re.hcb_weighted_mean as score, re.hcb_editorial_mean as editorial,
            re.hcb_structural_mean as structural, re.hcb_setl as setl,
            re.evaluated_at
     FROM rater_evals re
     INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
     LEFT JOIN test_retest_pairs trp ON trp.hn_id = re.hn_id AND trp.eval_model = re.eval_model
     WHERE re.eval_status = 'done'
       AND re.prompt_mode = 'full'
       AND re.hn_id > 0
       AND re.hcb_weighted_mean IS NOT NULL
       AND re.evaluated_at < datetime('now', '-' || ? || ' days')
       AND trp.id IS NULL
     ORDER BY RANDOM()
     LIMIT ?`
  ).bind(minDays, limit).all<{
    hn_id: number; eval_model: string; eval_provider: string;
    score: number; editorial: number | null; structural: number | null;
    setl: number | null; evaluated_at: string;
  }>();

  if (candidates.results.length === 0) {
    return json({ sweep: 'test_retest', phase: 'dispatch', dispatched: 0,
      description: `No eligible stories (need full eval >= ${minDays} days old, not already in test_retest_pairs)` });
  }

  // Store originals and delete old rater data
  const insertBatch: D1PreparedStatement[] = [];
  const deleteBatch: D1PreparedStatement[] = [];
  const resetBatch: D1PreparedStatement[] = [];

  for (const c of candidates.results) {
    // Store original scores
    insertBatch.push(db.prepare(
      `INSERT OR IGNORE INTO test_retest_pairs
       (hn_id, eval_model, original_score, original_editorial, original_structural,
        original_setl, original_evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(c.hn_id, c.eval_model, c.score, c.editorial, c.structural, c.setl, c.evaluated_at));

    // Delete old rater data so the UNIQUE constraint allows re-insert
    deleteBatch.push(
      db.prepare('DELETE FROM rater_scores WHERE hn_id = ? AND eval_model = ?').bind(c.hn_id, c.eval_model),
      db.prepare('DELETE FROM rater_witness WHERE hn_id = ? AND eval_model = ?').bind(c.hn_id, c.eval_model),
      db.prepare('DELETE FROM rater_evals WHERE hn_id = ? AND eval_model = ?').bind(c.hn_id, c.eval_model),
    );

    // Reset story to pending for re-evaluation
    resetBatch.push(db.prepare(
      `UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status = 'done'`
    ).bind(c.hn_id));
  }

  await safeBatch(db, insertBatch);
  await safeBatch(db, deleteBatch);
  await safeBatch(db, resetBatch);

  // Trigger re-enqueue
  await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, undefined, env as unknown as Record<string, any>);

  await logEvent(db, {
    event_type: 'trigger',
    severity: 'info',
    message: `Sweep: dispatched ${candidates.results.length} test-retest re-evaluations (min_days=${minDays})`,
    details: { sweep: 'test_retest', dispatched: candidates.results.length, min_days: minDays },
  });

  return json({
    sweep: 'test_retest', phase: 'dispatch',
    dispatched: candidates.results.length,
    min_days: minDays,
    description: `Stored originals and re-enqueued ${candidates.results.length} stories for same-model re-evaluation`,
  });
}
