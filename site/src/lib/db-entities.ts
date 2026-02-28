import type { Story, MiniScore, StoryWithMiniScores, DomainStat } from './db-stories';
import { getStoriesByEntity, getEntityDetailStats, type EntityDetailStats, type DomainDetailStats } from './db-stories';
import { getEnabledModels } from './shared-eval';
import { SETL_CASE_SQL } from './db-utils';

// --- SETL queries ---

/** @internal Future use: dashboard candidate */
export async function getMeanSetl(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(${SETL_CASE_SQL('sc')}) as mean_setl
       FROM rater_scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE sc.eval_model = s.eval_model
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .first<{ mean_setl: number | null }>();
  return row?.mean_setl ?? null;
}

export async function getDomainSetl(db: D1Database, domain: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(${SETL_CASE_SQL('sc')}) as setl
       FROM rater_scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.domain = ? AND sc.eval_model = s.eval_model
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .bind(domain)
    .first<{ setl: number | null }>();
  return row?.setl ?? null;
}

// --- Entity detail stats ---

export type { EntityDetailStats, DomainDetailStats } from './db-stories';

export function getDomainDetailStats(db: D1Database, domain: string) {
  return getEntityDetailStats(db, 'domain', domain);
}

export type DomainSortOption = 'count' | 'score' | 'setl' | 'conf';

export async function getAllDomainStats(
  db: D1Database,
  sort: DomainSortOption = 'count',
  limit = 50,
  offset = 0
): Promise<DomainStat[]> {
  try {
    let orderBy = 'count DESC';
    switch (sort) {
      case 'score': orderBy = 'avg_score DESC NULLS LAST'; break;
      case 'setl': orderBy = 'avg_setl DESC NULLS LAST'; break;
      case 'conf': orderBy = 'avg_conf DESC NULLS LAST'; break;
    }
    const { results } = await db
      .prepare(
        `SELECT s.domain, COUNT(*) as count,
                SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END) as evaluated,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_score,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_editorial_mean END) as avg_editorial,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_structural_mean END) as avg_structural,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_setl END) as avg_setl,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_confidence END) as avg_conf
         FROM stories s
         WHERE s.domain IS NOT NULL
         GROUP BY s.domain
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all<DomainStat>();
    return results;
  } catch (err) {
    console.error('[getAllDomainStats] DB error:', err);
    return [];
  }
}

// --- Domain Intelligence ---

export interface DomainIntelligence {
  domain: string;
  stories: number;
  evaluated: number;
  unique_submitters: number;
  total_hn_score: number;
  avg_hn_score: number;
  total_comments: number;
  avg_comments: number;
  comment_per_point: number | null;
  avg_hrcb: number | null;
  min_hrcb: number | null;
  max_hrcb: number | null;
  hrcb_range: number | null;
  positive_pct: number | null;
  negative_pct: number | null;
  neutral_pct: number | null;
  avg_editorial: number | null;
  avg_structural: number | null;
}

export type DomainIntelSortOption = 'stories' | 'score' | 'comments' | 'hrcb' | 'engagement' | 'submitters' | 'controversy';

export async function getDomainIntelligence(
  db: D1Database,
  sort: DomainIntelSortOption = 'stories',
  minStories = 2,
  limit = 100
): Promise<DomainIntelligence[]> {
  try {
  const t0 = Date.now();
  let orderBy: string;
  switch (sort) {
    case 'score': orderBy = 'total_hn_score DESC'; break;
    case 'comments': orderBy = 'total_comments DESC'; break;
    case 'hrcb': orderBy = 'avg_hrcb DESC NULLS LAST'; break;
    case 'engagement': orderBy = 'comment_per_point DESC NULLS LAST'; break;
    case 'submitters': orderBy = 'unique_submitters DESC'; break;
    case 'controversy': orderBy = 'hrcb_range DESC NULLS LAST'; break;
    default: orderBy = 'stories DESC'; break;
  }
  const { results } = await db
    .prepare(
      `SELECT
        s.domain,
        COUNT(*) as stories,
        SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END) as evaluated,
        COUNT(DISTINCT s.hn_by) as unique_submitters,
        SUM(s.hn_score) as total_hn_score,
        ROUND(AVG(s.hn_score), 1) as avg_hn_score,
        SUM(s.hn_comments) as total_comments,
        ROUND(AVG(s.hn_comments), 1) as avg_comments,
        ROUND(1.0 * SUM(s.hn_comments) / NULLIF(SUM(s.hn_score), 0), 2) as comment_per_point,
        ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) as avg_hrcb,
        ROUND(MIN(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) as min_hrcb,
        ROUND(MAX(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) as max_hrcb,
        ROUND(MAX(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) -
              MIN(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) as hrcb_range,
        ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) as positive_pct,
        ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) as negative_pct,
        ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) as neutral_pct,
        (SELECT ROUND(AVG(sc.editorial), 4) FROM rater_scores sc
         JOIN stories s2 ON s2.hn_id = sc.hn_id
         WHERE s2.domain = s.domain AND sc.eval_model = s2.eval_model AND sc.editorial IS NOT NULL) as avg_editorial,
        (SELECT ROUND(AVG(sc.structural), 4) FROM rater_scores sc
         JOIN stories s2 ON s2.hn_id = sc.hn_id
         WHERE s2.domain = s.domain AND sc.eval_model = s2.eval_model AND sc.structural IS NOT NULL) as avg_structural
      FROM stories s
      WHERE s.domain IS NOT NULL
      GROUP BY s.domain
      HAVING stories >= ?
      ORDER BY ${orderBy}
      LIMIT ?`
    )
    .bind(minStories, limit)
    .all<DomainIntelligence>();
  const ms = Date.now() - t0;
  if (ms > 200) console.warn(`[getDomainIntelligence] slow query: ${ms}ms, ${results.length} rows`);
  return results;
  } catch (err) {
    console.error('[getDomainIntelligence] DB error:', err);
    return [];
  }
}

// --- Domain fingerprints (per-domain, per-article score profiles) ---

export interface DomainArticleScore {
  domain: string;
  sort_order: number;
  avg_final: number | null;
}

export async function getDomainFingerprints(db: D1Database, domains: string[]): Promise<Map<string, (number | null)[]>> {
  if (domains.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT s.domain, sc.sort_order, AVG(sc.final) as avg_final
       FROM rater_scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND sc.eval_model = s.eval_model
         AND s.domain IN (${domains.map(() => '?').join(',')})
       GROUP BY s.domain, sc.sort_order
       ORDER BY s.domain, sc.sort_order`
    )
    .bind(...domains)
    .all<DomainArticleScore>();

  const profiles = new Map<string, (number | null)[]>();
  for (const r of results) {
    let arr = profiles.get(r.domain);
    if (!arr) {
      arr = new Array(31).fill(null);
      profiles.set(r.domain, arr);
    }
    if (r.sort_order >= 0 && r.sort_order < 31) {
      arr[r.sort_order] = r.avg_final;
    }
  }
  return profiles;
}

