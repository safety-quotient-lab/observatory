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

// --- Cost tracking ---

export interface CostStats {
  total_evals: number;
  total_input_tokens: number;
  total_output_tokens: number;
  today_evals: number;
  today_input_tokens: number;
  today_output_tokens: number;
}

export async function getCostStats(db: D1Database): Promise<CostStats> {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) as total_evals,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        SUM(CASE WHEN evaluated_at >= date('now') THEN 1 ELSE 0 END) as today_evals,
        COALESCE(SUM(CASE WHEN evaluated_at >= date('now') THEN input_tokens ELSE 0 END), 0) as today_input_tokens,
        COALESCE(SUM(CASE WHEN evaluated_at >= date('now') THEN output_tokens ELSE 0 END), 0) as today_output_tokens
       FROM eval_history`
    )
    .first<{
      total_evals: number;
      total_input_tokens: number;
      total_output_tokens: number;
      today_evals: number;
      today_input_tokens: number;
      today_output_tokens: number;
    }>();
  return {
    total_evals: row?.total_evals ?? 0,
    total_input_tokens: row?.total_input_tokens ?? 0,
    total_output_tokens: row?.total_output_tokens ?? 0,
    today_evals: row?.today_evals ?? 0,
    today_input_tokens: row?.today_input_tokens ?? 0,
    today_output_tokens: row?.today_output_tokens ?? 0,
  };
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
       FROM scores a JOIN scores b ON a.hn_id = b.hn_id
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
  // Rolling rate from rater_evals (captures multi-model throughput)
  const recent = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN evaluated_at >= datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN evaluated_at >= datetime('now', '-7 days') THEN 1 END) as evals_7d
       FROM rater_evals WHERE eval_status = 'done' AND evaluated_at IS NOT NULL`
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
       FROM stories s JOIN scores sc ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
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
  pt_flags_json: string | null;
  hcb_weighted_mean: number | null;
  hcb_editorial_mean: number | null;
}

export async function getTopPropagandaStories(db: D1Database, limit = 10): Promise<PropagandaStory[]> {
  const { results } = await db
    .prepare(
      `SELECT hn_id, title, url, domain, pt_flag_count, pt_flags_json, hcb_weighted_mean, hcb_editorial_mean
       FROM stories
       WHERE eval_status = 'done' AND pt_flag_count > 0
       ORDER BY pt_flag_count DESC
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
       LIMIT 10000`
    )
    .all<{ sr_who_speaks: string | null; sr_who_spoken_about: string | null }>();

  const speaksCounts: Record<string, number> = {};
  const aboutCounts: Record<string, number> = {};

  for (const r of results) {
    if (r.sr_who_speaks) {
      for (const s of r.sr_who_speaks.split(',').map(s => s.trim()).filter(Boolean)) {
        speaksCounts[s] = (speaksCounts[s] || 0) + 1;
      }
    }
    if (r.sr_who_spoken_about) {
      for (const s of r.sr_who_spoken_about.split(',').map(s => s.trim()).filter(Boolean)) {
        aboutCounts[s] = (aboutCounts[s] || 0) + 1;
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
       LIMIT 50000`
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
         eval_provider,
         COUNT(CASE WHEN eval_status = 'done' THEN 1 END) as evals_total,
         COUNT(CASE WHEN eval_status = 'done'
                     AND evaluated_at > datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN eval_status = 'done'
                     AND evaluated_at > datetime('now', '-7 days') THEN 1 END) as evals_7d,
         MAX(CASE WHEN eval_status = 'done' THEN evaluated_at END) as last_eval,
         COUNT(CASE WHEN eval_status = 'failed'
                     AND evaluated_at > datetime('now', '-1 day') THEN 1 END) as failed_24h
       FROM rater_evals
       GROUP BY eval_provider
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
         eval_model,
         eval_provider,
         COUNT(CASE WHEN eval_status = 'done'
                     AND evaluated_at > datetime('now', '-1 day') THEN 1 END) as evals_24h,
         COUNT(CASE WHEN eval_status = 'done'
                     AND evaluated_at > datetime('now', '-7 days') THEN 1 END) as evals_7d,
         MAX(CASE WHEN eval_status = 'done' THEN evaluated_at END) as last_eval,
         COUNT(CASE WHEN eval_status IN ('queued', 'evaluating', 'pending') THEN 1 END) as in_flight
       FROM rater_evals
       GROUP BY eval_model, eval_provider
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
  } catch {
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
  } catch {
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
    // Compute per-model percentiles using NTILE window function (SQLite 3.25+)
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
        `SELECT eval_model,
                COUNT(*) as total_evals,
                ROUND(100.0 * COUNT(CASE WHEN eq_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as eq_pct,
                ROUND(100.0 * COUNT(CASE WHEN so_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as so_pct,
                ROUND(100.0 * COUNT(CASE WHEN td_score IS NOT NULL THEN 1 END) / COUNT(*), 1) as td_pct,
                ROUND(100.0 * COUNT(CASE WHEN pt_flag_count IS NOT NULL THEN 1 END) / COUNT(*), 1) as pt_pct,
                ROUND(100.0 * COUNT(CASE WHEN et_primary_tone IS NOT NULL THEN 1 END) / COUNT(*), 1) as tone_pct
         FROM rater_evals
         WHERE eval_status = 'done'
         GROUP BY eval_model
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
          hn_id,
          COUNT(DISTINCT content_type) as type_count,
          GROUP_CONCAT(DISTINCT content_type) as types_seen,
          GROUP_CONCAT(DISTINCT eval_model) as models
         FROM rater_evals
         WHERE eval_status = 'done'
           AND content_type IS NOT NULL
           AND hn_id > 0
         GROUP BY hn_id
         HAVING COUNT(DISTINCT content_type) > 1
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
          SELECT hn_id
          FROM rater_evals
          WHERE eval_status = 'done'
            AND content_type IS NOT NULL
            AND hn_id > 0
          GROUP BY hn_id
          HAVING COUNT(DISTINCT content_type) > 1
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
