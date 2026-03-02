// SPDX-License-Identifier: Apache-2.0
import type { Story } from './db-stories';

// --- Model comparison ---

export interface ModelComparisonStat {
  eval_model: string;
  count: number;
  avg_score: number | null;
  min_score: number | null;
  max_score: number | null;
}

export async function getModelComparisonStats(db: D1Database): Promise<ModelComparisonStat[]> {
  const { results } = await db
    .prepare(
      `SELECT eval_model,
              COUNT(*) as count,
              AVG(hcb_weighted_mean) as avg_score,
              MIN(hcb_weighted_mean) as min_score,
              MAX(hcb_weighted_mean) as max_score
       FROM eval_history
       GROUP BY eval_model
       ORDER BY count DESC`
    )
    .all<ModelComparisonStat>();
  return results;
}


// --- Article sparklines ---

export interface SparklinePoint {
  section: string;
  final: number;
  evaluated_at: string;
}

export async function getArticleSparklines(
  db: D1Database,
  days = 30
): Promise<{ section: string; day: string; final: number }[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT section, day, mean_final as final
         FROM daily_section_stats
         WHERE day >= date('now', ?)
         ORDER BY section, day`
      )
      .bind(`-${days} days`)
      .all<{ section: string; day: string; final: number }>();
    return results;
  } catch (err) {
    console.error('[getArticleSparklines] DB error:', err);
    return [];
  }
}

// --- Article pair stats (co-occurrence + correlation) ---

export interface ArticlePairData {
  cooccurrence: Map<string, number>;
  correlation: Map<string, number>;
  maxCooccurrence: number;
}

export async function getArticlePairStats(db: D1Database): Promise<ArticlePairData> {
  const t0 = Date.now();
  const { results } = await db
    .prepare(
      `SELECT a.section as section_a, b.section as section_b,
        COUNT(*) as n,
        SUM(a.final * b.final) as sum_ab,
        SUM(a.final) as sum_a, SUM(b.final) as sum_b,
        SUM(a.final * a.final) as sum_a2, SUM(b.final * b.final) as sum_b2
       FROM rater_scores a
       JOIN rater_scores b ON a.hn_id = b.hn_id AND a.eval_model = b.eval_model
       JOIN stories s ON s.hn_id = a.hn_id AND a.eval_model = s.eval_model
       WHERE a.final IS NOT NULL AND b.final IS NOT NULL AND a.sort_order <= b.sort_order
       GROUP BY a.section, b.section
       HAVING COUNT(*) >= 5`
    )
    .all<{
      section_a: string; section_b: string;
      n: number; sum_ab: number;
      sum_a: number; sum_b: number;
      sum_a2: number; sum_b2: number;
    }>();

  const cooccurrence = new Map<string, number>();
  const correlation = new Map<string, number>();
  let maxCo = 0;

  for (const r of results) {
    const key = `${r.section_a}|${r.section_b}`;
    cooccurrence.set(key, r.n);
    if (r.n > maxCo) maxCo = r.n;

    // Pearson r
    if (r.n > 1) {
      const num = r.n * r.sum_ab - r.sum_a * r.sum_b;
      const denA = r.n * r.sum_a2 - r.sum_a * r.sum_a;
      const denB = r.n * r.sum_b2 - r.sum_b * r.sum_b;
      const den = Math.sqrt(Math.max(0, denA) * Math.max(0, denB));
      if (den > 0) {
        correlation.set(key, num / den);
      }
    }
  }

  const ms = Date.now() - t0;
  if (ms > 200) console.warn(`[getArticlePairStats] slow query: ${ms}ms`);
  return { cooccurrence, correlation, maxCooccurrence: maxCo };
}

// --- Score distribution histogram ---

export interface HistogramBin {
  bin: number; // e.g. -10 = [-1.0, -0.9), 0 = [0.0, 0.1), etc.
  count: number;
}

/** @internal Future use: dashboard candidate */
export async function getScoreHistogram(db: D1Database): Promise<HistogramBin[]> {
  const { results } = await db
    .prepare(
      `SELECT CAST(FLOOR(hcb_weighted_mean * 10) AS INTEGER) as bin, COUNT(*) as count
       FROM stories WHERE eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       GROUP BY bin ORDER BY bin`
    )
    .all<HistogramBin>();
  return results;
}

// --- Mean confidence ---

export async function getMeanConfidence(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(hcb_confidence) as mean_conf
       FROM stories
       WHERE eval_status = 'done'
         AND hcb_confidence IS NOT NULL`
    )
    .first<{ mean_conf: number | null }>();
  return row?.mean_conf ?? null;
}

// --- HRCB over time (daily averages) ---

export interface DailyHrcb {
  day: string;
  avg: number;
  count: number;
}

export async function getDailyHrcb(db: D1Database, limit = 60): Promise<DailyHrcb[]> {
  const { results } = await db
    .prepare(
      `SELECT DATE(evaluated_at) as day, AVG(hcb_weighted_mean) as avg, COUNT(*) as count
       FROM stories
       WHERE eval_status = 'done' AND evaluated_at IS NOT NULL AND hcb_weighted_mean IS NOT NULL
       GROUP BY DATE(evaluated_at)
       ORDER BY day DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DailyHrcb>();
  // Reverse to chronological
  return results.reverse();
}

// --- Coverage velocity ---

export interface VelocityStats {
  evalsPerDay: number;
  evals24h: number;
  evals7d: number;
  daysActive: number;
  daysToClearing: number | null;
}

export async function getVelocityStats(db: D1Database, pendingCount: number): Promise<VelocityStats> {
  // Rolling rate from rater_evals (captures multi-model throughput) — enabled models only
  const recent = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN re.evaluated_at >= datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN re.evaluated_at >= datetime('now', '-7 days') THEN 1 END) as evals_7d
       FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       WHERE re.eval_status = 'done' AND re.evaluated_at IS NOT NULL`
    )
    .first<{ evals_24h: number; evals_7d: number }>();

  // All-time span for "days active"
  const span = await db
    .prepare(
      `SELECT MIN(evaluated_at) as first_eval, MAX(evaluated_at) as last_eval
       FROM stories WHERE eval_status = 'done' AND evaluated_at IS NOT NULL`
    )
    .first<{ first_eval: string | null; last_eval: string | null }>();

  const evals24h = recent?.evals_24h ?? 0;
  const evals7d = recent?.evals_7d ?? 0;
  const evalsPerDay = evals7d > 0 ? evals7d / 7 : 0;

  let daysActive = 0;
  if (span?.first_eval && span?.last_eval) {
    daysActive = Math.max(1, Math.round(
      (new Date(span.last_eval).getTime() - new Date(span.first_eval).getTime()) / (1000 * 60 * 60 * 24)
    ));
  }

  const daysToClearing = pendingCount > 0 && evalsPerDay > 0
    ? pendingCount / evalsPerDay
    : null;

  return { evalsPerDay, evals24h, evals7d, daysActive, daysToClearing };
}

// --- Top/Bottom Confidence stories ---

/** @internal Future use: dashboard candidate */
export async function getTopConfidenceStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT *, hcb_confidence as conf
       FROM stories WHERE eval_status = 'done'
         AND hcb_confidence IS NOT NULL
       ORDER BY conf DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