// --- Domain signal profiles (aggregated supplementary signals per domain) ---

export interface DomainSignalProfile {
  domain: string;
  count: number;
  avg_eq: number | null;
  avg_so: number | null;
  avg_sr: number | null;
  avg_td: number | null;
  avg_pt_count: number | null;
  avg_valence: number | null;
  avg_arousal: number | null;
  avg_dominance: number | null;
  avg_fw_ratio: number | null;
  avg_hn_score: number | null;
  avg_hn_comments: number | null;
  avg_poster_karma: number | null;
  avg_setl: number | null;
  avg_hrcb: number | null;
  avg_editorial: number | null;
  avg_structural: number | null;
  avg_confidence: number | null;
  dominant_tone: string | null;
  dominant_scope: string | null;
  dominant_reading_level: string | null;
  dominant_sentiment: string | null;
}

export async function getDomainSignalProfiles(db: D1Database): Promise<Map<string, DomainSignalProfile>> {
  const t0 = Date.now();
  try {
    const { results } = await db
      .prepare(
        `SELECT
           story_count as count,
           domain,
           avg_eq, avg_so, avg_sr, avg_td, avg_pt_count,
           avg_valence, avg_arousal, avg_dominance, avg_fw_ratio,
           avg_hn_score, avg_hn_comments,
           NULL as avg_poster_karma,
           avg_setl, avg_hrcb, avg_editorial, avg_structural, avg_confidence,
           dominant_tone, dominant_scope, dominant_reading_level, dominant_sentiment
         FROM domain_aggregates
         WHERE evaluated_count >= 3
         ORDER BY evaluated_count DESC`
      )
      .all<DomainSignalProfile>();

    console.log(`[getDomainSignalProfiles] ${results.length} domains in ${Date.now() - t0}ms`);
    const map = new Map<string, DomainSignalProfile>();
    for (const r of results) {
      map.set(r.domain, r);
    }
    return map;
  } catch (err) {
    console.error('[getDomainSignalProfiles] DB error:', err);
    return new Map();
  }
}

