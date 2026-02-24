import type { Score } from './types';

export interface Story {
  hn_id: number;
  url: string | null;
  title: string;
  domain: string | null;
  hn_score: number | null;
  hn_comments: number | null;
  hn_by: string | null;
  hn_time: number;
  hn_type: string;
  hn_text: string | null;
  content_type: string;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  hcb_signal_sections: number | null;
  hcb_nd_count: number | null;
  hcb_json: string | null;
  eval_model: string | null;
  eval_prompt_hash: string | null;
  eval_status: string;
  eval_error: string | null;
  evaluated_at: string | null;
  created_at: string;
}

export interface ScoreRow {
  hn_id: number;
  section: string;
  sort_order: number;
  final: number | null;
  editorial: number | null;
  structural: number | null;
  evidence: string | null;
  directionality: string;
  note: string;
}

export interface StoryWithScores extends Story {
  scores: Score[];
}

export interface ArticleRankingRow {
  hn_id: number;
  title: string;
  domain: string | null;
  url: string | null;
  hn_score: number | null;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  section: string;
  final: number | null;
  editorial: number | null;
  structural: number | null;
  evidence: string | null;
  note: string;
}

function scoreRowToScore(row: ScoreRow): Score {
  return {
    section: row.section,
    editorial: row.editorial,
    structural: row.structural,
    combined: null,
    context_modifier: null,
    final: row.final,
    directionality: JSON.parse(row.directionality || '[]'),
    evidence: row.evidence,
    note: row.note,
  };
}

export type SortOption = 'time' | 'score_desc' | 'score_asc' | 'hn_points';
export type FilterOption = 'all' | 'evaluated' | 'positive' | 'negative' | 'neutral' | 'pending' | 'failed';
export type TypeOption = 'all' | 'ask' | 'show' | 'best';

// --- Feed page: single JOIN query replaces N+1 ---

interface FeedScoreRow {
  hn_id: number;
  section: string;
  sort_order: number;
  final: number | null;
}

export interface StoryWithMiniScores extends Story {
  miniScores: Score[];
}

export async function getFilteredStoriesWithScores(
  db: D1Database,
  sort: SortOption = 'time',
  filter: FilterOption = 'all',
  type: TypeOption = 'all',
  limit = 30,
  offset = 0
): Promise<StoryWithMiniScores[]> {
  const conditions: string[] = ['1=1'];
  switch (filter) {
    case 'evaluated': conditions.push("s.eval_status = 'done'"); break;
    case 'positive': conditions.push("s.eval_status = 'done' AND s.hcb_weighted_mean > 0.05"); break;
    case 'negative': conditions.push("s.eval_status = 'done' AND s.hcb_weighted_mean < -0.05"); break;
    case 'neutral': conditions.push("s.eval_status = 'done' AND s.hcb_weighted_mean BETWEEN -0.05 AND 0.05"); break;
    case 'pending': conditions.push("s.eval_status IN ('pending', 'evaluating')"); break;
    case 'failed': conditions.push("s.eval_status IN ('failed', 'skipped')"); break;
  }

  switch (type) {
    case 'ask': conditions.push("s.hn_type = 'ask'"); break;
    case 'show': conditions.push("s.hn_type = 'show'"); break;
  }

  const where = conditions.join(' AND ');

  let orderBy = 's.hn_time DESC';
  switch (sort) {
    case 'score_desc': orderBy = 's.hcb_weighted_mean DESC NULLS LAST'; break;
    case 'score_asc': orderBy = 's.hcb_weighted_mean ASC NULLS LAST'; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
  }

  // Single query: stories only (excludes hcb_json and hn_text blobs).
  // Heatmaps are only shown on detail pages, not in the feed — no need to fetch scores here.
  const { results: storyRows } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_score, hn_comments, hn_by,
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, eval_model, eval_prompt_hash,
              eval_status, eval_error, evaluated_at, created_at
       FROM stories s WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'>>();

  return storyRows.map(story => ({
    ...story,
    hn_text: null,
    hcb_json: null,
    miniScores: [],
  }));
}

// --- Detail page ---

export async function getStory(db: D1Database, hnId: number): Promise<StoryWithScores | null> {
  const story = await db
    .prepare(`SELECT * FROM stories WHERE hn_id = ?`)
    .bind(hnId)
    .first<Story>();

  if (!story) return null;

  const { results: scoreRows } = await db
    .prepare(`SELECT * FROM scores WHERE hn_id = ? ORDER BY sort_order`)
    .bind(hnId)
    .all<ScoreRow>();

  return {
    ...story,
    scores: scoreRows.map(scoreRowToScore),
  };
}

export async function getStoryScores(db: D1Database, hnId: number): Promise<Score[]> {
  const { results } = await db
    .prepare(`SELECT * FROM scores WHERE hn_id = ? ORDER BY sort_order`)
    .bind(hnId)
    .all<ScoreRow>();
  return results.map(scoreRowToScore);
}

// --- Article ranking ---