/** @internal Future use: dashboard candidate */
export async function getBottomConfidenceStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT *, hcb_confidence as conf
       FROM stories WHERE eval_status = 'done'
         AND hcb_confidence IS NOT NULL
       ORDER BY conf ASC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

// --- Content type score distributions ---

export interface ContentTypeDistBin {
  content_type: string;
  bin: number;
  count: number;
}

/** @internal Future use: dashboard candidate */
export async function getContentTypeDistribution(db: D1Database): Promise<Map<string, { bins: Map<number, number>; total: number }>> {
  const { results } = await db
    .prepare(
      `SELECT content_type, CAST(FLOOR(hcb_weighted_mean * 10) AS INTEGER) as bin, COUNT(*) as count
       FROM stories WHERE eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       GROUP BY content_type, bin
       ORDER BY content_type, bin`
    )
    .all<ContentTypeDistBin>();

  const dist = new Map<string, { bins: Map<number, number>; total: number }>();
  for (const r of results) {
    let entry = dist.get(r.content_type);
    if (!entry) {
      entry = { bins: new Map(), total: 0 };
      dist.set(r.content_type, entry);
    }
    entry.bins.set(r.bin, r.count);
    entry.total += r.count;
  }
  return dist;
}

// --- Scatter plot data (E vs S + Score vs Confidence combined) ---

export interface StoryScatterPoint {
  hn_id: number;
  title: string;
  domain: string | null;
  hcb_weighted_mean: number | null;
  avg_editorial: number;
  avg_structural: number;
  conf: number;
}

export async function getStoryScatterData(db: D1Database, limit = 500): Promise<StoryScatterPoint[]> {
  const t0 = Date.now();
  const { results } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.domain, s.hcb_weighted_mean,
              AVG(sc.editorial) as avg_editorial,
              AVG(sc.structural) as avg_structural,
              s.hcb_confidence as conf
       FROM stories s JOIN rater_scores sc ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND sc.eval_model = s.eval_model
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
       GROUP BY s.hn_id
       ORDER BY s.evaluated_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<StoryScatterPoint>();
  const ms = Date.now() - t0;
  if (ms > 200) console.warn(`[getStoryScatterData] slow query: ${ms}ms, ${results.length} rows`);
  return results;
}

// --- Velocity tracking (Cayce Pollard mode) ---

export interface VelocityStory extends Story {
  velocity: number | null; // points per hour
}

export async function getHighVelocityStories(db: D1Database, limit = 20): Promise<VelocityStory[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT s.*,
                CASE WHEN COUNT(snap.id) >= 2 THEN
                  CAST(MAX(snap.hn_score) - MIN(snap.hn_score) AS REAL)
                  / MAX((MAX(snap.snapshot_unix) - MIN(snap.snapshot_unix)) / 3600.0, 0.1)
                ELSE NULL END as velocity
         FROM stories s
         JOIN (
           SELECT hn_id, hn_score, id,
                  CAST(strftime('%s', snapshot_at) AS INTEGER) as snapshot_unix
           FROM story_snapshots
           WHERE snapshot_at >= datetime('now', '-24 hours')
         ) snap ON snap.hn_id = s.hn_id
         WHERE s.hn_time > unixepoch('now', '-48 hours')
         GROUP BY s.hn_id
         HAVING COUNT(snap.id) >= 2
         ORDER BY velocity DESC NULLS LAST
         LIMIT ?`
      )
      .bind(limit)
      .all<VelocityStory>();
    return results;
  } catch (err) {
    console.error('[getHighVelocityStories] DB error:', err);
    return [];
  }
}

export interface VelocityCorrelation {
  hn_id: number;
  title: string;
  domain: string | null;
  velocity: number;
  hcb_weighted_mean: number | null;
  hcb_editorial_mean: number | null;
  hcb_classification: string | null;
}

export async function getVelocityVsHrcb(db: D1Database, limit = 100): Promise<VelocityCorrelation[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT s.hn_id, s.title, s.domain, s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_classification,
                CAST(MAX(snap.hn_score) - MIN(snap.hn_score) AS REAL)
                / MAX((MAX(snap.snapshot_unix) - MIN(snap.snapshot_unix)) / 3600.0, 0.1) as velocity
         FROM stories s
         JOIN (
           SELECT hn_id, hn_score,
                  CAST(strftime('%s', snapshot_at) AS INTEGER) as snapshot_unix
           FROM story_snapshots
         ) snap ON snap.hn_id = s.hn_id
         WHERE s.eval_status = 'done' AND s.hcb_weighted_mean IS NOT NULL
         GROUP BY s.hn_id
         HAVING COUNT(*) >= 2
         ORDER BY velocity DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<VelocityCorrelation>();
    return results;
  } catch (err) {
    console.error('[getVelocityVsHrcb] DB error:', err);
    return [];
  }
}

// --- Seldon Dashboard: rolling averages + per-content-type daily ---

export interface DailyContentTypeHrcb {
  day: string;
  content_type: string;
  avg_score: number;
  count: number;
}

export async function getDailyContentTypeHrcb(db: D1Database, limit = 90): Promise<DailyContentTypeHrcb[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(evaluated_at) as day, content_type, AVG(hcb_weighted_mean) as avg_score, COUNT(*) as count
         FROM stories
         WHERE eval_status = 'done' AND evaluated_at IS NOT NULL AND hcb_weighted_mean IS NOT NULL
         GROUP BY DATE(evaluated_at), content_type
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(limit * 15)
      .all<DailyContentTypeHrcb>();
    return results;
  } catch (err) {
    console.error('[getDailyContentTypeHrcb] DB error:', err);
    return [];
  }
}

export async function getFeedDailyHrcb(db: D1Database, limit = 90): Promise<{ day: string; feed: string; avg_score: number; count: number }[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(s.evaluated_at) as day, sf.feed, AVG(s.hcb_weighted_mean) as avg_score, COUNT(*) as count
         FROM story_feeds sf
         JOIN stories s ON s.hn_id = sf.hn_id
         WHERE s.eval_status = 'done' AND s.evaluated_at IS NOT NULL AND s.hcb_weighted_mean IS NOT NULL
         GROUP BY DATE(s.evaluated_at), sf.feed
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(limit * 6)
      .all<{ day: string; feed: string; avg_score: number; count: number }>();
    return results;
  } catch (err) {
    console.error('[getFeedDailyHrcb] DB error:', err);
    return [];
  }
}

// --- Temporal patterns ---

export interface HourlyPattern {
  hour: number;
  stories: number;
  avg_hn_score: number;
  avg_comments: number;
  avg_hrcb: number | null;
  evaluated: number;
}

export async function getHourlyPatterns(db: D1Database): Promise<HourlyPattern[]> {
  const { results } = await db
    .prepare(
      `SELECT
        CAST(strftime('%H', datetime(s.hn_time, 'unixepoch')) AS INTEGER) AS hour,
        COUNT(*) AS stories,
        ROUND(AVG(s.hn_score), 1) AS avg_hn_score,
        ROUND(AVG(s.hn_comments), 1) AS avg_comments,
        ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) AS avg_hrcb,
        SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END) AS evaluated
      FROM stories s
      WHERE s.hn_time > 0 AND s.hn_id > 0
      GROUP BY hour
      ORDER BY hour`
    )
    .all<HourlyPattern>();
  return results;
}

export interface DayOfWeekPattern {
  day: number;
  day_name: string;
  stories: number;
  avg_hn_score: number;
  avg_comments: number;
  avg_hrcb: number | null;
}

export async function getDayOfWeekPatterns(db: D1Database): Promise<DayOfWeekPattern[]> {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { results } = await db
    .prepare(
      `SELECT
        CAST(strftime('%w', datetime(s.hn_time, 'unixepoch')) AS INTEGER) AS day,
        COUNT(*) AS stories,
        ROUND(AVG(s.hn_score), 1) AS avg_hn_score,
        ROUND(AVG(s.hn_comments), 1) AS avg_comments,
        ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 4) AS avg_hrcb
      FROM stories s
      WHERE s.hn_time > 0 AND s.hn_id > 0
      GROUP BY day
      ORDER BY day`
    )
    .all<{ day: number; stories: number; avg_hn_score: number; avg_comments: number; avg_hrcb: number | null }>();
  return results.map(r => ({ ...r, day_name: dayNames[r.day] || `Day ${r.day}` }));
}

// --- Observatory Queries ---

export interface PropagandaStory {
  hn_id: number;
  title: string;
  url: string | null;
  domain: string | null;
  pt_flag_count: number;
  pt_score: number | null;
  pt_flags_json: string | null;
  hcb_weighted_mean: number | null;
  hcb_editorial_mean: number | null;
}

export async function getTopPropagandaStories(db: D1Database, limit = 10): Promise<PropagandaStory[]> {
  const { results } = await db
    .prepare(
      `SELECT hn_id, title, url, domain, pt_flag_count, pt_score, pt_flags_json, hcb_weighted_mean, hcb_editorial_mean
       FROM stories
       WHERE eval_status = 'done' AND pt_flag_count > 0
       ORDER BY COALESCE(pt_score, pt_flag_count) DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<PropagandaStory>();
  return results;
}