// --- Domain SETL temporal tracking (Hypocrisy Index) ---

export interface DomainSetlPoint {
  day: string;
  avg_setl: number;
  avg_editorial: number;
  avg_structural: number;
  count: number;
}

export async function getDomainSetlHistory(db: D1Database, domain: string, limit = 60): Promise<DomainSetlPoint[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(s.evaluated_at) as day,
                AVG(${SETL_CASE_SQL('sc')}) as avg_setl,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                COUNT(DISTINCT s.hn_id) as count
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.domain = ? AND sc.eval_model = s.eval_model
           AND s.eval_status = 'done'
           AND s.evaluated_at IS NOT NULL
           AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
           AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
         GROUP BY DATE(s.evaluated_at)
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(domain, limit)
      .all<DomainSetlPoint>();
    return results.reverse();
  } catch (err) {
    console.error('[getDomainSetlHistory] DB error:', err);
    return [];
  }
}

// --- User profiles ---

export interface HnUser {
  username: string;
  karma: number | null;
  created: number | null;
  about: string | null;
  cached_at: string;
}

export async function getHnUser(db: D1Database, username: string): Promise<HnUser | null> {
  try {
    return await db
      .prepare(`SELECT username, karma, created, about, cached_at FROM hn_users WHERE username = ?`)
      .bind(username)
      .first<HnUser>();
  } catch (err) {
    console.error('[getHnUser] DB error:', err);
    return null;
  }
}

// --- User pages ---

export function getStoriesByUser(db: D1Database, username: string, limit = 50, offset = 0) {
  return getStoriesByEntity(db, 'user', username, limit, offset);
}

export type UserDetailStats = EntityDetailStats;

export function getUserDetailStats(db: D1Database, username: string) {
  return getEntityDetailStats(db, 'user', username);
}

export async function getUserSetl(db: D1Database, username: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(${SETL_CASE_SQL('sc')}) as setl
       FROM rater_scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.hn_by = ? AND sc.eval_model = s.eval_model
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .bind(username)
    .first<{ setl: number | null }>();
  return row?.setl ?? null;
}

// --- User fingerprint (per-article score profile) ---

export async function getUserFingerprint(db: D1Database, username: string): Promise<(number | null)[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT sc.sort_order, AVG(sc.final) as avg_final
         FROM rater_scores sc JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.hn_by = ? AND s.eval_status = 'done' AND sc.eval_model = s.eval_model
         GROUP BY sc.sort_order
         ORDER BY sc.sort_order`
      )
      .bind(username)
      .all<{ sort_order: number; avg_final: number | null }>();

    const fp = new Array(31).fill(null);
    for (const r of results) {
      if (r.sort_order >= 0 && r.sort_order < 31) {
        fp[r.sort_order] = r.avg_final;
      }
    }
    return fp;
  } catch (err) {
    console.error('[getUserFingerprint] DB error:', err);
    return new Array(31).fill(null);
  }
}

// --- User SETL temporal tracking ---

export async function getUserSetlHistory(db: D1Database, username: string, limit = 60): Promise<DomainSetlPoint[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(s.evaluated_at) as day,
                AVG(${SETL_CASE_SQL('sc')}) as avg_setl,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                COUNT(DISTINCT s.hn_id) as count
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.hn_by = ? AND sc.eval_model = s.eval_model
           AND s.eval_status = 'done'
           AND s.evaluated_at IS NOT NULL
           AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
           AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
         GROUP BY DATE(s.evaluated_at)
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(username, limit)
      .all<DomainSetlPoint>();
    return results.reverse();
  } catch (err) {
    console.error('[getUserSetlHistory] DB error:', err);
    return [];
  }
}

// --- Global SETL temporal tracking ---

export async function getGlobalSetlHistory(db: D1Database, limit = 90): Promise<DomainSetlPoint[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(s.evaluated_at) as day,
                AVG(${SETL_CASE_SQL('sc')}) as avg_setl,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                COUNT(DISTINCT s.hn_id) as count
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE sc.eval_model = s.eval_model
           AND s.eval_status = 'done'
           AND s.evaluated_at IS NOT NULL
           AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
           AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
         GROUP BY DATE(s.evaluated_at)
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<DomainSetlPoint>();
    return results.reverse();
  } catch (err) {
    console.error('[getGlobalSetlHistory] DB error:', err);
    return [];
  }
}

// --- Domain DCP cache ---

export async function getDomainDcp(db: D1Database, domain: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT dcp_json FROM domain_dcp WHERE domain = ? LIMIT 1`)
      .bind(domain)
      .first<{ dcp_json: string }>();
    return row?.dcp_json ?? null;
  } catch (err) {
    console.error('[getDomainDcp] DB error:', err);
    return null;
  }
}

