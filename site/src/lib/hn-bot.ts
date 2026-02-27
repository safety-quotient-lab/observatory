/**
 * HN Bot: Hacker News crawling, story management, and queue dispatch.
 *
 * Extracted from cron.ts to separate HN-specific logic from eval pipeline orchestration.
 * This module handles:
 * - Fetching story lists from HN Firebase API
 * - Story upsert with dedup against D1
 * - Feed membership tracking
 * - Rank snapshots
 * - Score/comment refresh via /v0/updates.json
 * - Comment crawling (depth 0+1)
 * - User profile crawling
 * - Domain circuit breaker
 * - Queue dispatch with content pre-fetching
 * - Re-evaluation triggers for viral stories
 */

import { extractDomain, markSkipped, fetchUrlContent, getEnabledFreeModels, getModelQueue } from './shared-eval';
import { cleanHtml, hasReadableText } from './html-clean';
import { classifyContent } from './content-gate';
import { logEvent } from './events';

// ─── Types ───

export interface HNItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  by?: string;
  time?: number;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
}

export interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
  eval_model?: string;
  eval_provider?: string;
  prompt_mode?: 'full' | 'light';
}

export interface DomainHealth {
  failures: number;
  lastFailure: string;
  lastError: string;
}

export interface CrawlResult {
  stories_found: number;
  stories_new: number;
  feeds: Record<string, number>;
  score_refresh: { updates: number; sweep: number };
  comments: number;
  users: number;
  re_evals: number;
  flagged_check: { checked: number; flagged: number };
  enqueued: boolean;
  duration_ms: number;
}

// ─── Constants ───

const DOMAIN_FAIL_THRESHOLD = 5;
const DOMAIN_FAIL_TTL = 86400; // 24h

const TOP_PAGES = 7;
const ITEMS_PER_PAGE = 30;

// ─── HN API helpers ───

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

/**
 * Fetch item details in parallel batches.
 * ~18 concurrent requests per batch ≈ 60% of ~30 req/s safe limit.
 */