export interface StakeholderOverview {
  who_speaks: Record<string, number>;
  who_spoken_about: Record<string, number>;
  total: number;
}

export async function getStakeholderOverview(db: D1Database): Promise<StakeholderOverview> {
  const { results } = await db
    .prepare(
      `SELECT sr_who_speaks, sr_who_spoken_about
       FROM stories
       WHERE eval_status = 'done' AND (sr_who_speaks IS NOT NULL OR sr_who_spoken_about IS NOT NULL)
       LIMIT 5000`
    )
    .all<{ sr_who_speaks: string | null; sr_who_spoken_about: string | null }>();

  const speaksCounts: Record<string, number> = {};
  const aboutCounts: Record<string, number> = {};

  for (const r of results) {
    if (r.sr_who_speaks) {
      try {
        const arr = JSON.parse(r.sr_who_speaks);
        for (const s of (Array.isArray(arr) ? arr : [arr]).map((v: string) => String(v).trim()).filter(Boolean)) {
          speaksCounts[s] = (speaksCounts[s] || 0) + 1;
        }
      } catch {
        // Fallback for non-JSON comma-separated values
        for (const s of r.sr_who_speaks.split(',').map(s => s.trim()).filter(Boolean)) {
          speaksCounts[s] = (speaksCounts[s] || 0) + 1;
        }
      }
    }
    if (r.sr_who_spoken_about) {
      try {
        const arr = JSON.parse(r.sr_who_spoken_about);
        for (const s of (Array.isArray(arr) ? arr : [arr]).map((v: string) => String(v).trim()).filter(Boolean)) {
          aboutCounts[s] = (aboutCounts[s] || 0) + 1;
        }
      } catch {
        for (const s of r.sr_who_spoken_about.split(',').map(s => s.trim()).filter(Boolean)) {
          aboutCounts[s] = (aboutCounts[s] || 0) + 1;
        }
      }
    }
  }

  return { who_speaks: speaksCounts, who_spoken_about: aboutCounts, total: results.length };
}

export interface RegionCount {
  region: string;
  count: number;
}

export async function getRegionDistribution(db: D1Database): Promise<{ regions: RegionCount[]; scopes: Record<string, number>; total: number }> {
  // Scope distribution
  const { results: scopeRows } = await db
    .prepare(
      `SELECT gs_scope as scope, COUNT(*) as cnt
       FROM stories
       WHERE eval_status = 'done' AND gs_scope IS NOT NULL
       GROUP BY gs_scope
       ORDER BY cnt DESC`
    )
    .all<{ scope: string; cnt: number }>();

  const scopes: Record<string, number> = {};
  for (const r of scopeRows) {
    scopes[r.scope] = r.cnt;
  }

  // Region distribution from JSON arrays
  const { results: regionRows } = await db
    .prepare(
      `SELECT gs_regions_json
       FROM stories
       WHERE eval_status = 'done' AND gs_regions_json IS NOT NULL
       LIMIT 5000`
    )
    .all<{ gs_regions_json: string }>();

  const regionCounts: Record<string, number> = {};
  for (const r of regionRows) {
    try {
      const regions = JSON.parse(r.gs_regions_json);
      if (Array.isArray(regions)) {
        for (const region of regions) {
          if (typeof region === 'string' && region.trim()) {
            const key = region.trim();
            regionCounts[key] = (regionCounts[key] || 0) + 1;
          }
        }
      }
    } catch { /* skip malformed json */ }
  }

  const regions = Object.entries(regionCounts)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  return { regions, scopes, total: regionRows.length };
}

// --- Per-provider (worker) stats ---

export interface ProviderStat {
  eval_provider: string;
  evals_total: number;
  evals_24h: number;
  evals_7d: number;
  last_eval: string | null;
  failed_24h: number;
}

/**
 * Aggregate eval counts from rater_evals grouped by eval_provider.
 * Each consumer worker (anthropic, openrouter, workers-ai, claude-code-standalone)
 * maps to a row showing its activity level and recency.
 */
export async function getProviderStats(db: D1Database): Promise<ProviderStat[]> {

  const { results } = await db
    .prepare(
      `SELECT
         re.eval_provider,
         COUNT(CASE WHEN re.eval_status = 'done' THEN 1 END) as evals_total,
         COUNT(CASE WHEN re.eval_status = 'done'
                     AND re.evaluated_at > datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN re.eval_status = 'done'
                     AND re.evaluated_at > datetime('now', '-7 days') THEN 1 END) as evals_7d,
         MAX(CASE WHEN re.eval_status = 'done' THEN re.evaluated_at END) as last_eval,
         COUNT(CASE WHEN re.eval_status = 'failed'
                     AND re.evaluated_at > datetime('now', '-1 day') THEN 1 END) as failed_24h
       FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       GROUP BY re.eval_provider
       ORDER BY evals_total DESC`
    )
    .all<ProviderStat>();
  return results;
}

// --- Per-model (queue-level) stats ---