// --- Event log queries (re-exported from events.ts for convenience) ---

export {
  getEventsForStory,
  getRecentEvents,
  getEventStats,
  getCronRuns,
  getDailyErrorCounts,
  getEvalsPerCycle,
  updateEventTriage,
  getLatestRateLimitSnapshot,
  getDlqStats,
  getDlqMessages,
  getMethodologyDistribution,
  getModelDriftStats,
  getLatestCalibrationRun,
  getLatestLiteCalibrationRun,
} from './events';
export type { Event, EventStats, CycleStats, RateLimitSnapshot, DlqMessage, DlqStats, MethodologyDistribution, ModelDriftPair, CalibrationRun } from './events';


// --- Signal Quality Overview ---

export interface SignalOverview {
  total_with_signals: number;
  avg_eq: number | null;
  avg_so: number | null;
  avg_sr: number | null;
  avg_td: number | null;
  avg_pt_count: number | null;
  avg_valence: number | null;
  avg_arousal: number | null;
  avg_dominance: number | null;
  top_pt_technique: string | null;
  technique_distribution: Record<string, number>;
  tone_distribution: Record<string, number>;
  scope_distribution: Record<string, number>;
  reading_level_distribution: Record<string, number>;
}

// --- Domain supplementary signal averages ---

export interface DomainSignals {
  avgEq: number | null;
  avgSo: number | null;
  avgSr: number | null;
  avgTd: number | null;
  avgPtCount: number | null;
  topTone: string | null;
  topScope: string | null;
  topSentiment: string | null;
  recentAvgScore: number | null; // last 7d
  olderAvgScore: number | null;  // 8-30d
}