export async function fetchItemsBatched(ids: number[], batchSize = 18): Promise<HNItem[]> {
  const results: HNItem[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const items = await Promise.all(
      batch.map(async (id): Promise<HNItem | null> => {
        try {
          return await fetchJson<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch {
          return null;
        }
      })
    );
    for (const item of items) {
      if (item) results.push(item);
    }
  }
  return results;
}

// ─── Domain circuit breaker ───

export async function getDomainHealth(kv: KVNamespace, domain: string): Promise<DomainHealth | null> {
  try {
    return await kv.get(`domain-health:${domain}`, 'json') as DomainHealth | null;
  } catch { return null; }
}

export async function recordDomainFailure(kv: KVNamespace, domain: string, error: string): Promise<DomainHealth> {
  const existing = await getDomainHealth(kv, domain);
  const state: DomainHealth = {
    failures: (existing?.failures ?? 0) + 1,
    lastFailure: new Date().toISOString(),
    lastError: error.slice(0, 200),
  };
  await kv.put(`domain-health:${domain}`, JSON.stringify(state), { expirationTtl: DOMAIN_FAIL_TTL });
  return state;
}

export async function clearDomainFailures(kv: KVNamespace, domain: string): Promise<void> {
  try { await kv.delete(`domain-health:${domain}`); } catch { /* ignore */ }
}

export function isDomainCircuitOpen(health: DomainHealth | null): boolean {
  return health !== null && health.failures >= DOMAIN_FAIL_THRESHOLD;
}

// ─── Score refresh ───

export async function refreshFromUpdates(db: D1Database): Promise<number> {
  const updates = await fetchJson<{ items: number[]; profiles: string[] }>(
    'https://hacker-news.firebaseio.com/v0/updates.json'
  );

  if (!updates.items || updates.items.length === 0) {
    console.log('[score-refresh] No updated items from HN');
    return 0;
  }

  console.log(`[score-refresh] HN reports ${updates.items.length} updated items`);

  // Find which of these items we have in our DB (batched for D1 100-param limit)
  const ourIds: number[] = [];
  for (let i = 0; i < updates.items.length; i += 100) {
    const chunk = updates.items.slice(i, i + 100);
    const { results } = await db
      .prepare(
        `SELECT hn_id FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<{ hn_id: number }>();
    for (const r of results) ourIds.push(r.hn_id);
  }

  if (ourIds.length === 0) {
    console.log('[score-refresh] No tracked stories in updates list');
    return 0;
  }

  console.log(`[score-refresh] ${ourIds.length} tracked stories need refresh`);

  const items = await fetchItemsBatched(ourIds);

  // Separate flagged/deleted items from live ones
  const flaggedItems = items.filter(item => item.dead && !item.deleted);
  const deletedItems = items.filter(item => item.deleted);
  const liveItems = items.filter(item => !item.dead && !item.deleted);

  const stmts: D1PreparedStatement[] = [];

  // Mark flagged and deleted stories as skipped with distinct errors
  for (const item of flaggedItems) {
    stmts.push(db.prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'Story flagged/killed on HN',
         gate_category = 'hn_removed', gate_confidence = 1.0
       WHERE hn_id = ? AND eval_status IN ('pending', 'queued', 'skipped')`
    ).bind(item.id));
  }
  for (const item of deletedItems) {
    stmts.push(db.prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'Story deleted on HN',
         gate_category = 'hn_removed', gate_confidence = 1.0
       WHERE hn_id = ? AND eval_status IN ('pending', 'queued', 'skipped')`
    ).bind(item.id));
  }
  const flaggedCount = flaggedItems.length + deletedItems.length;
  if (flaggedCount > 0) {
    console.log(`[score-refresh] ${flaggedCount} stories now flagged/deleted on HN (${flaggedItems.length} flagged, ${deletedItems.length} deleted)`);
  }

  // Update scores for live items
  for (const item of liveItems) {
    if (item.score !== undefined || item.descendants !== undefined) {
      stmts.push(
        db.prepare(`UPDATE stories SET hn_score = ?, hn_comments = ? WHERE hn_id = ?`)
          .bind(item.score ?? null, item.descendants ?? null, item.id)
      );
    }
  }

  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
  }

  return liveItems.filter(item => item.score !== undefined || item.descendants !== undefined).length;
}

export async function refreshRecentStories(db: D1Database): Promise<number> {
  const { results: recentStories } = await db
    .prepare(
      `SELECT hn_id FROM stories
       WHERE hn_time > unixepoch('now', '-48 hours')
       ORDER BY hn_time DESC
       LIMIT 200`
    )
    .all<{ hn_id: number }>();

  if (recentStories.length === 0) return 0;

  const ids = recentStories.map(r => r.hn_id);
  const items = await fetchItemsBatched(ids);

  const stmts = items
    .filter(item => item.score !== undefined || item.descendants !== undefined)
    .map(item =>
      db
        .prepare(`UPDATE stories SET hn_score = ?, hn_comments = ? WHERE hn_id = ?`)
        .bind(item.score ?? null, item.descendants ?? null, item.id)
    );

  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
  }

  return stmts.length;
}

// ─── Comment crawling ───

export async function crawlComments(db: D1Database): Promise<number> {
  const { results: stories } = await db
    .prepare(
      `SELECT s.hn_id FROM stories s
       WHERE s.eval_status = 'done'
         AND s.hn_comments > 5
         AND s.evaluated_at >= datetime('now', '-7 days')
         AND s.hn_id NOT IN (SELECT DISTINCT hn_id FROM story_comments)
       ORDER BY s.hn_comments DESC
       LIMIT 5`
    )
    .all<{ hn_id: number }>();

  if (stories.length === 0) return 0;

  let totalCrawled = 0;

  for (const story of stories) {
    try {
      const item = await fetchJson<{
        id: number;
        kids?: number[];
      }>(`https://hacker-news.firebaseio.com/v0/item/${story.hn_id}.json`);

      if (!item.kids || item.kids.length === 0) continue;

      // Fetch top-level comments (up to 20)
      const topCommentIds = item.kids.slice(0, 20);
      const topComments = await fetchItemsBatched(topCommentIds);

      const stmts: D1PreparedStatement[] = [];

      // Insert top-level comments (depth 0)
      const validTopComments = topComments.filter(c => c.text && !c.dead && !c.deleted);
      for (const c of validTopComments) {
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO story_comments (hn_id, comment_id, parent_id, author, text, time, depth, hn_score)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
            )
            .bind(
              story.hn_id,
              c.id,
              story.hn_id,
              c.by || null,
              c.text || null,
              c.time || null,
              c.score ?? null
            )
        );
      }

      // Crawl depth-1 replies for top comments with kids
      const replyIds: number[] = [];
      const replyParents = new Map<number, number>();
      for (const c of validTopComments) {
        if (c.kids && c.kids.length > 0) {
          for (const kid of c.kids.slice(0, 5)) {
            replyIds.push(kid);
            replyParents.set(kid, c.id);
          }
        }
      }

      if (replyIds.length > 0) {
        const replies = await fetchItemsBatched(replyIds);
        for (const r of replies) {
          if (!r.text || r.dead || r.deleted) continue;
          stmts.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO story_comments (hn_id, comment_id, parent_id, author, text, time, depth, hn_score)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
              )
              .bind(
                story.hn_id,
                r.id,
                replyParents.get(r.id) || story.hn_id,
                r.by || null,
                r.text || null,
                r.time || null,
                r.score ?? null
              )
          );
        }
      }

      if (stmts.length > 0) {
        for (let i = 0; i < stmts.length; i += 100) {
          await db.batch(stmts.slice(i, i + 100));
        }
        totalCrawled += stmts.length;
      }
    } catch (err) {
      console.error(`[comments] Failed for hn_id=${story.hn_id}:`, err);
    }
  }

  return totalCrawled;
}

// ─── User profile crawling ───