export interface ModelQueueStat {
  eval_model: string;
  eval_provider: string;
  evals_24h: number;
  evals_7d: number;
  last_eval: string | null;
  in_flight: number;
}

/**
 * Per-model eval stats for the Queue Breakdown card.
 * Each CF Queue maps to one (or two for workers-ai) eval_model values.
 */
export async function getModelQueueStats(db: D1Database): Promise<ModelQueueStat[]> {
  const { results } = await db
    .prepare(
      `SELECT
         re.eval_model,
         re.eval_provider,
         COUNT(CASE WHEN re.eval_status = 'done'
                     AND re.evaluated_at > datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN re.eval_status = 'done'
                     AND re.evaluated_at > datetime('now', '-7 days') THEN 1 END) as evals_7d,
         MAX(CASE WHEN re.eval_status = 'done' THEN re.evaluated_at END) as last_eval,
         COUNT(CASE WHEN re.eval_status IN ('queued', 'evaluating', 'pending') THEN 1 END) as in_flight
       FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       GROUP BY re.eval_model, re.eval_provider
       ORDER BY evals_7d DESC`
    )
    .all<ModelQueueStat>();
  return results;
}

// --- Observability: DLQ trend ---

export interface DlqDayTrend {
  day: string;
  new_count: number;
  replayed_count: number;
  pending_count: number;
}

export interface DlqTrend {
  days: DlqDayTrend[];
  backlog_growing: boolean;
  current_pending: number;
}

export async function getDlqTrend(db: D1Database): Promise<DlqTrend> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(created_at) as day,
                COUNT(CASE WHEN status != 'replayed' THEN 1 END) as new_count,
                COUNT(CASE WHEN status = 'replayed' THEN 1 END) as replayed_count,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
         FROM dlq_messages
         WHERE created_at >= datetime('now', '-14 days')
         GROUP BY DATE(created_at)
         ORDER BY day ASC`
      )
      .all<DlqDayTrend>();

    const pendingRow = await db
      .prepare(`SELECT COUNT(*) as cnt FROM dlq_messages WHERE status = 'pending'`)
      .first<{ cnt: number }>();

    const currentPending = pendingRow?.cnt ?? 0;

    // Growing if today's pending > 7 days ago pending
    const today = results[results.length - 1]?.pending_count ?? 0;
    const weekAgo = results[0]?.pending_count ?? 0;
    const backlogGrowing = today > weekAgo;

    return { days: results, backlog_growing: backlogGrowing, current_pending: currentPending };
  } catch (err) {
    console.error('[getDlqTrend] DB error:', err);
    return { days: [], backlog_growing: false, current_pending: 0 };
  }
}

// --- Observability: Self-throttle impact ---

export interface SelfThrottleImpact {
  model: string;
  event_count: number;
  total_delay_sec: number;
}

export async function getSelfThrottleImpact(db: D1Database): Promise<SelfThrottleImpact[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT json_extract(details, '$.model') as model,
                COUNT(*) as event_count,
                SUM(CAST(json_extract(details, '$.delay_seconds') AS REAL)) as total_delay_sec
         FROM events
         WHERE event_type = 'self_throttle'
           AND created_at >= datetime('now', '-7 days')
         GROUP BY json_extract(details, '$.model')
         ORDER BY total_delay_sec DESC`
      )
      .all<SelfThrottleImpact>();
    return results;
  } catch (err) {
    console.error('[getSelfThrottleImpact] DB error:', err);
    return [];
  }
}

// --- Observability: Eval latency stats ---

export interface EvalLatencyStat {
  eval_model: string;
  p50_sec: number | null;
  p95_sec: number | null;
  p99_sec: number | null;
  sample_count: number;
}

export async function getEvalLatencyStats(db: D1Database): Promise<EvalLatencyStat[]> {
  try {
    // Compute per-model percentiles using NTILE window function (SQLite 3.25+) — enabled models only
    const { results } = await db
      .prepare(
        `WITH latencies AS (
           SELECT re.eval_model,
                  (UNIXEPOCH(re.evaluated_at) - s.hn_time) as latency_sec,
                  NTILE(100) OVER (
                    PARTITION BY re.eval_model
                    ORDER BY (UNIXEPOCH(re.evaluated_at) - s.hn_time)
                  ) as pctile
           FROM rater_evals re
           JOIN stories s ON s.hn_id = re.hn_id
           INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
           WHERE re.eval_status = 'done'
             AND re.evaluated_at >= datetime('now', '-7 days')
             AND re.evaluated_at IS NOT NULL
             AND s.hn_time IS NOT NULL
             AND s.hn_time > 0
         )
         SELECT eval_model,
                COUNT(*) as sample_count,
                MAX(CASE WHEN pctile = 50 THEN latency_sec END) as p50_sec,
                MAX(CASE WHEN pctile = 95 THEN latency_sec END) as p95_sec,
                MAX(CASE WHEN pctile = 99 THEN latency_sec END) as p99_sec
         FROM latencies
         GROUP BY eval_model
         ORDER BY sample_count DESC`
      )
      .all<EvalLatencyStat>();

    return results;
  } catch {
    return [];
  }
}

// --- Observability: Signal completeness ---

export interface SignalCompletenessRow {
  eval_model: string;
  total_evals: number;
  eq_pct: number;
  so_pct: number;
  td_pct: number;
  pt_pct: number;
  tone_pct: number;
  any_below_80: boolean;
}