export async function getDomainSignals(db: D1Database, domain: string): Promise<DomainSignals> {
  try {
    const agg = await db
      .prepare(
        `SELECT
          AVG(eq_score) as avg_eq,
          AVG(so_score) as avg_so,
          AVG(sr_score) as avg_sr,
          AVG(td_score) as avg_td,
          AVG(pt_flag_count) as avg_pt_count
        FROM stories
        WHERE domain = ? AND eval_status = 'done' AND eq_score IS NOT NULL`
      )
      .bind(domain)
      .first<{ avg_eq: number | null; avg_so: number | null; avg_sr: number | null; avg_td: number | null; avg_pt_count: number | null }>();

    const topTone = await db
      .prepare(
        `SELECT et_primary_tone as tone FROM stories
         WHERE domain = ? AND eval_status = 'done' AND et_primary_tone IS NOT NULL
         GROUP BY et_primary_tone ORDER BY COUNT(*) DESC LIMIT 1`
      )
      .bind(domain)
      .first<{ tone: string }>();

    const topScope = await db
      .prepare(
        `SELECT gs_scope as scope FROM stories
         WHERE domain = ? AND eval_status = 'done' AND gs_scope IS NOT NULL
         GROUP BY gs_scope ORDER BY COUNT(*) DESC LIMIT 1`
      )
      .bind(domain)
      .first<{ scope: string }>();

    const topSentiment = await db
      .prepare(
        `SELECT hcb_sentiment_tag as tag FROM stories
         WHERE domain = ? AND eval_status = 'done' AND hcb_sentiment_tag IS NOT NULL
         GROUP BY hcb_sentiment_tag ORDER BY COUNT(*) DESC LIMIT 1`
      )
      .bind(domain)
      .first<{ tag: string }>();

    const recentRow = await db
      .prepare(
        `SELECT AVG(hcb_weighted_mean) as avg_score FROM stories
         WHERE domain = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
         AND evaluated_at > datetime('now', '-7 days')`
      )
      .bind(domain)
      .first<{ avg_score: number | null }>();

    const olderRow = await db
      .prepare(
        `SELECT AVG(hcb_weighted_mean) as avg_score FROM stories
         WHERE domain = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
         AND evaluated_at <= datetime('now', '-7 days') AND evaluated_at > datetime('now', '-30 days')`
      )
      .bind(domain)
      .first<{ avg_score: number | null }>();

    return {
      avgEq: agg?.avg_eq ?? null,
      avgSo: agg?.avg_so ?? null,
      avgSr: agg?.avg_sr ?? null,
      avgTd: agg?.avg_td ?? null,
      avgPtCount: agg?.avg_pt_count ?? null,
      topTone: topTone?.tone ?? null,
      topScope: topScope?.scope ?? null,
      topSentiment: topSentiment?.tag ?? null,
      recentAvgScore: recentRow?.avg_score ?? null,
      olderAvgScore: olderRow?.avg_score ?? null,
    };
  } catch (err) {
    console.error('[getDomainSignals] DB error:', err);
    return {
      avgEq: null, avgSo: null, avgSr: null, avgTd: null,
      avgPtCount: null, topTone: null, topScope: null, topSentiment: null,
      recentAvgScore: null, olderAvgScore: null,
    };
  }
}

// --- Pipeline health check ---

export interface PipelineHealth {
  lastCronAge: number | null;       // seconds since last cron_run event
  lastEvalAge: number | null;       // seconds since last eval_success
  queueDepth: number;               // stories with eval_status = 'queued'
  pendingCount: number;             // stories with eval_status = 'pending'
  dlqPending: number;               // dlq_messages with status = 'pending'
  evalsDone24h: number;             // evals completed in last 24h
  failedCount: number;              // stories with eval_status = 'failed'
  rateLimit: { requests_remaining: number | null; consecutive_429s: number } | null;
  healthy: boolean;
}