export async function crawlUserProfiles(db: D1Database): Promise<number> {
  const { results: users } = await db
    .prepare(
      `SELECT DISTINCT s.hn_by FROM stories s
       WHERE s.hn_by IS NOT NULL
         AND s.hn_by NOT IN (
           SELECT username FROM hn_users WHERE cached_at >= datetime('now', '-7 days')
         )
       ORDER BY s.hn_time DESC
       LIMIT 20`
    )
    .all<{ hn_by: string }>();

  if (users.length === 0) return 0;

  const profiles = await Promise.all(
    users.map(async (u): Promise<{ username: string; karma: number | null; created: number | null; about: string | null } | null> => {
      try {
        const data = await fetchJson<{ id: string; karma?: number; created?: number; about?: string }>(
          `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(u.hn_by)}.json`
        );
        if (!data) return null;
        return {
          username: data.id,
          karma: data.karma ?? null,
          created: data.created ?? null,
          about: data.about?.slice(0, 2000) ?? null,
        };
      } catch {
        return null;
      }
    })
  );

  const stmts = profiles
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map(p =>
      db
        .prepare(
          `INSERT INTO hn_users (username, karma, created, about, cached_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(username) DO UPDATE SET karma = ?, created = ?, about = ?, cached_at = datetime('now')`
        )
        .bind(p.username, p.karma, p.created, p.about, p.karma, p.created, p.about)
    );

  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
  }

  return stmts.length;
}

// ─── Adaptive evaluation depth ───

/**
 * Determine how deeply to evaluate a story based on engagement signals.
 *
 * - 'multi' : high-signal (score≥200 or comments≥100) — primary model only,
 *             free models catch up via dispatchFreeModelEvals within 1 cron cycle
 * - 'full'  : medium-signal (score≥50) — primary model only, no light preview
 * - 'light' : low-signal — dual-dispatch (primary + Workers AI light eval for
 *             fast feed presence via the ~lite label)
 */
export function determineEvalDepth(
  story: { hn_score: number | null; hn_comments: number | null }
): 'light' | 'full' | 'multi' {
  const score = story.hn_score ?? 0;
  const comments = story.hn_comments ?? 0;
  if (score >= 200 || comments >= 100) return 'multi';
  if (score >= 50) return 'full';
  return 'light';
}

// ─── Queue dispatch ───

export async function enqueueForEvaluation(
  db: D1Database,
  queue: Queue,
  kv: KVNamespace,
  lightQueue?: Queue,
): Promise<void> {
  const limit = 100;
  console.log(`[queue] Dispatching up to ${limit} pending stories`);

  const { results: pending } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_text, hn_score, hn_comments FROM stories
       WHERE eval_status = 'pending'
         AND (url IS NOT NULL OR hn_text IS NOT NULL)
       ORDER BY
         CASE WHEN hn_rank IS NOT NULL THEN 0 ELSE 1 END,
         hn_rank ASC,
         (
           COALESCE(hn_score, 0) / 500.0
           + 0.3 * CASE
              WHEN hn_score IS NOT NULL AND hn_comments IS NOT NULL AND (hn_score + hn_comments) > 0
              THEN ABS(CAST(hn_comments - hn_score AS REAL) / (hn_comments + hn_score))
              ELSE 0
            END
         ) DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{
      hn_id: number;
      url: string | null;
      title: string;
      domain: string | null;
      hn_text: string | null;
      hn_score: number | null;
      hn_comments: number | null;
    }>();

  if (pending.length === 0) {
    console.log('[queue] No pending stories to enqueue');
    return;
  }

  console.log(`[queue] Enqueuing ${pending.length} stories`);

  const messages: { body: QueueMessage }[] = [];
  const enqueuedIds: number[] = [];

  for (const story of pending) {
    // Skip binary content
    if (story.url && /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|iso|mp4|mp3|wav|avi|mov)(\?|$)/i.test(story.url)) {
      await markSkipped(db, story.hn_id, 'Binary/unsupported content type', 'binary_content', 1.0);
      continue;
    }

    // Skip self-posts with no text
    if (!story.url && (!story.hn_text || story.hn_text.length < 50)) {
      await markSkipped(db, story.hn_id, 'No URL and no text', 'no_content', 1.0);
      continue;
    }

    messages.push({
      body: {
        hn_id: story.hn_id,
        url: story.url,
        title: story.title,
        hn_text: story.hn_text,
        domain: story.domain,
      },
    });
    enqueuedIds.push(story.hn_id);
  }

  if (messages.length === 0) {
    console.log('[queue] No valid stories after filtering');
    return;
  }

  // Pre-fetch URL content, run content gate, and store in KV for consumer
  let prefetchedCount = 0;
  let prefetchFailed = 0;
  let circuitBroken = 0;
  let gatedCount = 0;
  const gatedIds = new Set<number>();
  for (const msg of messages) {
    if (!msg.body.url) continue;
    const domain = msg.body.domain;

    // Check domain circuit breaker before fetching
    if (domain) {
      const health = await getDomainHealth(kv, domain);
      if (isDomainCircuitOpen(health)) {
        circuitBroken++;
        continue;
      }
    }

    const kvKey = `content:${msg.body.hn_id}`;
    try {
      const existing = await kv.get(kvKey);
      if (existing) continue;
      const rawHtml = await fetchUrlContent(msg.body.url);

      // Content gate: classify before cleaning/caching
      const gate = classifyContent(rawHtml, msg.body.url);
      if (gate.blocked) {
        gatedCount++;
        gatedIds.add(msg.body.hn_id);
        await markSkipped(db, msg.body.hn_id,
          `Content gate: ${gate.category} (${gate.confidence.toFixed(2)})`,
          gate.category, gate.confidence);
        await logEvent(db, {
          hn_id: msg.body.hn_id, event_type: 'eval_skip', severity: 'info',
          message: `Content gate: ${gate.category}`,
          details: { reason: gate.category, confidence: gate.confidence, signals: gate.signals, phase: 'prefetch' },
        });
        continue;
      }

      // Pre-check: readable text?
      if (!hasReadableText(rawHtml)) {
        gatedIds.add(msg.body.hn_id);
        await markSkipped(db, msg.body.hn_id, 'No readable content (JavaScript-only page)', 'js_rendered', 0.9);
        await logEvent(db, { hn_id: msg.body.hn_id, event_type: 'eval_skip', severity: 'info', message: 'Skipped: no readable text (pre-fetch)', details: { reason: 'no_readable_text', raw_length: rawHtml.length, phase: 'prefetch' } });
        continue;
      }

      const cleaned = cleanHtml(rawHtml, 20000);
      if (cleaned.length >= 50) {
        await kv.put(kvKey, cleaned, { expirationTtl: 86400 });
        prefetchedCount++;
        if (domain) await clearDomainFailures(kv, domain);
      }
    } catch (err) {
      prefetchFailed++;
      if (domain) {
        const health = await recordDomainFailure(kv, domain, String(err));
        if (health.failures === DOMAIN_FAIL_THRESHOLD) {
          console.warn(`[queue] Domain circuit breaker opened for ${domain} (${health.failures} consecutive failures)`);
          await logEvent(db, { event_type: 'fetch_error', severity: 'warn', message: `Domain circuit breaker opened: ${domain}`, details: { domain, failures: health.failures, last_error: health.lastError } });
        }
      }
    }
  }
  if (prefetchedCount > 0 || prefetchFailed > 0 || gatedCount > 0) {
    console.log(`[queue] Pre-fetch: ${prefetchedCount} ok, ${prefetchFailed} failed, ${circuitBroken} circuit-broken, ${gatedCount} gated`);
  }

  // Remove gated stories from queue dispatch
  if (gatedIds.size > 0) {
    const filteredMessages = messages.filter(m => !gatedIds.has(m.body.hn_id));
    const filteredIds = enqueuedIds.filter(id => !gatedIds.has(id));
    messages.length = 0;
    messages.push(...filteredMessages);
    enqueuedIds.length = 0;
    enqueuedIds.push(...filteredIds);
  }

  // Send to queue in batches of 25 (Queue.sendBatch limit)
  for (let i = 0; i < messages.length; i += 25) {
    const batch = messages.slice(i, i + 25);
    await queue.sendBatch(batch);
  }

  // Selective light-dispatch: only low-signal stories get the Workers AI ~lite preview.
  // High/medium-signal stories (full/multi depth) skip the light queue — they'll have
  // a proper primary eval quickly and don't benefit from a transient ~lite label.
  if (lightQueue) {
    for (const msg of messages) {
      const story = pending.find(p => p.hn_id === msg.body.hn_id);
      if (!story || determineEvalDepth(story) !== 'light') continue;
      try {
        await lightQueue.send({
          hn_id: msg.body.hn_id,
          url: msg.body.url,
          title: msg.body.title,
          domain: msg.body.domain,
          prompt_mode: 'light',
        });
      } catch {
        // Non-fatal — light eval is best-effort
      }
    }
  }

  // Mark stories as queued
  const updateStmts = enqueuedIds.map(hnId =>
    db
      .prepare(`UPDATE stories SET eval_status = 'queued' WHERE hn_id = ?`)
      .bind(hnId)
  );

  if (updateStmts.length > 0) {
    await db.batch(updateStmts);
  }

  console.log(`[queue] Enqueued ${messages.length} stories`);
}

