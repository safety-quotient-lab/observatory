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
  content_type: string;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  hcb_signal_sections: number | null;
  hcb_nd_count: number | null;
  hcb_json: string | null;
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

export async function getTopStories(db: D1Database, limit = 30): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories ORDER BY hn_time DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

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

export async function getArticleRanking(
  db: D1Database,
  articleNum: number,
  limit = 50
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
       ORDER BY sc.final DESC
       LIMIT ?`
    )
    .bind(section, limit)
    .all<ArticleRankingRow>();
  return results;
}

export async function getPendingStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status = 'pending' ORDER BY hn_time DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

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