export async function getPipelineHealth(db: D1Database): Promise<PipelineHealth> {
  const [cronAge, evalAge, queue, dlq, evals24h, rateLimit] = await Promise.all([
    db.prepare(
      `SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) as age_sec
       FROM events WHERE event_type = 'cron_run' ORDER BY created_at DESC LIMIT 1`
    ).first<{ age_sec: number }>().catch(() => null),
    db.prepare(
      `SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) as age_sec
       FROM events WHERE event_type = 'eval_success' ORDER BY created_at DESC LIMIT 1`
    ).first<{ age_sec: number }>().catch(() => null),
    db.prepare(
      `SELECT
        SUM(CASE WHEN eval_status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN eval_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN eval_status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM stories`
    ).first<{ queued: number; pending: number; failed: number }>().catch(() => null),
    db.prepare(`SELECT COUNT(*) as cnt FROM dlq_messages WHERE status = 'pending'`)
      .first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    db.prepare(
      `SELECT COUNT(*) as cnt FROM events WHERE event_type = 'eval_success' AND created_at > datetime('now', '-24 hours')`
    ).first<{ cnt: number }>().catch(() => null),
    db.prepare(
      `SELECT requests_remaining, consecutive_429s FROM ratelimit_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first<{ requests_remaining: number | null; consecutive_429s: number }>().catch(() => null),
  ]);

  const lastCronAge = cronAge?.age_sec ?? null;
  const lastEvalAge = evalAge?.age_sec ?? null;
  const queueDepth = queue?.queued ?? 0;
  const pendingCount = queue?.pending ?? 0;
  const failedCount = queue?.failed ?? 0;
  const dlqPending = dlq?.cnt ?? 0;
  const evalsDone24h = evals24h?.cnt ?? 0;

  // Health: cron ran <10min ago, no 3+ consecutive 429s, DLQ backlog <50
  const cronOk = lastCronAge !== null && lastCronAge < 600;
  const rateLimitOk = !rateLimit || rateLimit.consecutive_429s < 3;
  const dlqOk = dlqPending < 50;
  const healthy = cronOk && rateLimitOk && dlqOk;

  return {
    lastCronAge, lastEvalAge, queueDepth, pendingCount, dlqPending,
    evalsDone24h, failedCount,
    rateLimit: rateLimit ? { requests_remaining: rateLimit.requests_remaining, consecutive_429s: rateLimit.consecutive_429s } : null,
    healthy,
  };
}

export async function getSignalOverview(db: D1Database): Promise<SignalOverview> {
  try {
    const agg = await db
      .prepare(
        `SELECT
          COUNT(*) as total_with_signals,
          AVG(eq_score) as avg_eq,
          AVG(so_score) as avg_so,
          AVG(sr_score) as avg_sr,
          AVG(td_score) as avg_td,
          AVG(pt_flag_count) as avg_pt_count,
          AVG(et_valence) as avg_valence,
          AVG(et_arousal) as avg_arousal,
          AVG(et_dominance) as avg_dominance
        FROM stories
        WHERE eval_status = 'done' AND eq_score IS NOT NULL`
      )
      .first<{ total_with_signals: number; avg_eq: number | null; avg_so: number | null; avg_sr: number | null; avg_td: number | null; avg_pt_count: number | null; avg_valence: number | null; avg_arousal: number | null; avg_dominance: number | null }>();

    // Tone distribution
    const tones = await db
      .prepare(
        `SELECT et_primary_tone as tone, COUNT(*) as cnt
         FROM stories
         WHERE eval_status = 'done' AND et_primary_tone IS NOT NULL
         GROUP BY et_primary_tone
         ORDER BY cnt DESC`
      )
      .all<{ tone: string; cnt: number }>();
    const toneDistribution: Record<string, number> = {};
    for (const r of tones.results) {
      toneDistribution[r.tone] = r.cnt;
    }

    // Geographic scope distribution
    const scopes = await db
      .prepare(
        `SELECT gs_scope as scope, COUNT(*) as cnt
         FROM stories
         WHERE eval_status = 'done' AND gs_scope IS NOT NULL
         GROUP BY gs_scope
         ORDER BY cnt DESC`
      )
      .all<{ scope: string; cnt: number }>();
    const scopeDistribution: Record<string, number> = {};
    for (const r of scopes.results) {
      scopeDistribution[r.scope] = r.cnt;
    }

    // Reading level distribution
    const levels = await db
      .prepare(
        `SELECT cl_reading_level as level, COUNT(*) as cnt
         FROM stories
         WHERE eval_status = 'done' AND cl_reading_level IS NOT NULL
         GROUP BY cl_reading_level
         ORDER BY cnt DESC`
      )
      .all<{ level: string; cnt: number }>();
    const readingLevelDistribution: Record<string, number> = {};
    for (const r of levels.results) {
      readingLevelDistribution[r.level] = r.cnt;
    }

    // Propaganda technique distribution
    let topPtTechnique: string | null = null;
    const techCounts: Record<string, number> = {};
    try {
      const ptRows = await db
        .prepare(
          `SELECT pt_flags_json FROM stories
           WHERE eval_status = 'done' AND pt_flags_json IS NOT NULL AND pt_flag_count > 0`
        )
        .all<{ pt_flags_json: string }>();
      for (const row of ptRows.results) {
        try {
          const flags = JSON.parse(row.pt_flags_json) as Array<{ technique: string }>;
          for (const f of flags) {
            techCounts[f.technique] = (techCounts[f.technique] || 0) + 1;
          }
        } catch { /* skip malformed */ }
      }
      let maxCount = 0;
      for (const [tech, cnt] of Object.entries(techCounts)) {
        if (cnt > maxCount) { maxCount = cnt; topPtTechnique = tech; }
      }
    } catch { /* ignore */ }

    return {
      total_with_signals: agg?.total_with_signals ?? 0,
      avg_eq: agg?.avg_eq ?? null,
      avg_so: agg?.avg_so ?? null,
      avg_sr: agg?.avg_sr ?? null,
      avg_td: agg?.avg_td ?? null,
      avg_pt_count: agg?.avg_pt_count ?? null,
      avg_valence: agg?.avg_valence ?? null,
      avg_arousal: agg?.avg_arousal ?? null,
      avg_dominance: agg?.avg_dominance ?? null,
      top_pt_technique: topPtTechnique,
      technique_distribution: techCounts,
      tone_distribution: toneDistribution,
      scope_distribution: scopeDistribution,
      reading_level_distribution: readingLevelDistribution,
    };
  } catch (err) {
    console.error('[getSignalOverview] DB error:', err);
    return {
      total_with_signals: 0,
      avg_eq: null, avg_so: null, avg_sr: null, avg_td: null,
      avg_pt_count: null, avg_valence: null, avg_arousal: null, avg_dominance: null,
      top_pt_technique: null,
      technique_distribution: {},
      tone_distribution: {}, scope_distribution: {}, reading_level_distribution: {},
    };
  }
}

// --- Content Gate queries ---

export interface DomainGateStats {
  total: number;
  gated: number;
  gate_pct: number;
  breakdown: { gate_category: string; cnt: number }[];
}

export async function getDomainGateStats(db: D1Database, domain: string): Promise<DomainGateStats> {
  try {
    const [counts, breakdown] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) as gated
         FROM stories WHERE domain = ?`
      ).bind(domain).first<{ total: number; gated: number }>(),
      db.prepare(
        `SELECT gate_category, COUNT(*) as cnt
         FROM stories
         WHERE domain = ? AND gate_category IS NOT NULL
         GROUP BY gate_category
         ORDER BY cnt DESC`
      ).bind(domain).all<{ gate_category: string; cnt: number }>(),
    ]);
    const total = counts?.total ?? 0;
    const gated = counts?.gated ?? 0;
    return {
      total,
      gated,
      gate_pct: total > 0 ? Math.round((gated / total) * 1000) / 10 : 0,
      breakdown: breakdown.results,
    };
  } catch (err) {
    console.error('[getDomainGateStats] DB error:', err);
    return { total: 0, gated: 0, gate_pct: 0, breakdown: [] };
  }
}