export async function getSignalCompleteness(db: D1Database): Promise<SignalCompletenessRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT re.eval_model,
                COUNT(*) as total_evals,
                ROUND(100.0 * COUNT(CASE WHEN re.eq_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as eq_pct,
                ROUND(100.0 * COUNT(CASE WHEN re.so_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as so_pct,
                ROUND(100.0 * COUNT(CASE WHEN re.td_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as td_pct,
                ROUND(100.0 * COUNT(CASE WHEN re.pt_flag_count IS NOT NULL THEN 1 END) / COUNT(*), 1) as pt_pct,
                ROUND(100.0 * COUNT(CASE WHEN re.et_primary_tone IS NOT NULL THEN 1 END) / COUNT(*), 1) as tone_pct
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
         GROUP BY re.eval_model
         ORDER BY total_evals DESC`
      )
      .all<Omit<SignalCompletenessRow, 'any_below_80'>>();

    return results.map(r => ({
      ...r,
      any_below_80: r.eq_pct < 80 || r.so_pct < 80 || r.td_pct < 80 || r.pt_pct < 80 || r.tone_pct < 80,
    }));
  } catch {
    return [];
  }
}

// --- Model Trust Snapshots (Phase 37B) ---

export interface ModelTrustSnapshot {
  model_id: string;
  day: string;
  calibration_accuracy: number | null;
  consensus_agreement: number | null;
  parse_success_rate: number | null;
  trust_score: number | null;
  eval_count: number;
}

export async function getModelTrustHistory(db: D1Database, days = 14): Promise<ModelTrustSnapshot[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT model_id, day, calibration_accuracy, consensus_agreement,
                parse_success_rate, trust_score, eval_count
         FROM model_trust_snapshots
         WHERE day >= date('now', ? || ' days')
         ORDER BY model_id, day ASC`
      )
      .bind(-days)
      .all<ModelTrustSnapshot>();
    return results;
  } catch {
    return [];
  }
}

// Returns trust snapshots keyed by model_id → sorted day array
export function groupTrustByModel(snapshots: ModelTrustSnapshot[]): Map<string, ModelTrustSnapshot[]> {
  const map = new Map<string, ModelTrustSnapshot[]>();
  for (const s of snapshots) {
    if (!map.has(s.model_id)) map.set(s.model_id, []);
    map.get(s.model_id)!.push(s);
  }
  return map;
}

// --- Domain Karma Map ---

export interface DomainKarmaStat {
  domain: string;
  avg_karma: number;
  user_count: number;
}

export async function getDomainKarmaMap(db: D1Database): Promise<Map<string, DomainKarmaStat>> {
  try {
    const { results } = await db.prepare(
      `SELECT s.domain, AVG(u.karma) as avg_karma, COUNT(DISTINCT u.username) as user_count
       FROM stories s
       JOIN hn_users u ON u.username = s.hn_by
       WHERE s.eval_status = 'done' AND s.domain IS NOT NULL
         AND u.karma > 0 AND s.hn_id > 0
       GROUP BY s.domain
       HAVING COUNT(DISTINCT u.username) >= 2`
    ).all<DomainKarmaStat>();
    const map = new Map<string, DomainKarmaStat>();
    for (const r of results) map.set(r.domain, r);
    return map;
  } catch (err) {
    console.error('[getDomainKarmaMap]', err);
    return new Map();
  }
}

// --- Karma vs HRCB Correlation ---

export interface KarmaHrcbPoint {
  username: string;
  karma: number;
  avg_hrcb: number;
  story_count: number;
}

export interface KarmaHrcbCorrelation {
  points: KarmaHrcbPoint[];
  pearson_r: number | null;
  count: number;
}

export async function getKarmaHrcbCorrelation(db: D1Database): Promise<KarmaHrcbCorrelation> {
  try {
    const { results: points } = await db
      .prepare(
        `SELECT u.username, u.karma,
                ROUND(AVG(s.hcb_weighted_mean), 4) as avg_hrcb,
                COUNT(*) as story_count
         FROM stories s
         JOIN hn_users u ON u.username = s.hn_by
         WHERE s.eval_status = 'done'
           AND s.hcb_weighted_mean IS NOT NULL
           AND u.karma > 0
           AND s.hn_id > 0
         GROUP BY u.username
         HAVING COUNT(*) >= 2`
      )
      .all<KarmaHrcbPoint>();

    if (points.length < 5) {
      return { points, pearson_r: null, count: points.length };
    }

    // Pearson r on log10(karma) vs avg_hrcb — JS-side to avoid D1 LOG() uncertainty
    const logK = points.map(p => Math.log10(p.karma));
    const hrcbs = points.map(p => p.avg_hrcb);
    const n = points.length;
    const sumA = logK.reduce((s, v) => s + v, 0);
    const sumB = hrcbs.reduce((s, v) => s + v, 0);
    const sumAB = logK.reduce((s, v, i) => s + v * hrcbs[i], 0);
    const sumA2 = logK.reduce((s, v) => s + v * v, 0);
    const sumB2 = hrcbs.reduce((s, v) => s + v * v, 0);
    const num = n * sumAB - sumA * sumB;
    const den = Math.sqrt(Math.max(0, n * sumA2 - sumA * sumA) * Math.max(0, n * sumB2 - sumB * sumB));
    const pearson_r = den > 0 ? num / den : null;

    return { points, pearson_r, count: n };
  } catch (err) {
    console.error('[getKarmaHrcbCorrelation]', err);
    return { points: [], pearson_r: null, count: 0 };
  }
}

// --- Content type classification validation ---

export interface ContentTypeValidationRow {
  content_type: string;
  total: number;
  avg_score: number | null;
  avg_confidence: number | null;
  missing_structural: number;
  low_evidence_only: number;
}

export async function getContentTypeValidation(db: D1Database): Promise<ContentTypeValidationRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT
          content_type,
          COUNT(*) as total,
          ROUND(AVG(hcb_weighted_mean), 4) as avg_score,
          ROUND(AVG(hcb_confidence), 4) as avg_confidence,
          SUM(CASE
            WHEN content_type IN ('PO','LP','AD','AC','CO')
              AND hcb_structural_mean IS NULL
              AND hcb_weighted_mean IS NOT NULL
            THEN 1 ELSE 0 END) as missing_structural,
          SUM(CASE
            WHEN content_type IN ('PO','LP','AD','AC','CO')
              AND hcb_evidence_h + hcb_evidence_m = 0
              AND hcb_evidence_l > 0
            THEN 1 ELSE 0 END) as low_evidence_only
         FROM stories
         WHERE eval_status = 'done' AND hn_id > 0
         GROUP BY content_type
         ORDER BY total DESC`
      )
      .all<ContentTypeValidationRow>();
    return results;
  } catch (err) {
    console.error('[getContentTypeValidation]', err);
    return [];
  }
}

export interface ContentTypeDisagreementRow {
  hn_id: number;
  type_count: number;
  types_seen: string;
  models: string;
}

export async function getContentTypeDisagreement(db: D1Database): Promise<ContentTypeDisagreementRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT
          re.hn_id,
          COUNT(DISTINCT re.content_type) as type_count,
          GROUP_CONCAT(DISTINCT re.content_type) as types_seen,
          GROUP_CONCAT(DISTINCT re.eval_model) as models
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
           AND re.content_type IS NOT NULL
           AND re.hn_id > 0
         GROUP BY re.hn_id
         HAVING COUNT(DISTINCT re.content_type) > 1
         ORDER BY type_count DESC
         LIMIT 20`
      )
      .all<ContentTypeDisagreementRow>();
    return results;
  } catch (err) {
    console.error('[getContentTypeDisagreement]', err);
    return [];
  }
}

export interface MisclassificationSummary {
  structural_heavy_total: number;
  structural_heavy_missing: number;
  misclassification_pct: number;
  disagreement_count: number;
}

export async function getMisclassificationSummary(db: D1Database): Promise<MisclassificationSummary> {
  try {
    const structRow = await db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN hcb_structural_mean IS NULL AND hcb_weighted_mean IS NOT NULL THEN 1 ELSE 0 END) as missing
         FROM stories
         WHERE eval_status = 'done'
           AND content_type IN ('PO','LP','AD','AC','CO')
           AND hn_id > 0`
      )
      .first<{ total: number; missing: number }>();

    const disagreeRow = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM (
          SELECT re.hn_id
          FROM rater_evals re
          INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
          WHERE re.eval_status = 'done'
            AND re.content_type IS NOT NULL
            AND re.hn_id > 0
          GROUP BY re.hn_id
          HAVING COUNT(DISTINCT re.content_type) > 1
        )`
      )
      .first<{ cnt: number }>();

    const total = structRow?.total ?? 0;
    const missing = structRow?.missing ?? 0;

    return {
      structural_heavy_total: total,
      structural_heavy_missing: missing,
      misclassification_pct: total > 0 ? Math.round((missing / total) * 100) : 0,
      disagreement_count: disagreeRow?.cnt ?? 0,
    };
  } catch (err) {
    console.error('[getMisclassificationSummary]', err);
    return { structural_heavy_total: 0, structural_heavy_missing: 0, misclassification_pct: 0, disagreement_count: 0 };
  }
}

