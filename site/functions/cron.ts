/**
 * Cron Worker v5: HN crawling + score refresh + queue-based evaluation dispatch.
 *
 * v5 changes (merged score-refresh worker):
 * - Runs every 5 minutes (was 10)
 * - Robust score refresh via /updates endpoint (batched DB queries, 18-concurrent fetches)
 * - 48h sweep of recent stories every other run (on 10-min marks)
 * - Replaces separate hn-score-refresh worker
 *
 * Inherited from v4:
 * - Queue-based evaluation dispatch to hrcb-eval-queue
 * - Consumer worker (consumer.ts) handles actual evaluation
 *
 * Inherited from v3/v2:
 * - Fetches topstories + askstories + showstories (3 list calls)
 * - Diffs against DB — only fetches details for genuinely new items
 * - Tags stories with hn_type (story/ask/show) from API source
 * - Stores hn_text for self-posts
 */

import {
  extractDomain,
  markSkipped,
  fetchUrlContent,
} from '../src/lib/shared-eval';
import { cleanHtml } from '../src/lib/html-clean';

interface Env {
  DB: D1Database;
  EVAL_QUEUE: Queue;
  CONTENT_CACHE: KVNamespace;
  CRON_SECRET?: string;
  DAILY_EVAL_BUDGET?: string;
}

interface HNItem {
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

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
}

// --- Helpers ---

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

/**
 * Fetch item details in parallel batches.
 * ~18 concurrent requests per batch ≈ 60% of ~30 req/s safe limit.
 */