// ─── Re-evaluation trigger ───

export async function triggerReEvals(db: D1Database): Promise<number[]> {
  const { results: reEvalCandidates } = await db
    .prepare(
      `SELECT s.hn_id, s.hn_score, s.hn_rank FROM stories s
       WHERE s.eval_status = 'done'
         AND s.evaluated_at < datetime('now', '-6 hours')
         AND s.hcb_weighted_mean IS NOT NULL
         AND (s.hn_rank <= 30 OR s.hn_score >= 300)
         AND (SELECT COUNT(*) FROM eval_history WHERE hn_id = s.hn_id) < 2
       ORDER BY COALESCE(s.hn_rank, 999) ASC, s.hn_score DESC
       LIMIT 5`
    )
    .all<{ hn_id: number; hn_score: number | null; hn_rank: number | null }>();

  if (reEvalCandidates.length === 0) return [];

  const reEvalIds = reEvalCandidates.map(r => r.hn_id);
  for (const id of reEvalIds) {
    await db.prepare(`UPDATE stories SET eval_status = 'pending', eval_error = NULL WHERE hn_id = ?`).bind(id).run();
  }

  return reEvalIds;
}

// ─── Multi-model dispatch ───

/**
 * Dispatch evaluations for enabled free models alongside the primary model.
 * For ALL primary-evaluated stories, check which free models haven't evaluated
 * them yet and enqueue those. Prioritizes recent stories first, then backfills
 * older ones. Runs in batches each cron cycle until full coverage is reached.
 */