// --- Eval velocity over time (light vs full by day) ---

export interface DailyEvalVelocity {
  day: string;
  prompt_mode: string;
  count: number;
}

export async function getDailyEvalVelocity(db: D1Database, days = 60): Promise<DailyEvalVelocity[]> {
  const { results } = await db
    .prepare(
      `SELECT DATE(re.evaluated_at) as day, re.prompt_mode, COUNT(*) as count
       FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       WHERE re.eval_status = 'done'
         AND re.evaluated_at IS NOT NULL
         AND re.evaluated_at >= datetime('now', '-' || ? || ' days')
       GROUP BY day, re.prompt_mode
       ORDER BY day ASC`
    )
    .bind(days)
    .all<DailyEvalVelocity>();
  return results;
}

// --- Model channel averages (HRCB / E / S per model) ---

export interface ModelChannelAverage {
  eval_model: string;
  prompt_mode: string;
  n: number;
  avg_hrcb: number | null;
  avg_e: number | null;
  avg_s: number | null;
}

export async function getModelChannelAverages(db: D1Database): Promise<ModelChannelAverage[]> {
  const { results } = await db
    .prepare(
      `SELECT re.eval_model, re.prompt_mode,
         COUNT(*) as n,
         AVG(re.hcb_weighted_mean) as avg_hrcb,
         AVG(re.hcb_editorial_mean) as avg_e,
         AVG(re.hcb_structural_mean) as avg_s
       FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model
       WHERE re.eval_status = 'done'
         AND re.hcb_editorial_mean IS NOT NULL
         AND re.hn_id > 0
         AND mr.enabled = 1
       GROUP BY re.eval_model, re.prompt_mode
       ORDER BY n DESC`
    )
    .all<ModelChannelAverage>();
  return results;
}

// --- Coverage progression (new stories entering each tier per day) ---

export interface CoverageProgressionRow {
  day: string;
  full: number;
  lite: number;
}

export async function getCoverageProgression(db: D1Database, days = 30): Promise<CoverageProgressionRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(first_eval) as day,
                SUM(CASE WHEN is_full = 1 THEN 1 ELSE 0 END) as full,
                SUM(CASE WHEN is_full = 0 THEN 1 ELSE 0 END) as lite
         FROM (
           SELECT re.hn_id,
                  MIN(re.evaluated_at) as first_eval,
                  MAX(CASE WHEN re.prompt_mode = 'full' THEN 1 ELSE 0 END) as is_full
           FROM rater_evals re
           INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
           WHERE re.eval_status = 'done'
             AND re.hn_id > 0
             AND re.evaluated_at IS NOT NULL
           GROUP BY re.hn_id
           HAVING MIN(re.evaluated_at) >= datetime('now', '-' || ? || ' days')
         ) sub
         GROUP BY day
         ORDER BY day ASC`
      )
      .bind(days)
      .all<CoverageProgressionRow>();
    return results;
  } catch (err) {
    console.error('[getCoverageProgression]', err);
    return [];
  }
}

// --- Content type eval mix (coverage state breakdown per content type) ---

export interface ContentTypeEvalMixRow {
  content_type: string;
  done: number;
  gated: number;
  failed_skipped: number;
  pending: number;
  total: number;
}

export async function getContentTypeEvalMix(db: D1Database): Promise<ContentTypeEvalMixRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT COALESCE(content_type, 'UNKNOWN') as content_type,
                SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END) as done,
                SUM(CASE WHEN gate_category IS NOT NULL THEN 1 ELSE 0 END) as gated,
                SUM(CASE WHEN eval_status IN ('failed','skipped') AND gate_category IS NULL THEN 1 ELSE 0 END) as failed_skipped,
                SUM(CASE WHEN eval_status IN ('pending','queued','evaluating') AND gate_category IS NULL THEN 1 ELSE 0 END) as pending,
                COUNT(*) as total
         FROM stories
         WHERE hn_id > 0
         GROUP BY content_type
         ORDER BY total DESC
         LIMIT 15`
      )
      .all<ContentTypeEvalMixRow>();
    return results;
  } catch (err) {
    console.error('[getContentTypeEvalMix]', err);
    return [];
  }
}

// --- Truncation impact (score bias when content is cut for small-context models) ---

export interface TruncationImpactRow {
  eval_model: string;
  n: number;
  truncated_count: number;
  avg_truncation_pct: number;
  avg_score_truncated: number | null;
  avg_score_full: number | null;
}

export async function getTruncationImpact(db: D1Database): Promise<TruncationImpactRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT re.eval_model,
                COUNT(*) as n,
                SUM(CASE WHEN re.content_truncation_pct > 0 THEN 1 ELSE 0 END) as truncated_count,
                ROUND(AVG(CASE WHEN re.content_truncation_pct > 0 THEN re.content_truncation_pct ELSE NULL END) * 100, 1) as avg_truncation_pct,
                AVG(CASE WHEN re.content_truncation_pct > 0 THEN re.hcb_editorial_mean ELSE NULL END) as avg_score_truncated,
                AVG(CASE WHEN re.content_truncation_pct = 0 OR re.content_truncation_pct IS NULL THEN re.hcb_editorial_mean ELSE NULL END) as avg_score_full
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
           AND re.hn_id > 0
           AND re.content_truncation_pct IS NOT NULL
         GROUP BY re.eval_model
         ORDER BY truncated_count DESC`
      )
      .all<TruncationImpactRow>();
    return results;
  } catch (err) {
    console.error('[getTruncationImpact]', err);
    return [];
  }
}

// --- Cost attribution (token usage + estimated cost per model) ---

export interface DailyCostRow {
  eval_day: string;      // 'YYYY-MM-DD'
  eval_model: string;
  eval_provider: string;
  tokens_in: number;
  tokens_out: number;
  eval_count: number;
}

export async function getDailyCostStats(db: D1Database): Promise<DailyCostRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(re.evaluated_at) as eval_day,
                re.eval_model,
                re.eval_provider,
                SUM(COALESCE(re.input_tokens, 0)) as tokens_in,
                SUM(COALESCE(re.output_tokens, 0)) as tokens_out,
                COUNT(*) as eval_count
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
           AND re.hn_id > 0
           AND re.evaluated_at >= datetime('now', '-14 days')
         GROUP BY eval_day, re.eval_model, re.eval_provider
         ORDER BY eval_day ASC, tokens_in DESC`
      )
      .all<DailyCostRow>();
    return results;
  } catch (err) {
    console.error('[getDailyCostStats]', err);
    return [];
  }
}

export interface CostStatRow {
  eval_model: string;
  eval_provider: string;
  evals_7d: number;
  evals_30d: number;
  tokens_in_7d: number;
  tokens_out_7d: number;
  tokens_in_30d: number;
  tokens_out_30d: number;
}