export interface GatekeptDomain {
  domain: string;
  total: number;
  gated: number;
  gate_pct: number;
  top_category: string | null;
}

export async function getMostGatekeptDomains(db: D1Database, minStories = 5, limit = 5): Promise<GatekeptDomain[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT domain,
                COUNT(*) as total,
                SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) as gated,
                ROUND(100.0 * SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as gate_pct,
                (SELECT gate_category FROM stories s2
                 WHERE s2.domain = s.domain AND s2.gate_category IS NOT NULL
                 GROUP BY gate_category ORDER BY COUNT(*) DESC LIMIT 1) as top_category
         FROM stories s
         WHERE domain IS NOT NULL
         GROUP BY domain
         HAVING COUNT(*) >= ? AND SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) > 0
         ORDER BY gate_pct DESC
         LIMIT ?`
      )
      .bind(minStories, limit)
      .all<GatekeptDomain>();
    return results;
  } catch (err) {
    console.error('[getMostGatekeptDomains] DB error:', err);
    return [];
  }
}

export interface GlobalGateStats {
  total: number;
  gated: number;
  gate_pct: number;
  breakdown: { gate_category: string; cnt: number }[];
}

export async function getGlobalGateStats(db: D1Database): Promise<GlobalGateStats> {
  try {
    const [counts, breakdown] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) as gated
         FROM stories`
      ).first<{ total: number; gated: number }>(),
      db.prepare(
        `SELECT gate_category, COUNT(*) as cnt
         FROM stories
         WHERE gate_category IS NOT NULL
         GROUP BY gate_category
         ORDER BY cnt DESC`
      ).all<{ gate_category: string; cnt: number }>(),
    ]);
    const total = counts?.total ?? 0;
    const gated = counts?.gated ?? 0;
    return {
      total,
      gated,
      gate_pct: total > 0 ? Math.round((gated / total) * 1000) / 10 : 0,
      breakdown: breakdown.results,
    };
  } catch (err) {
    console.error('[getGlobalGateStats] DB error:', err);
    return { total: 0, gated: 0, gate_pct: 0, breakdown: [] };
  }
}