export async function dispatchFreeModelEvals(
  db: D1Database,
  env: Record<string, any>,
  limit = 50,
): Promise<{ model: string; dispatched: number }[]> {
  const freeModels = getEnabledFreeModels();
  if (freeModels.length === 0) return [];

  const results: { model: string; dispatched: number }[] = [];

  for (const model of freeModels) {
    // Find ALL stories done by primary that this model hasn't evaluated yet.
    // Recent stories first (most visible), then backfill older ones.
    const { results: candidates } = await db
      .prepare(
        `SELECT s.hn_id, s.url, s.title, s.domain, s.hn_text
         FROM stories s
         WHERE s.eval_status = 'done'
           AND NOT EXISTS (
             SELECT 1 FROM rater_evals re
             WHERE re.hn_id = s.hn_id
               AND re.eval_model = ?
               AND re.eval_status IN ('done', 'queued', 'evaluating', 'pending')
           )
         ORDER BY s.evaluated_at DESC
         LIMIT ?`
      )
      .bind(model.id, limit)
      .all<{
        hn_id: number;
        url: string | null;
        title: string;
        domain: string | null;
        hn_text: string | null;
      }>();

    if (candidates.length === 0) {
      results.push({ model: model.id, dispatched: 0 });
      continue;
    }

    const messages: { body: QueueMessage }[] = [];
    for (const story of candidates) {
      messages.push({
        body: {
          hn_id: story.hn_id,
          url: story.url,
          title: story.title,
          hn_text: story.hn_text,
          domain: story.domain,
          eval_model: model.id,
          eval_provider: model.provider,
          prompt_mode: model.prompt_mode,
        },
      });

      // UPSERT rater_evals as queued (include prompt_mode so shell row is accurate)
      await db
        .prepare(
          `INSERT INTO rater_evals (hn_id, eval_model, eval_provider, eval_status, prompt_mode)
           VALUES (?, ?, ?, 'queued', ?)
           ON CONFLICT(hn_id, eval_model) DO UPDATE SET eval_status = 'queued', prompt_mode = excluded.prompt_mode`
        )
        .bind(story.hn_id, model.id, model.provider, model.prompt_mode ?? 'full')
        .run();
    }

    // Send to per-model queue in batches of 25
    const modelQueue = getModelQueue(model.id, env);
    for (let i = 0; i < messages.length; i += 25) {
      const batch = messages.slice(i, i + 25);
      await modelQueue.sendBatch(batch);
    }

    results.push({ model: model.id, dispatched: messages.length });
    console.log(`[multi-model] Dispatched ${messages.length} stories for model ${model.id}`);
  }

  return results;
}

// ─── Feed snapshot helper ───

async function recordFeedSnapshots(
  db: D1Database,
  feedName: string,
  feedIds: number[],
  depth: number,
): Promise<number> {
  const sliced = feedIds.slice(0, depth);
  if (sliced.length === 0) return 0;

  // Filter to IDs we're tracking in DB
  const trackedInDb: number[] = [];
  for (let i = 0; i < sliced.length; i += 100) {
    const chunk = sliced.slice(i, i + 100);
    const { results } = await db
      .prepare(`SELECT hn_id FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ hn_id: number }>();
    for (const r of results) trackedInDb.push(r.hn_id);
  }

  if (trackedInDb.length === 0) return 0;

  // Fetch current scores from DB
  const scoreMap = new Map<number, { score: number | null; comments: number | null }>();
  for (let i = 0; i < trackedInDb.length; i += 100) {
    const chunk = trackedInDb.slice(i, i + 100);
    const { results } = await db
      .prepare(`SELECT hn_id, hn_score, hn_comments FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ hn_id: number; hn_score: number | null; hn_comments: number | null }>();
    for (const r of results) scoreMap.set(r.hn_id, { score: r.hn_score, comments: r.hn_comments });
  }

  const snapshotStmts = trackedInDb.map(hnId => {
    const rank = sliced.indexOf(hnId) + 1;
    const data = scoreMap.get(hnId);
    return db
      .prepare(
        `INSERT INTO story_snapshots (hn_id, hn_rank, hn_score, hn_comments, list_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(hnId, rank > 0 ? rank : null, data?.score ?? null, data?.comments ?? null, feedName);
  });

  for (let i = 0; i < snapshotStmts.length; i += 100) {
    await db.batch(snapshotStmts.slice(i, i + 100));
  }

  return trackedInDb.length;
}

// ─── Dead/deleted story detection ───

export async function checkFlaggedStories(db: D1Database): Promise<{ checked: number; flagged: number }> {
  // Sample 30 stories: prioritize pending/queued, then done/evaluating, last 30 days
  const { results: candidates } = await db
    .prepare(
      `SELECT hn_id FROM stories
       WHERE eval_status IN ('pending', 'queued', 'done', 'evaluating')
         AND hn_time > unixepoch('now', '-30 days')
         AND hn_type != 'calibration'
       ORDER BY
         CASE eval_status WHEN 'pending' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
         hn_time DESC
       LIMIT 30`
    )
    .all<{ hn_id: number }>();

  if (candidates.length === 0) return { checked: 0, flagged: 0 };

  const ids = candidates.map(r => r.hn_id);
  const items = await fetchItemsBatched(ids);

  // Classify: null-return (hard-removed), flagged, deleted
  const fetchedIds = new Set(items.map(i => i.id));
  const removedIds = ids.filter(id => !fetchedIds.has(id));           // API returned nothing
  const flaggedItems = items.filter(i => i.dead && !i.deleted);       // moderator-killed
  const deletedItems = items.filter(i => i.deleted);                  // author-deleted

  const totalFlagged = removedIds.length + flaggedItems.length + deletedItems.length;
  if (totalFlagged === 0) return { checked: candidates.length, flagged: 0 };

  const stmts: D1PreparedStatement[] = [
    ...removedIds.map(id => db.prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'Story removed from HN',
         gate_category = 'hn_removed', gate_confidence = 1.0
       WHERE hn_id = ? AND eval_status IN ('pending', 'queued', 'done', 'evaluating')`
    ).bind(id)),
    ...flaggedItems.map(i => db.prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'Story flagged/killed on HN',
         gate_category = 'hn_removed', gate_confidence = 1.0
       WHERE hn_id = ? AND eval_status IN ('pending', 'queued', 'done', 'evaluating')`
    ).bind(i.id)),
    ...deletedItems.map(i => db.prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'Story deleted on HN',
         gate_category = 'hn_removed', gate_confidence = 1.0
       WHERE hn_id = ? AND eval_status IN ('pending', 'queued', 'done', 'evaluating')`
    ).bind(i.id)),
  ];

  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  console.log(`[flagged-check] Checked ${candidates.length}, found ${totalFlagged} (${removedIds.length} removed, ${flaggedItems.length} flagged, ${deletedItems.length} deleted)`);
  await logEvent(db, {
    event_type: 'story_flagged',
    severity: 'info',
    message: `Flagged check: ${totalFlagged} stories marked flagged/deleted/removed`,
    details: { checked: candidates.length, flagged: totalFlagged, removed: removedIds.length, flagged_killed: flaggedItems.length, deleted: deletedItems.length },
  });

  return { checked: candidates.length, flagged: totalFlagged };
}

