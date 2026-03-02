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
import { refreshAllDomainAggregates, backfillPtScores, refreshAllUserAggregates, refreshUserAggregate } from '../src/lib/eval-write';
import { refreshArticlePairStats } from '../src/lib/db-analytics';
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