export async function getArticleRanking(
  db: D1Database,
  articleNum: number
): Promise<ArticleRankingRow[]> {
  const section = articleNum === 0 ? 'Preamble' : `Article ${articleNum}`;
  const { results } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.domain, s.url, s.hn_score,
              s.hcb_weighted_mean, s.hcb_classification,
              sc.section, sc.final, sc.editorial, sc.structural,
              sc.evidence, sc.note
       FROM scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE sc.section = ? AND sc.final IS NOT NULL
       ORDER BY sc.final DESC`
    )
    .bind(section)
    .all<ArticleRankingRow>();
  return results;
}

// --- Cron helpers ---

export async function getPendingStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'pending' ORDER BY hn_time DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

// --- Stats ---

export async function getEvaluatedCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as cnt FROM stories WHERE eval_status = 'done'`)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function getScoreStats(db: D1Database): Promise<{
  avgScore: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}> {
  const row = await db
    .prepare(
      `SELECT
        COALESCE(AVG(hcb_weighted_mean), 0) as avg_score,
        SUM(CASE WHEN hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) as positive_count,
        SUM(CASE WHEN hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END) as neutral_count,
        SUM(CASE WHEN hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) as negative_count
       FROM stories WHERE eval_status = 'done'`
    )
    .first<{
      avg_score: number;
      positive_count: number;
      neutral_count: number;
      negative_count: number;
    }>();

  return {
    avgScore: row?.avg_score ?? 0,
    positiveCount: row?.positive_count ?? 0,
    neutralCount: row?.neutral_count ?? 0,
    negativeCount: row?.negative_count ?? 0,
  };
}

// --- Dashboard queries ---

export interface StatusCounts {
  done: number;
  pending: number;
  evaluating: number;
  failed: number;
  skipped: number;
  total: number;
}

export async function getStatusCounts(db: D1Database): Promise<StatusCounts> {
  const { results } = await db
    .prepare(`SELECT eval_status, COUNT(*) as cnt FROM stories GROUP BY eval_status`)
    .all<{ eval_status: string; cnt: number }>();

  const counts: StatusCounts = { done: 0, pending: 0, evaluating: 0, failed: 0, skipped: 0, total: 0 };
  for (const r of results) {
    const key = r.eval_status as keyof Omit<StatusCounts, 'total'>;
    if (key in counts) counts[key] = r.cnt;
    counts.total += r.cnt;
  }
  return counts;
}

export interface ContentTypeStat {
  content_type: string;
  count: number;
  avg_score: number;
}

export async function getContentTypeStats(db: D1Database): Promise<ContentTypeStat[]> {
  const { results } = await db
    .prepare(
      `SELECT content_type, COUNT(*) as count, AVG(hcb_weighted_mean) as avg_score
       FROM stories WHERE eval_status = 'done'
       GROUP BY content_type ORDER BY count DESC`
    )
    .all<ContentTypeStat>();
  return results;
}

export interface ArticleAvg {
  section: string;
  sort_order: number;
  avg_final: number;
  signal_count: number;
  nd_count: number;
}

export async function getArticleAverages(db: D1Database): Promise<ArticleAvg[]> {
  const { results } = await db
    .prepare(
      `SELECT section, sort_order,
              AVG(final) as avg_final,
              SUM(CASE WHEN final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
              SUM(CASE WHEN final IS NULL THEN 1 ELSE 0 END) as nd_count
       FROM scores
       GROUP BY section
       ORDER BY sort_order`
    )
    .all<ArticleAvg>();
  return results;
}

export async function getTopPositiveStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'done'
       ORDER BY hcb_weighted_mean DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export async function getTopNegativeStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'done'
       ORDER BY hcb_weighted_mean ASC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export async function getRecentEvaluations(db: D1Database, limit = 10): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'done'
       ORDER BY evaluated_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export interface DomainStat {
  domain: string;
  count: number;
  avg_score: number;
}

export async function getDomainStats(db: D1Database, limit = 10): Promise<DomainStat[]> {
  const { results } = await db
    .prepare(
      `SELECT domain, COUNT(*) as count, AVG(hcb_weighted_mean) as avg_score
       FROM stories WHERE eval_status = 'done' AND domain IS NOT NULL
       GROUP BY domain ORDER BY count DESC LIMIT ?`
    )
    .bind(limit)
    .all<DomainStat>();
  return results;
}

export async function getQueueStories(db: D1Database): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status IN ('pending', 'evaluating')
       ORDER BY
         CASE eval_status WHEN 'evaluating' THEN 0 WHEN 'pending' THEN 1 END,
         hn_time DESC`
    )
    .all<Story>();
  return results;
}

export interface ModelStat {
  eval_model: string;
  count: number;
  avg_score: number;
}

export async function getModelStats(db: D1Database): Promise<ModelStat[]> {
  const { results } = await db
    .prepare(
      `SELECT eval_model, COUNT(*) as count, AVG(hcb_weighted_mean) as avg_score
       FROM stories WHERE eval_status = 'done' AND eval_model IS NOT NULL
       GROUP BY eval_model ORDER BY count DESC`
    )
    .all<ModelStat>();
  return results;
}

export async function getTodayEvalCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as cnt FROM stories WHERE eval_status = 'done' AND evaluated_at >= date('now')`)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function getFailedStories(db: D1Database, limit = 10): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'failed'
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}