// ─── Content cache preloader ───

/**
 * Pre-fetch content for pending stories into KV so consumers get cache hits.
 * Runs in the cron cycle after stories are inserted, before queue dispatch.
 * Fires async fetches with a short timeout — non-fatal on failure.
 *
 * Key format matches consumer-shared.ts: content:${hn_id}
 */
export async function preloadContentCache(
  db: D1Database,
  kv: KVNamespace,
  limit = 20
): Promise<number> {
  const { results: pending } = await db
    .prepare(
      `SELECT hn_id, url FROM stories
       WHERE eval_status = 'pending'
         AND url IS NOT NULL
         AND url NOT LIKE 'https://news.ycombinator.com%'
       ORDER BY hn_score DESC NULLS LAST
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; url: string }>();

  let cached = 0;
  await Promise.allSettled(
    pending.map(async ({ hn_id, url }) => {
      // Use the same key format as consumer-shared.ts
      const kvKey = `content:${hn_id}`;
      const existing = await kv.get(kvKey);
      if (existing !== null) return; // already cached

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HN-HRCB/1.0)' },
        });
        clearTimeout(timeout);
        if (!res.ok) return;
        const text = await res.text();
        if (text.length < 100) return;
        await kv.put(kvKey, text, { expirationTtl: 3600 });
        cached++;
      } catch {
        // non-fatal
      }
    })
  );
  return cached;
}

// ─── Main crawl cycle ───

/**
 * Run a full HN crawl cycle: fetch lists, diff, insert, refresh scores,
 * crawl comments/users, trigger re-evals, and enqueue pending stories.
 *
 * @param minute - Current minute from scheduledTime (for conditional steps)
 */
export async function runCrawlCycle(
  db: D1Database,
  queue: Queue,
  kv: KVNamespace,
  minute: number,
  lightQueue?: Queue,
): Promise<CrawlResult> {
  const startTime = Date.now();
  const result: CrawlResult = {
    stories_found: 0,
    stories_new: 0,
    feeds: {},
    score_refresh: { updates: 0, sweep: 0 },
    comments: 0,
    users: 0,
    re_evals: 0,
    flagged_check: { checked: 0, flagged: 0 },
    enqueued: false,
    duration_ms: 0,
  };

  // ─── STEP 1: Fetch story ID lists from HN API (6 calls) ───

  let topIds: number[] = [];
  let newIds_hn: number[] = [];
  let bestIds: number[] = [];
  let askIds: number[] = [];
  let showIds: number[] = [];
  let jobIds: number[] = [];

  try {
    [topIds, newIds_hn, bestIds, askIds, showIds, jobIds] = await Promise.all([
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json'),
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/newstories.json'),
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/beststories.json'),
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/askstories.json'),
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/showstories.json'),
      fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/jobstories.json'),
    ]);
  } catch (err) {
    console.error('Failed to fetch HN story lists:', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'error', message: `HN fetch failed: ${err}`, details: { phase: 'hn_fetch', error: String(err) } });
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  result.feeds = { top: topIds.length, new: newIds_hn.length, best: bestIds.length, ask: askIds.length, show: showIds.length, job: jobIds.length };

  // Build type map: which list(s) each ID appeared in
  const typeMap = new Map<number, string>();
  for (const id of topIds) typeMap.set(id, 'story');
  for (const id of newIds_hn) typeMap.set(id, typeMap.get(id) || 'story');
  for (const id of bestIds) typeMap.set(id, typeMap.get(id) || 'story');
  for (const id of jobIds) typeMap.set(id, 'job');
  for (const id of showIds) typeMap.set(id, 'show');
  for (const id of askIds) typeMap.set(id, 'ask');

  // Track feed memberships
  const feedMap = new Map<number, Set<string>>();
  function tagFeed(ids: number[], feed: string) {
    for (const id of ids) {
      let s = feedMap.get(id);
      if (!s) { s = new Set(); feedMap.set(id, s); }
      s.add(feed);
    }
  }
  tagFeed(topIds, 'top');
  tagFeed(newIds_hn, 'new');
  tagFeed(bestIds, 'best');
  tagFeed(askIds, 'ask');
  tagFeed(showIds, 'show');
  tagFeed(jobIds, 'job');

  // Top 7 pages (~210 items) + top 30 from best/ask/show are auto-evaluated; rest are tracked but skipped
  const autoEvalIds = new Set([
    ...topIds.slice(0, TOP_PAGES * ITEMS_PER_PAGE),
    ...bestIds.slice(0, 30),
    ...askIds.slice(0, 30),
    ...showIds.slice(0, 30),
  ]);

  const allIds = [...new Set([
    ...topIds.slice(0, 200),
    ...newIds_hn.slice(0, 200),
    ...bestIds.slice(0, 200),
    ...askIds,
    ...showIds,
    ...jobIds,
  ])];
  result.stories_found = allIds.length;
  console.log(`HN lists: ${topIds.length} top, ${newIds_hn.length} new, ${bestIds.length} best, ${askIds.length} ask, ${showIds.length} show, ${jobIds.length} job → ${allIds.length} unique`);

  // ─── STEP 2: Diff against DB — find genuinely new IDs ───

  const existingIds = new Set<number>();
  for (let i = 0; i < allIds.length; i += 100) {
    const chunk = allIds.slice(i, i + 100);
    const { results: existingRows } = await db
      .prepare(
        `SELECT hn_id FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ hn_id: number }>();
    for (const r of existingRows) existingIds.add(r.hn_id);
  }

  const newIds = allIds.filter((id) => !existingIds.has(id));
  console.log(`${newIds.length} new stories to fetch (${existingIds.size} already in DB)`);

  // ─── STEP 3: Fetch details only for new IDs ───

  let insertedCount = 0;
  for (let i = 0; i < newIds.length; i += 20) {
    const batch = newIds.slice(i, i + 20);
    const items = await Promise.all(
      batch.map(async (id): Promise<HNItem | null> => {
        try {
          return await fetchJson<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch {
          return null;
        }
      })
    );

    const validItems = items
      .filter((item): item is HNItem => item !== null && item.type === 'story' && !!item.title);

    const stmts = validItems.map((item) => {
      const domain = item.url ? extractDomain(item.url) : null;
      const hnType = typeMap.get(item.id) || 'story';
      const status = autoEvalIds.has(item.id) ? 'pending' : 'skipped';
      return db
        .prepare(
          `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status, eval_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id,
          item.url || null,
          item.title || 'Untitled',
          domain,
          item.score || null,
          item.descendants || null,
          item.by || null,
          item.time || Math.floor(Date.now() / 1000),
          hnType,
          item.text || null,
          status,
          status === 'skipped' ? 'Not in top pages' : null
        );
    });

    if (stmts.length > 0) {
      await db.batch(stmts);
      insertedCount += stmts.length;
    }
    for (const item of validItems) existingIds.add(item.id);
  }
  result.stories_new = insertedCount;
  console.log(`Inserted ${insertedCount} new stories`);

  // ─── STEP 3.1: Record feed source memberships ───

  try {
    const feedStmts: D1PreparedStatement[] = [];
    for (const [id, feeds] of feedMap) {
      if (!existingIds.has(id)) continue;
      for (const feed of feeds) {
        feedStmts.push(
          db.prepare(`INSERT OR IGNORE INTO story_feeds (hn_id, feed) VALUES (?, ?)`).bind(id, feed)
        );
      }
    }
    for (let i = 0; i < feedStmts.length; i += 100) {
      await db.batch(feedStmts.slice(i, i + 100));
    }
    console.log(`[feeds] Recorded feed memberships for ${feedMap.size} stories`);
  } catch (err) {
    console.error('Feed tracking failed (non-fatal):', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Feed tracking failed`, details: { phase: 'feeds', error: String(err) } });
  }

  // ─── STEP 3.5: Update hn_rank on stories table ───

  try {
    await db.prepare(`UPDATE stories SET hn_rank = NULL WHERE hn_rank IS NOT NULL`).run();

    const topToRank = topIds.slice(0, 200);
    const rankStmts = topToRank.map((hnId, idx) =>
      db.prepare(`UPDATE stories SET hn_rank = ? WHERE hn_id = ?`).bind(idx + 1, hnId)
    );
    for (let i = 0; i < rankStmts.length; i += 100) {
      await db.batch(rankStmts.slice(i, i + 100));
    }
    console.log(`[rank] Updated hn_rank for ${topToRank.length} top stories`);

    // Promote skipped stories that have risen into top 5 pages
    const autoEvalList = [...autoEvalIds];
    let promoted = 0;
    for (let i = 0; i < autoEvalList.length; i += 100) {
      const chunk = autoEvalList.slice(i, i + 100);
      const { meta } = await db
        .prepare(
          `UPDATE stories SET eval_status = 'pending', eval_error = NULL
           WHERE eval_status = 'skipped'
             AND gate_category IS NULL
             AND hn_id IN (${chunk.map(() => '?').join(',')})`
        )
        .bind(...chunk)
        .run();
      promoted += meta?.changes ?? 0;
    }
    if (promoted > 0) console.log(`[rank] Promoted ${promoted} stories to pending (entered top pages)`);
  } catch (err) {
    console.error('Rank update failed (non-fatal):', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Rank update failed`, details: { phase: 'rank', error: String(err) } });
  }

  // ─── STEP 3.6: Record rank snapshots (multi-feed) ───

  try {
    // Top feed: top 60 every minute; new/best: top 30 every 5 min; ask/show/job: top 20 every 5 min
    const feedSnapshots: { name: string; ids: number[]; depth: number; everyMin: number }[] = [
      { name: 'top', ids: topIds, depth: 60, everyMin: 1 },
      { name: 'new', ids: newIds_hn, depth: 30, everyMin: 5 },
      { name: 'best', ids: bestIds, depth: 30, everyMin: 5 },
      { name: 'ask', ids: askIds, depth: 20, everyMin: 5 },
      { name: 'show', ids: showIds, depth: 20, everyMin: 5 },
      { name: 'job', ids: jobIds, depth: 20, everyMin: 5 },
    ];

    let totalSnapshots = 0;
    for (const feed of feedSnapshots) {
      if (feed.everyMin > 1 && minute % feed.everyMin !== 0) continue;
      const count = await recordFeedSnapshots(db, feed.name, feed.ids, feed.depth);
      totalSnapshots += count;
    }
    if (totalSnapshots > 0) {
      console.log(`[snapshots] Recorded ${totalSnapshots} rank snapshots across feeds`);
    }
  } catch (err) {
    console.error('Snapshot recording failed (non-fatal):', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Snapshot recording failed`, details: { phase: 'snapshots', error: String(err) } });
  }

  // ─── STEP 4: Refresh scores/comments ───

  try {
    const updatedCount = await refreshFromUpdates(db);
    result.score_refresh.updates = updatedCount;
    console.log(`[score-refresh] Updated ${updatedCount} stories from /updates`);

    if (minute % 10 === 0) {
      const sweepCount = await refreshRecentStories(db);
      result.score_refresh.sweep = sweepCount;
      console.log(`[score-refresh] Swept ${sweepCount} recent stories`);
    }
  } catch (err) {
    console.error('Score refresh failed (non-fatal):', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Score refresh failed`, details: { phase: 'score_refresh', error: String(err) } });
  }

  // ─── STEP 4.5: Crawl comments ───

  try {
    if (minute % 10 === 5) {
      const commentCount = await crawlComments(db);
      result.comments = commentCount;
      if (commentCount > 0) {
        console.log(`[comments] Crawled ${commentCount} comments`);
      }
    }
  } catch (err) {
    console.error('Comment crawling failed (non-fatal):', err);
    await logEvent(db, { event_type: 'crawl_error', severity: 'warn', message: `Comment crawling failed`, details: { phase: 'comments', error: String(err) } });
  }

  // ─── STEP 4.7: Crawl user profiles ───

  try {
    if (minute % 15 === 0) {
      const userCount = await crawlUserProfiles(db);
      result.users = userCount;
      if (userCount > 0) {
        console.log(`[users] Cached ${userCount} user profiles`);
      }
    }
  } catch (err) {
    console.error('User profile crawling failed (non-fatal):', err);
    await logEvent(db, { event_type: 'crawl_error', severity: 'warn', message: `User profile crawling failed`, details: { phase: 'users', error: String(err) } });
  }

  // ─── STEP 4.75: Check for flagged/deleted stories ───

  try {
    if (minute % 10 === 3) {
      const flaggedResult = await checkFlaggedStories(db);
      result.flagged_check = flaggedResult;
    }
  } catch (err) {
    console.error('Flagged story check failed (non-fatal):', err);
    await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Flagged story check failed`, details: { phase: 'flagged_check', error: String(err) } });
  }

  // ─── STEP 4.8: Re-evaluate viral stories ───

  try {
    const reEvalIds = await triggerReEvals(db);
    result.re_evals = reEvalIds.length;
    if (reEvalIds.length > 0) {
      console.log(`[re-eval] Triggered re-evaluation for ${reEvalIds.length} high-value stories: ${reEvalIds.join(', ')}`);
      await logEvent(db, { event_type: 'cron_run', severity: 'info', message: `Re-eval triggered for ${reEvalIds.length} viral stories`, details: { phase: 're_eval', count: reEvalIds.length, hn_ids: reEvalIds } });
    }
  } catch (err) {
    console.error('Re-eval trigger failed (non-fatal):', err);
  }

  // ─── STEP 5: Reset stuck stories + enqueue ───

  await db
    .prepare(
      `UPDATE stories SET eval_status = 'pending'
       WHERE eval_status IN ('evaluating', 'queued')
         AND (evaluated_at IS NULL OR evaluated_at < datetime('now', '-1 hour'))`
    )
    .run();

  await enqueueForEvaluation(db, queue, kv, lightQueue);
  result.enqueued = true;

  // Skip self-posts with no text AND no URL
  await db
    .prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = 'No URL and no text',
         gate_category = 'no_content', gate_confidence = 1.0
       WHERE eval_status = 'pending' AND url IS NULL AND (hn_text IS NULL OR LENGTH(hn_text) < 50)`
    )
    .run();

  result.duration_ms = Date.now() - startTime;
  return result;
}