export async function getCostStats(db: D1Database): Promise<CostStatRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT re.eval_model,
                re.eval_provider,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) as evals_7d,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) as evals_30d,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-7 days') THEN COALESCE(re.input_tokens,0) ELSE 0 END) as tokens_in_7d,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-7 days') THEN COALESCE(re.output_tokens,0) ELSE 0 END) as tokens_out_7d,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-30 days') THEN COALESCE(re.input_tokens,0) ELSE 0 END) as tokens_in_30d,
                SUM(CASE WHEN re.evaluated_at >= datetime('now','-30 days') THEN COALESCE(re.output_tokens,0) ELSE 0 END) as tokens_out_30d
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
           AND re.hn_id > 0
           AND re.evaluated_at IS NOT NULL
         GROUP BY re.eval_model, re.eval_provider
         ORDER BY tokens_in_7d DESC`
      )
      .all<CostStatRow>();
    return results;
  } catch (err) {
    console.error('[getCostStats]', err);
    return [];
  }
}

// --- Article deep dive analytics ---

export interface ArticleDetailStats {
  count: number;
  avg_final: number | null;
  min_final: number | null;
  max_final: number | null;
  variance: number | null;
  evidence_h: number;
  evidence_m: number;
  evidence_l: number;
  evidence_nd: number;
}

export async function getArticleDetailStats(db: D1Database, section: string): Promise<ArticleDetailStats | null> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) as count,
                AVG(sc.final) as avg_final,
                MIN(sc.final) as min_final,
                MAX(sc.final) as max_final,
                MAX(0.0, AVG(sc.final * sc.final) - AVG(sc.final) * AVG(sc.final)) as variance,
                SUM(CASE WHEN sc.evidence = 'H' THEN 1 ELSE 0 END) as evidence_h,
                SUM(CASE WHEN sc.evidence = 'M' THEN 1 ELSE 0 END) as evidence_m,
                SUM(CASE WHEN sc.evidence = 'L' THEN 1 ELSE 0 END) as evidence_l,
                SUM(CASE WHEN sc.evidence IS NULL THEN 1 ELSE 0 END) as evidence_nd
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id AND s.eval_model = sc.eval_model
         INNER JOIN model_registry mr ON mr.model_id = sc.eval_model AND mr.enabled = 1
         WHERE sc.section = ? AND sc.final IS NOT NULL AND TYPEOF(sc.final) != 'text'`
      )
      .bind(section)
      .first<ArticleDetailStats>();
    return row ?? null;
  } catch (err) {
    console.error('[getArticleDetailStats]', err);
    return null;
  }
}

export interface DirectionalityBreakdownRow {
  marker: string;
  cnt: number;
}

export async function getArticleDirectionalityBreakdown(
  db: D1Database,
  section: string
): Promise<DirectionalityBreakdownRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT je.value as marker, COUNT(*) as cnt
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id AND s.eval_model = sc.eval_model
         INNER JOIN model_registry mr ON mr.model_id = sc.eval_model AND mr.enabled = 1,
         json_each(sc.directionality) je
         WHERE sc.section = ? AND sc.final IS NOT NULL AND TYPEOF(sc.final) != 'text'
           AND sc.directionality IS NOT NULL
           AND sc.directionality NOT IN ('[]', 'null', '')
         GROUP BY je.value
         ORDER BY cnt DESC`
      )
      .bind(section)
      .all<DirectionalityBreakdownRow>();
    return results;
  } catch (err) {
    console.error('[getArticleDirectionalityBreakdown]', err);
    return [];
  }
}

export interface ThemeBreakdownRow {
  theme: string;
  cnt: number;
}

export async function getArticleThemeBreakdown(
  db: D1Database,
  section: string
): Promise<ThemeBreakdownRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT s.hcb_theme_tag as theme, COUNT(*) as cnt
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id AND s.eval_model = sc.eval_model
         INNER JOIN model_registry mr ON mr.model_id = sc.eval_model AND mr.enabled = 1
         WHERE sc.section = ? AND sc.final IS NOT NULL AND TYPEOF(sc.final) != 'text'
           AND s.hcb_theme_tag IS NOT NULL AND s.hcb_theme_tag != ''
         GROUP BY s.hcb_theme_tag
         ORDER BY cnt DESC
         LIMIT 12`
      )
      .bind(section)
      .all<ThemeBreakdownRow>();
    return results;
  } catch (err) {
    console.error('[getArticleThemeBreakdown]', err);
    return [];
  }
}

// --- Content accessibility aggregates (Tier 1 mission: Article 26 — right to education) ---

/**
 * Corpus-wide complexity and accessibility distributions.
 *
 * Surfaces the invisible: "X% of tech news assumes expert knowledge" — makes
 * Article 26's relationship to exclusionary discourse visible at corpus scale.
 *
 * cl_jargon_density and cl_assumed_knowledge are TEXT columns on the stories
 * table, written by writeEvalResult. NULL = field not measured (lite evals).
 */
export interface ComplexityAggregates {
  total_evaluated: number;      // done stories, hn_id > 0
  total_measured: number;       // stories with cl_jargon_density IS NOT NULL
  // jargon density counts
  jargon_low: number;
  jargon_medium: number;
  jargon_high: number;
  // assumed knowledge counts
  knowledge_none: number;
  knowledge_general: number;
  knowledge_domain_specific: number;
  knowledge_expert: number;
  // derived percentages (of total_measured)
  high_jargon_pct: number | null;    // % where jargon is high
  expert_pct: number | null;         // % where assumed_knowledge is expert
  accessible_pct: number | null;     // % where jargon=low AND knowledge in (none, general)
}