// --- User Intelligence ---

export interface UserIntelligence {
  username: string;
  stories: number;
  evaluated: number;
  unique_domains: number;
  total_hn_score: number;
  avg_hn_score: number;
  total_comments: number;
  avg_comments: number;
  avg_hrcb: number | null;
  min_hrcb: number | null;
  max_hrcb: number | null;
  hrcb_range: number | null;
  positive_pct: number | null;
  negative_pct: number | null;
  neutral_pct: number | null;
  avg_editorial: number | null;
  avg_structural: number | null;
  top_domain: string | null;
}

export type UserIntelSortOption = 'stories' | 'score' | 'comments' | 'hrcb' | 'domains' | 'avg_score' | 'avg_comments' | 'controversy' | 'evaluated' | 'editorial' | 'structural' | 'positive' | 'negative';

export async function getUserIntelligence(
  db: D1Database,
  sort: UserIntelSortOption = 'stories',
  minStories = 3,
  limit = 150
): Promise<UserIntelligence[]> {
  try {
  const t0 = Date.now();
  let orderBy: string;
  switch (sort) {
    case 'score': orderBy = 'total_hn_score DESC'; break;
    case 'comments': orderBy = 'total_comments DESC'; break;
    case 'avg_comments': orderBy = 'avg_comments DESC'; break;
    case 'hrcb': orderBy = 'avg_hrcb DESC'; break;
    case 'domains': orderBy = 'unique_domains DESC'; break;
    case 'avg_score': orderBy = 'avg_hn_score DESC'; break;
    case 'controversy': orderBy = 'hrcb_range DESC'; break;
    case 'evaluated': orderBy = 'evaluated DESC'; break;
    case 'editorial': orderBy = 'avg_editorial DESC'; break;
    case 'structural': orderBy = 'avg_structural DESC'; break;
    case 'positive': orderBy = 'positive_pct DESC'; break;
    case 'negative': orderBy = 'negative_pct DESC'; break;
    default: orderBy = 'stories DESC';
  }

  const { results } = await db
    .prepare(
      `WITH user_stats AS (
        SELECT
          s.hn_by AS username,
          COUNT(*) AS stories,
          SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END) AS evaluated,
          COUNT(DISTINCT s.domain) AS unique_domains,
          COALESCE(SUM(s.hn_score), 0) AS total_hn_score,
          ROUND(AVG(s.hn_score), 1) AS avg_hn_score,
          COALESCE(SUM(s.hn_comments), 0) AS total_comments,
          ROUND(AVG(s.hn_comments), 1) AS avg_comments,
          ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) AS avg_hrcb,
          MIN(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) AS min_hrcb,
          MAX(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) AS max_hrcb,
          ROUND(MAX(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) -
                MIN(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) AS hrcb_range,
          ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) AS positive_pct,
          ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) AS negative_pct,
          ROUND(100.0 * SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 0), 1) AS neutral_pct,
          ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_editorial_mean END), 4) AS avg_editorial,
          ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_structural_mean END), 4) AS avg_structural
        FROM stories s
        WHERE s.hn_by IS NOT NULL AND s.hn_id > 0
        GROUP BY s.hn_by
        HAVING stories >= ?
      ),
      user_top_domain AS (
        SELECT s.hn_by AS username, s.domain AS top_domain,
               ROW_NUMBER() OVER (PARTITION BY s.hn_by ORDER BY COUNT(*) DESC) AS rn
        FROM stories s
        WHERE s.hn_by IS NOT NULL AND s.domain IS NOT NULL AND s.hn_id > 0
        GROUP BY s.hn_by, s.domain
      )
      SELECT u.*, COALESCE(d.top_domain, NULL) AS top_domain
      FROM user_stats u
      LEFT JOIN user_top_domain d ON d.username = u.username AND d.rn = 1
      ORDER BY ${orderBy}
      LIMIT ?`
    )
    .bind(minStories, limit)
    .all<UserIntelligence>();
  const ms = Date.now() - t0;
  if (ms > 200) console.warn(`[getUserIntelligence] slow query: ${ms}ms, ${results.length} rows`);
  return results;
  } catch (err) {
    console.error('[getUserIntelligence] DB error:', err);
    return [];
  }
}