async function fetchItemsBatched(ids: number[], batchSize = 18): Promise<HNItem[]> {
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

// --- Score refresh ---

async function refreshFromUpdates(db: D1Database): Promise<number> {
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

async function refreshRecentStories(db: D1Database): Promise<number> {
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

// --- Comment crawling ---

async function crawlComments(db: D1Database): Promise<number> {
  // Find recently evaluated stories that need comment crawling
  // Only crawl stories with >5 comments and evaluated in last 7 days
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
      // Fetch the story item to get kids (top-level comment IDs)
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
      const replyParents = new Map<number, number>(); // reply_id -> parent_comment_id
      for (const c of validTopComments) {
        if (c.kids && c.kids.length > 0) {
          for (const kid of c.kids.slice(0, 5)) { // Up to 5 replies per top comment
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

// --- User profile crawling ---

async function crawlUserProfiles(db: D1Database): Promise<number> {
  // Find story submitters whose profiles we haven't cached (or cached >7 days ago)
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

// --- Queue dispatch ---

async function enqueueForEvaluation(
  db: D1Database,
  queue: Queue,
  kv: KVNamespace,
  dailyBudget: number,
): Promise<void> {
  // Check how many evals have been dispatched/completed today
  // Count stories that finished today OR are currently in-flight
  const { results: [budgetRow] } = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM stories
       WHERE (eval_status = 'done' AND evaluated_at >= datetime('now', 'start of day'))
          OR eval_status IN ('queued', 'evaluating')`
    )
    .all<{ cnt: number }>();

  const todayCount = budgetRow?.cnt ?? 0;
  const remaining = Math.max(0, dailyBudget - todayCount);

  if (remaining === 0) {
    console.log(`[queue] Daily budget exhausted: ${todayCount}/${dailyBudget} evals today`);
    return;
  }

  const limit = Math.min(remaining, 25); // Queue.sendBatch limit is 25, also cap to remaining budget
  console.log(`[queue] Budget: ${todayCount}/${dailyBudget} used today, dispatching up to ${limit}`);

  // Priority: HN top stories rank first (lower rank = higher priority),
  // then composite of hn_score + HOTL extremity for unranked stories.
  const { results: pending } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_text FROM stories
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
      await markSkipped(db, story.hn_id, 'Binary/unsupported content type');
      continue;
    }

    // Skip self-posts with no text
    if (!story.url && (!story.hn_text || story.hn_text.length < 50)) {
      await markSkipped(db, story.hn_id, 'No URL and no text');
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

  // Pre-fetch URL content and store in KV for consumer to use
  let prefetchedCount = 0;
  for (const msg of messages) {
    if (!msg.body.url) continue; // Self-posts don't need pre-fetching
    const kvKey = `content:${msg.body.hn_id}`;
    try {
      const existing = await kv.get(kvKey);
      if (existing) continue; // Already cached
      const rawHtml = await fetchUrlContent(msg.body.url);
      const cleaned = cleanHtml(rawHtml, 20000);
      if (cleaned.length >= 50) {
        await kv.put(kvKey, cleaned, { expirationTtl: 86400 }); // 24h TTL
        prefetchedCount++;
      }
    } catch {
      // Non-fatal — consumer will fetch if cache miss
    }
  }
  if (prefetchedCount > 0) {
    console.log(`[queue] Pre-fetched content for ${prefetchedCount} stories`);
  }

  // Send to queue in batches of 25 (Queue.sendBatch limit)
  for (let i = 0; i < messages.length; i += 25) {
    const batch = messages.slice(i, i + 25);
    await queue.sendBatch(batch);
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

// --- Main cron handler ---

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = env.DB;

    // ─── STEP 1: Fetch story ID lists from HN API (5 calls) ───

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
      return;
    }

    // Build type map: which list(s) each ID appeared in
    const typeMap = new Map<number, string>();
    for (const id of topIds) typeMap.set(id, 'story');
    for (const id of newIds_hn) typeMap.set(id, typeMap.get(id) || 'story');
    for (const id of bestIds) typeMap.set(id, typeMap.get(id) || 'story');
    for (const id of jobIds) typeMap.set(id, 'job');    // job before show/ask
    for (const id of showIds) typeMap.set(id, 'show');  // override if in both
    for (const id of askIds) typeMap.set(id, 'ask');     // ask takes priority

    // Track which feed lists each story appeared on
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

    const allIds = [...new Set([
      ...topIds.slice(0, 200),
      ...newIds_hn.slice(0, 200),
      ...bestIds.slice(0, 200),
      ...askIds,
      ...showIds,
      ...jobIds,
    ])];
    console.log(`HN lists: ${topIds.length} top, ${newIds_hn.length} new, ${bestIds.length} best, ${askIds.length} ask, ${showIds.length} show, ${jobIds.length} job → ${allIds.length} unique`);

    // ─── STEP 2: Diff against DB — find genuinely new IDs ───

    // D1 limits bind params to 100, so batch the IN query
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
    // Fetch in parallel batches of 20
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

      const stmts = items
        .filter((item): item is HNItem => item !== null && item.type === 'story' && !!item.title)
        .map((item) => {
          const domain = item.url ? extractDomain(item.url) : null;
          const hnType = typeMap.get(item.id) || 'story';
          return db
            .prepare(
              `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
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
              item.text || null
            );
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        insertedCount += stmts.length;
      }
    }
    console.log(`Inserted ${insertedCount} new stories`);

    // ─── STEP 3.1: Record feed source memberships ───

    try {
      const feedStmts: D1PreparedStatement[] = [];
      for (const [id, feeds] of feedMap) {
        for (const feed of feeds) {
          feedStmts.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO story_feeds (hn_id, feed) VALUES (?, ?)`
              )
              .bind(id, feed)
          );
        }
      }
      // Batch in chunks of 100
      for (let i = 0; i < feedStmts.length; i += 100) {
        await db.batch(feedStmts.slice(i, i + 100));
      }
      console.log(`[feeds] Recorded feed memberships for ${feedMap.size} stories`);
    } catch (err) {
      console.error('Feed tracking failed (non-fatal):', err);
    }

    // ─── STEP 3.5: Update hn_rank on stories table ───
    // Clear all existing ranks, then set current rank for top stories
    try {
      await db.prepare(`UPDATE stories SET hn_rank = NULL WHERE hn_rank IS NOT NULL`).run();

      const topToRank = topIds.slice(0, 200); // Top 200 positions
      const rankStmts = topToRank.map((hnId, idx) =>
        db.prepare(`UPDATE stories SET hn_rank = ? WHERE hn_id = ?`).bind(idx + 1, hnId)
      );
      for (let i = 0; i < rankStmts.length; i += 100) {
        await db.batch(rankStmts.slice(i, i + 100));
      }
      console.log(`[rank] Updated hn_rank for ${topToRank.length} top stories`);
    } catch (err) {
      console.error('Rank update failed (non-fatal):', err);
    }

    // ─── STEP 3.6: Record rank snapshots for tracked stories ───

    try {
      // Record rank positions for top stories we track
      const topTracked = topIds.slice(0, 60); // Top 60 positions
      const trackedInDb: number[] = [];
      for (let i = 0; i < topTracked.length; i += 100) {
        const chunk = topTracked.slice(i, i + 100);
        const { results } = await db
          .prepare(`SELECT hn_id FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`)
          .bind(...chunk)
          .all<{ hn_id: number }>();
        for (const r of results) trackedInDb.push(r.hn_id);
      }

      if (trackedInDb.length > 0) {
        // Get current scores for these stories
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
          const rank = topIds.indexOf(hnId) + 1; // 1-indexed rank
          const data = scoreMap.get(hnId);
          return db
            .prepare(
              `INSERT INTO story_snapshots (hn_id, hn_rank, hn_score, hn_comments, list_type)
               VALUES (?, ?, ?, ?, 'top')`
            )
            .bind(hnId, rank > 0 ? rank : null, data?.score ?? null, data?.comments ?? null);
        });

        // D1 batch limit is 100
        for (let i = 0; i < snapshotStmts.length; i += 100) {
          await db.batch(snapshotStmts.slice(i, i + 100));
        }
        console.log(`[snapshots] Recorded ${trackedInDb.length} rank snapshots`);
      }
    } catch (err) {
      console.error('Snapshot recording failed (non-fatal):', err);
    }

    // ─── STEP 4: Refresh scores/comments ───

    try {
      // Phase 1: Refresh items from /v0/updates.json (batched, all matching items)
      const updatedCount = await refreshFromUpdates(db);
      console.log(`[score-refresh] Updated ${updatedCount} stories from /updates`);

      // Phase 2: Sweep recent stories every other run (on 10-min marks)
      const minute = new Date(event.scheduledTime).getMinutes();
      if (minute % 10 === 0) {
        const sweepCount = await refreshRecentStories(db);
        console.log(`[score-refresh] Swept ${sweepCount} recent stories`);
      }
    } catch (err) {
      console.error('Score refresh failed (non-fatal):', err);
    }

    // ─── STEP 4.5: Crawl comments for evaluated stories ───

    try {
      const minute = new Date(event.scheduledTime).getMinutes();
      if (minute % 10 === 5) { // Run on 5, 15, 25, 35, 45, 55 marks
        const commentCount = await crawlComments(db);
        if (commentCount > 0) {
          console.log(`[comments] Crawled ${commentCount} comments`);
        }
      }
    } catch (err) {
      console.error('Comment crawling failed (non-fatal):', err);
    }

    // ─── STEP 4.7: Crawl user profiles for poster analysis ───

    try {
      const minute = new Date(event.scheduledTime).getMinutes();
      if (minute % 15 === 0) { // Run on 0, 15, 30, 45 marks
        const userCount = await crawlUserProfiles(db);
        if (userCount > 0) {
          console.log(`[users] Cached ${userCount} user profiles`);
        }
      }
    } catch (err) {
      console.error('User profile crawling failed (non-fatal):', err);
    }

    // ─── STEP 5: Enqueue pending stories for evaluation ───

    // Also reset any stories stuck in 'evaluating' for >1 hour back to pending
    await db
      .prepare(
        `UPDATE stories SET eval_status = 'pending'
         WHERE eval_status IN ('evaluating', 'queued')
           AND (evaluated_at IS NULL OR evaluated_at < datetime('now', '-1 hour'))`
      )
      .run();

    const dailyBudget = parseInt(env.DAILY_EVAL_BUDGET || '50', 10);
    await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE, dailyBudget);

    // Skip self-posts with no text AND no URL (truly empty)
    await db
      .prepare(
        `UPDATE stories SET eval_status = 'skipped', eval_error = 'No URL and no text'
         WHERE eval_status = 'pending' AND url IS NULL AND (hn_text IS NULL OR LENGTH(hn_text) < 50)`
      )
      .run();

    console.log('Cron cycle complete');
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/trigger') {
      if (env.CRON_SECRET) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.CRON_SECRET}`) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
      }
      ctx.waitUntil(
        this.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' } as ScheduledEvent, env, ctx)
      );
      return new Response('Cron triggered', { status: 200 });
    }
    return new Response('HN HRCB Cron Worker v5 (crawl + refresh + queue dispatch)', { status: 200 });
  },
};