export async function getComplexityAggregates(db: D1Database): Promise<ComplexityAggregates | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*)                                                                         AS total_evaluated,
           SUM(CASE WHEN cl_jargon_density IS NOT NULL THEN 1 ELSE 0 END)                 AS total_measured,
           SUM(CASE WHEN cl_jargon_density = 'low'    THEN 1 ELSE 0 END)                  AS jargon_low,
           SUM(CASE WHEN cl_jargon_density = 'medium' THEN 1 ELSE 0 END)                  AS jargon_medium,
           SUM(CASE WHEN cl_jargon_density = 'high'   THEN 1 ELSE 0 END)                  AS jargon_high,
           SUM(CASE WHEN cl_assumed_knowledge = 'none'           THEN 1 ELSE 0 END)        AS knowledge_none,
           SUM(CASE WHEN cl_assumed_knowledge = 'general'        THEN 1 ELSE 0 END)        AS knowledge_general,
           SUM(CASE WHEN cl_assumed_knowledge = 'domain_specific' THEN 1 ELSE 0 END)       AS knowledge_domain_specific,
           SUM(CASE WHEN cl_assumed_knowledge = 'expert'         THEN 1 ELSE 0 END)        AS knowledge_expert,
           ROUND(100.0 * SUM(CASE WHEN cl_jargon_density = 'high' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN cl_jargon_density IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                                           AS high_jargon_pct,
           ROUND(100.0 * SUM(CASE WHEN cl_assumed_knowledge = 'expert' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN cl_assumed_knowledge IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                                           AS expert_pct,
           ROUND(100.0 * SUM(CASE WHEN cl_jargon_density = 'low'
                                    AND cl_assumed_knowledge IN ('none', 'general')
                                   THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN cl_jargon_density IS NOT NULL
                                   AND cl_assumed_knowledge IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                                           AS accessible_pct
         FROM stories
         WHERE eval_status = 'done' AND hn_id > 0`
      )
      .first<ComplexityAggregates>();
    return row ?? null;
  } catch (err) {
    console.error('[getComplexityAggregates]', err);
    return null;
  }
}

// --- Temporal framing aggregates (Tier 2 mission: how tech news frames time) ---

/**
 * Corpus-wide temporal framing distributions.
 *
 * Surfaces the invisible: "X% of tech content is retrospective (analyzing
 * breaches/failures) vs Y% prospective (solutions/prevention)" — reveals
 * the reactive vs proactive character of the discourse.
 *
 * tf_primary_focus is a TEXT column, written by writeEvalResult.
 * NULL = not measured (lite evals).
 */
export interface TemporalFramingAggregates {
  total_evaluated: number;     // done stories, hn_id > 0
  total_measured: number;      // stories with tf_primary_focus IS NOT NULL
  retrospective: number;
  present: number;
  prospective: number;
  mixed: number;
  retrospective_pct: number | null;
  present_pct: number | null;
  prospective_pct: number | null;
  mixed_pct: number | null;
  // time horizon sub-distribution
  horizon_immediate: number;
  horizon_short_term: number;
  horizon_medium_term: number;
  horizon_long_term: number;
  horizon_historical: number;
  horizon_unspecified: number;
}

export async function getTemporalFramingAggregates(db: D1Database): Promise<TemporalFramingAggregates | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*)                                                                           AS total_evaluated,
           SUM(CASE WHEN tf_primary_focus IS NOT NULL THEN 1 ELSE 0 END)                    AS total_measured,
           SUM(CASE WHEN tf_primary_focus = 'retrospective' THEN 1 ELSE 0 END)              AS retrospective,
           SUM(CASE WHEN tf_primary_focus = 'present'       THEN 1 ELSE 0 END)              AS present,
           SUM(CASE WHEN tf_primary_focus = 'prospective'   THEN 1 ELSE 0 END)              AS prospective,
           SUM(CASE WHEN tf_primary_focus = 'mixed'         THEN 1 ELSE 0 END)              AS mixed,
           ROUND(100.0 * SUM(CASE WHEN tf_primary_focus = 'retrospective' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN tf_primary_focus IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS retrospective_pct,
           ROUND(100.0 * SUM(CASE WHEN tf_primary_focus = 'present' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN tf_primary_focus IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS present_pct,
           ROUND(100.0 * SUM(CASE WHEN tf_primary_focus = 'prospective' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN tf_primary_focus IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS prospective_pct,
           ROUND(100.0 * SUM(CASE WHEN tf_primary_focus = 'mixed' THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN tf_primary_focus IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS mixed_pct,
           SUM(CASE WHEN tf_time_horizon = 'immediate'   THEN 1 ELSE 0 END)                 AS horizon_immediate,
           SUM(CASE WHEN tf_time_horizon = 'short_term'  THEN 1 ELSE 0 END)                 AS horizon_short_term,
           SUM(CASE WHEN tf_time_horizon = 'medium_term' THEN 1 ELSE 0 END)                 AS horizon_medium_term,
           SUM(CASE WHEN tf_time_horizon = 'long_term'   THEN 1 ELSE 0 END)                 AS horizon_long_term,
           SUM(CASE WHEN tf_time_horizon = 'historical'  THEN 1 ELSE 0 END)                 AS horizon_historical,
           SUM(CASE WHEN tf_time_horizon = 'unspecified' THEN 1 ELSE 0 END)                 AS horizon_unspecified
         FROM stories
         WHERE eval_status = 'done' AND hn_id > 0`
      )
      .first<TemporalFramingAggregates>();
    return row ?? null;
  } catch (err) {
    console.error('[getTemporalFramingAggregates]', err);
    return null;
  }
}

// --- Transparency disclosure rates (Tier 1 mission: Article 19 accountability) ---

/**
 * Corpus-wide transparency disclosure aggregates.
 *
 * Surfaces the invisible: "Only X% of stories identify their author" — makes
 * Article 19's relationship to accountability visible at corpus scale.
 *
 * td_author_identified, td_conflicts_disclosed, td_funding_disclosed are
 * INTEGER (0/1/NULL) columns on the stories table, written by writeEvalResult.
 * NULL = field not measured (TD section absent in that eval).
 */
export interface TdSignalAggregates {
  total_evaluated: number;          // done stories, hn_id > 0
  td_measured: number;              // stories where td_score IS NOT NULL
  td_measured_pct: number | null;   // % of evaluated stories with TD data
  author_identified_pct: number | null;   // of td_measured: % where author was identified
  conflicts_disclosed_pct: number | null; // of td_measured: % where conflicts were disclosed
  funding_disclosed_pct: number | null;   // of td_measured: % where funding was disclosed
  any_disclosure_pct: number | null;      // of td_measured: % with at least one disclosure=1
  avg_td_score: number | null;
  high_td_pct: number | null;   // % of td_measured with td_score >= 0.5 (strong transparency)
  low_td_pct: number | null;    // % of td_measured with td_score <= -0.3 (poor transparency)
}

export async function getTdSignalAggregates(db: D1Database): Promise<TdSignalAggregates | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*)                                                          AS total_evaluated,
           SUM(CASE WHEN td_score IS NOT NULL THEN 1 ELSE 0 END)            AS td_measured,
           ROUND(100.0 * SUM(CASE WHEN td_score IS NOT NULL THEN 1 ELSE 0 END) /
                 NULLIF(COUNT(*), 0), 1)                                    AS td_measured_pct,
           ROUND(100.0 * SUM(CASE WHEN td_author_identified = 1 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_author_identified IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS author_identified_pct,
           ROUND(100.0 * SUM(CASE WHEN td_conflicts_disclosed = 1 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_conflicts_disclosed IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS conflicts_disclosed_pct,
           ROUND(100.0 * SUM(CASE WHEN td_funding_disclosed = 1 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_funding_disclosed IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS funding_disclosed_pct,
           ROUND(100.0 * SUM(CASE WHEN (td_author_identified = 1 OR td_conflicts_disclosed = 1
                                         OR td_funding_disclosed = 1) THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_score IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS any_disclosure_pct,
           ROUND(AVG(CASE WHEN td_score IS NOT NULL THEN td_score END), 4)  AS avg_td_score,
           ROUND(100.0 * SUM(CASE WHEN td_score >= 0.5 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_score IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS high_td_pct,
           ROUND(100.0 * SUM(CASE WHEN td_score <= -0.3 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN td_score IS NOT NULL THEN 1 ELSE 0 END), 0), 1)
                                                                            AS low_td_pct
         FROM stories
         WHERE eval_status = 'done' AND hn_id > 0`
      )
      .first<TdSignalAggregates>();
    return row ?? null;
  } catch (err) {
    console.error('[getTdSignalAggregates]', err);
    return null;
  }
}

