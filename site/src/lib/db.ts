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
  hcb_evidence_h: number | null;
  hcb_evidence_m: number | null;
  hcb_evidence_l: number | null;
  hcb_json: string | null;
  eval_model: string | null;
  eval_prompt_hash: string | null;
  eval_status: string;
  eval_error: string | null;
  evaluated_at: string | null;
  created_at: string;
  hn_rank: number | null;
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
  hn_comments: number | null;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  hcb_signal_sections: number | null;
  hcb_nd_count: number | null;
  hcb_evidence_h: number | null;
  hcb_evidence_m: number | null;
  hcb_evidence_l: number | null;
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

export type SortOption = 'top' | 'time' | 'score_desc' | 'score_asc' | 'hn_points' | 'setl_desc' | 'setl_asc' | 'hotl_desc' | 'hotl_asc' | 'salient' | 'outliers' | 'controversial';
export type FilterOption = 'all' | 'evaluated' | 'positive' | 'negative' | 'neutral' | 'pending' | 'failed';
export type TypeOption = 'all' | 'ask' | 'show';

// --- Feed page: single JOIN query replaces N+1 ---

interface FeedScoreRow {
  hn_id: number;
  section: string;
  sort_order: number;
  final: number | null;
}

export interface MiniScore {
  section: string;
  final: number | null;
  editorial: number | null;
  structural: number | null;
}

export interface StoryWithMiniScores extends Story {
  miniScores: MiniScore[];
  hn_text_preview: string | null;
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
  let joinSetl = false;
  let joinHotl = false;
  switch (sort) {
    case 'top': orderBy = 's.hn_rank ASC NULLS LAST, s.hn_time DESC'; break;
    case 'score_desc': orderBy = 's.hcb_weighted_mean DESC NULLS LAST'; break;
    case 'score_asc': orderBy = 's.hcb_weighted_mean ASC NULLS LAST'; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
    case 'setl_desc': joinSetl = true; orderBy = 'story_setl DESC NULLS LAST'; break;
    case 'setl_asc': joinSetl = true; orderBy = 'story_setl ASC NULLS LAST'; break;
    case 'hotl_desc': joinHotl = true; orderBy = 'hotl DESC NULLS LAST'; break;
    case 'hotl_asc': joinHotl = true; orderBy = 'hotl ASC NULLS LAST'; break;
    // salient: high positive SETL + low (negative) HOTL → score = SETL - HOTL
    case 'salient': joinSetl = true; joinHotl = true; orderBy = '(story_setl - hotl) DESC NULLS LAST'; break;
    // outliers: high positive SETL + high positive HOTL → score = SETL + HOTL
    case 'outliers': joinSetl = true; joinHotl = true; orderBy = '(story_setl + hotl) DESC NULLS LAST'; break;
    // controversial: high negative SETL + high positive HOTL → score = HOTL - SETL
    case 'controversial': joinSetl = true; joinHotl = true; orderBy = '(hotl - story_setl) DESC NULLS LAST'; break;
  }

  // Stories query — excludes hcb_json blob but includes truncated hn_text preview
  const setlSelect = joinSetl ? `,
              (SELECT AVG(
                CAST((sc2.editorial - sc2.structural) AS REAL) /
                MAX(ABS(sc2.structural), ABS(sc2.editorial), ABS(sc2.editorial - sc2.structural))
               )
               FROM scores sc2
               WHERE sc2.hn_id = s.hn_id
                 AND sc2.editorial IS NOT NULL AND sc2.structural IS NOT NULL
                 AND (ABS(sc2.editorial) > 0 OR ABS(sc2.structural) > 0)
              ) as story_setl` : '';
  const hotlSelect = joinHotl ? `,
              CASE WHEN s.hn_score IS NOT NULL AND s.hn_comments IS NOT NULL AND (s.hn_score + s.hn_comments) > 0
                   THEN CAST((s.hn_comments - s.hn_score) AS REAL) / (s.hn_comments + s.hn_score)
                   ELSE NULL END as hotl` : '';

  const { results: storyRows } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_score, hn_comments, hn_by,
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
              eval_model, eval_prompt_hash,
              eval_status, eval_error, evaluated_at, created_at,
              SUBSTR(hn_text, 1, 100) as hn_text_preview${setlSelect}${hotlSelect}
       FROM stories s WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null }>();

  // Fetch mini scores (final only) for evaluated stories
  const evaluatedIds = storyRows
    .filter(s => s.eval_status === 'done')
    .map(s => s.hn_id);

  const scoresByHnId = new Map<number, MiniScore[]>();

  if (evaluatedIds.length > 0) {
    const { results: scoreRows } = await db
      .prepare(
        `SELECT hn_id, section, sort_order, final, editorial, structural
         FROM scores
         WHERE hn_id IN (${evaluatedIds.map(() => '?').join(',')})
         ORDER BY sort_order`
      )
      .bind(...evaluatedIds)
      .all<{ hn_id: number; section: string; sort_order: number; final: number | null; editorial: number | null; structural: number | null }>();

    for (const row of scoreRows) {
      let arr = scoresByHnId.get(row.hn_id);
      if (!arr) {
        arr = [];
        scoresByHnId.set(row.hn_id, arr);
      }
      arr.push({ section: row.section, final: row.final, editorial: row.editorial, structural: row.structural });
    }
  }

  return storyRows.map(story => ({
    ...story,
    hn_text: null,
    hcb_json: null,
    miniScores: scoresByHnId.get(story.hn_id) || [],
    hn_text_preview: story.hn_text_preview || null,
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
  articleNum: number,
  limit = 200
): Promise<ArticleRankingRow[]> {
  const section = articleNum === 0 ? 'Preamble' : `Article ${articleNum}`;
  const { results } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.domain, s.url, s.hn_score, s.hn_comments,
              s.hcb_weighted_mean, s.hcb_classification,
              s.hcb_signal_sections, s.hcb_nd_count,
              s.hcb_evidence_h, s.hcb_evidence_m, s.hcb_evidence_l,
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

export interface ArticleDetailedStat {
  section: string;
  sort_order: number;
  avg_final: number | null;
  avg_editorial: number | null;
  avg_structural: number | null;
  stddev_final: number;
  signal_count: number;
  nd_count: number;
  evidence_h: number;
  evidence_m: number;
  evidence_l: number;
}

export async function getArticleDetailedStats(db: D1Database): Promise<ArticleDetailedStat[]> {
  const { results } = await db
    .prepare(
      `SELECT section, sort_order,
              AVG(final) as avg_final,
              AVG(editorial) as avg_editorial,
              AVG(structural) as avg_structural,
              AVG(final * final) as avg_final_sq,
              SUM(CASE WHEN final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
              SUM(CASE WHEN final IS NULL THEN 1 ELSE 0 END) as nd_count,
              SUM(CASE WHEN evidence = 'H' THEN 1 ELSE 0 END) as evidence_h,
              SUM(CASE WHEN evidence = 'M' THEN 1 ELSE 0 END) as evidence_m,
              SUM(CASE WHEN evidence = 'L' THEN 1 ELSE 0 END) as evidence_l
       FROM scores GROUP BY section ORDER BY sort_order`
    )
    .all<ArticleDetailedStat & { avg_final_sq: number | null }>();
  return results.map(r => {
    const avgFinalSq = r.avg_final_sq ?? 0;
    const avgFinal = r.avg_final ?? 0;
    const stddev = Math.sqrt(Math.max(0, avgFinalSq - avgFinal * avgFinal));
    return { ...r, stddev_final: stddev };
  });
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

export interface SetlStory extends Story {
  story_setl: number | null;
}

export async function getTopSetlStories(db: D1Database, limit = 5): Promise<SetlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*,
              (SELECT AVG(
                CAST((sc.editorial - sc.structural) AS REAL) /
                MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
               )
               FROM scores sc
               WHERE sc.hn_id = s.hn_id
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as story_setl
       FROM stories s WHERE s.eval_status = 'done'
       ORDER BY story_setl DESC NULLS LAST LIMIT ?`
    )
    .bind(limit)
    .all<SetlStory>();
  return results;
}

export async function getBottomSetlStories(db: D1Database, limit = 5): Promise<SetlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*,
              (SELECT AVG(
                CAST((sc.editorial - sc.structural) AS REAL) /
                MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
               )
               FROM scores sc
               WHERE sc.hn_id = s.hn_id
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as story_setl
       FROM stories s WHERE s.eval_status = 'done'
       ORDER BY story_setl ASC NULLS LAST LIMIT ?`
    )
    .bind(limit)
    .all<SetlStory>();
  return results;
}

export interface HotlStory extends Story {
  story_hotl: number | null;
}

export async function getTopHotlStories(db: D1Database, limit = 5): Promise<HotlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT *,
              CASE WHEN hn_score IS NOT NULL AND hn_comments IS NOT NULL AND (hn_score + hn_comments) > 0
                   THEN CAST((hn_comments - hn_score) AS REAL) / (hn_comments + hn_score)
                   ELSE NULL END as story_hotl
       FROM stories WHERE eval_status = 'done'
       ORDER BY story_hotl DESC NULLS LAST LIMIT ?`
    )
    .bind(limit)
    .all<HotlStory>();
  return results;
}

export async function getBottomHotlStories(db: D1Database, limit = 5): Promise<HotlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT *,
              CASE WHEN hn_score IS NOT NULL AND hn_comments IS NOT NULL AND (hn_score + hn_comments) > 0
                   THEN CAST((hn_comments - hn_score) AS REAL) / (hn_comments + hn_score)
                   ELSE NULL END as story_hotl
       FROM stories WHERE eval_status = 'done'
       ORDER BY story_hotl ASC NULLS LAST LIMIT ?`
    )
    .bind(limit)
    .all<HotlStory>();
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
  avg_setl: number | null;
  avg_hotl: number | null;
}

export async function getDomainStats(db: D1Database, limit = 10): Promise<DomainStat[]> {
  const { results } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as count, AVG(s.hcb_weighted_mean) as avg_score,
              (SELECT AVG(
                CAST((sc.editorial - sc.structural) AS REAL) /
                MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
               )
               FROM scores sc
               JOIN stories s2 ON s2.hn_id = sc.hn_id
               WHERE s2.domain = s.domain
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as avg_setl,
              AVG(CASE WHEN s.hn_score IS NOT NULL AND s.hn_comments IS NOT NULL AND (s.hn_score + s.hn_comments) > 0
                       THEN CAST((s.hn_comments - s.hn_score) AS REAL) / (s.hn_comments + s.hn_score)
                       ELSE NULL END) as avg_hotl
       FROM stories s WHERE s.eval_status = 'done' AND s.domain IS NOT NULL
       GROUP BY s.domain ORDER BY count DESC LIMIT ?`
    )
    .bind(limit)
    .all<DomainStat>();
  return results;
}

export async function getQueueStories(db: D1Database, limit = 100): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM stories WHERE eval_status IN ('pending', 'evaluating')
       ORDER BY
         CASE eval_status WHEN 'evaluating' THEN 0 WHEN 'pending' THEN 1 END,
         hn_time DESC
       LIMIT ?`
    )
    .bind(limit)
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

// --- Domain pages ---

export async function getStoriesByDomain(
  db: D1Database,
  domain: string,
  limit = 50,
  offset = 0
): Promise<{ stories: StoryWithMiniScores[]; total: number; avgScore: number | null }> {
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt, AVG(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END) as avg_score FROM stories WHERE domain = ?`)
    .bind(domain)
    .first<{ cnt: number; avg_score: number | null }>();

  const { results: storyRows } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_score, hn_comments, hn_by,
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
              eval_model, eval_prompt_hash,
              eval_status, eval_error, evaluated_at, created_at,
              SUBSTR(hn_text, 1, 100) as hn_text_preview
       FROM stories WHERE domain = ? ORDER BY hn_time DESC LIMIT ? OFFSET ?`
    )
    .bind(domain, limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null }>();

  // Fetch mini scores for evaluated stories
  const evaluatedIds = storyRows
    .filter(s => s.eval_status === 'done')
    .map(s => s.hn_id);

  const scoresByHnId = new Map<number, MiniScore[]>();

  if (evaluatedIds.length > 0) {
    const { results: scoreRows } = await db
      .prepare(
        `SELECT hn_id, section, sort_order, final, editorial, structural
         FROM scores
         WHERE hn_id IN (${evaluatedIds.map(() => '?').join(',')})
         ORDER BY sort_order`
      )
      .bind(...evaluatedIds)
      .all<{ hn_id: number; section: string; sort_order: number; final: number | null; editorial: number | null; structural: number | null }>();

    for (const row of scoreRows) {
      let arr = scoresByHnId.get(row.hn_id);
      if (!arr) {
        arr = [];
        scoresByHnId.set(row.hn_id, arr);
      }
      arr.push({ section: row.section, final: row.final, editorial: row.editorial, structural: row.structural });
    }
  }

  return {
    stories: storyRows.map(story => ({
      ...story,
      hn_text: null,
      hcb_json: null,
      miniScores: scoresByHnId.get(story.hn_id) || [],
      hn_text_preview: story.hn_text_preview || null,
    })),
    total: countRow?.cnt ?? 0,
    avgScore: countRow?.avg_score ?? null,
  };
}

export async function getMeanSetl(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(
        CAST((sc.editorial - sc.structural) AS REAL) /
        MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
       ) as mean_setl
       FROM scores sc
       WHERE sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .first<{ mean_setl: number | null }>();
  return row?.mean_setl ?? null;
}

export async function getStorySetl(db: D1Database, hnId: number): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(
        CAST((sc.editorial - sc.structural) AS REAL) /
        MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
       ) as setl
       FROM scores sc
       WHERE sc.hn_id = ?
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .bind(hnId)
    .first<{ setl: number | null }>();
  return row?.setl ?? null;
}

export async function getDomainSetl(db: D1Database, domain: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(
        CAST((sc.editorial - sc.structural) AS REAL) /
        MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
       ) as setl
       FROM scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.domain = ?
         AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
         AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)`
    )
    .bind(domain)
    .first<{ setl: number | null }>();
  return row?.setl ?? null;
}

export type DomainSortOption = 'count' | 'score' | 'setl' | 'hotl';

export async function getMeanHotl(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(
        CASE WHEN hn_score IS NOT NULL AND hn_comments IS NOT NULL AND (hn_score + hn_comments) > 0
             THEN CAST((hn_comments - hn_score) AS REAL) / (hn_comments + hn_score)
             ELSE NULL END
       ) as mean_hotl
       FROM stories
       WHERE eval_status = 'done'`
    )
    .first<{ mean_hotl: number | null }>();
  return row?.mean_hotl ?? null;
}

export async function getDomainHotl(db: D1Database, domain: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(
        CASE WHEN hn_score IS NOT NULL AND hn_comments IS NOT NULL AND (hn_score + hn_comments) > 0
             THEN CAST((hn_comments - hn_score) AS REAL) / (hn_comments + hn_score)
             ELSE NULL END
       ) as hotl
       FROM stories
       WHERE domain = ?`
    )
    .bind(domain)
    .first<{ hotl: number | null }>();
  return row?.hotl ?? null;
}

export async function getAllDomainStats(
  db: D1Database,
  sort: DomainSortOption = 'count',
  limit = 50
): Promise<DomainStat[]> {
  let orderBy = 'count DESC';
  switch (sort) {
    case 'score': orderBy = 'avg_score DESC NULLS LAST'; break;
    case 'setl': orderBy = 'avg_setl DESC NULLS LAST'; break;
    case 'hotl': orderBy = 'avg_hotl DESC NULLS LAST'; break;
  }
  const { results } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as count,
              AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_score,
              (SELECT AVG(
                CAST((sc.editorial - sc.structural) AS REAL) /
                MAX(ABS(sc.structural), ABS(sc.editorial), ABS(sc.editorial - sc.structural))
               )
               FROM scores sc
               JOIN stories s2 ON s2.hn_id = sc.hn_id
               WHERE s2.domain = s.domain
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as avg_setl,
              AVG(CASE WHEN s.hn_score IS NOT NULL AND s.hn_comments IS NOT NULL AND (s.hn_score + s.hn_comments) > 0
                       THEN CAST((s.hn_comments - s.hn_score) AS REAL) / (s.hn_comments + s.hn_score)
                       ELSE NULL END) as avg_hotl
       FROM stories s
       WHERE s.domain IS NOT NULL
       GROUP BY s.domain
       ORDER BY ${orderBy}
       LIMIT ?`
    )
    .bind(limit)
    .all<DomainStat>();
  return results;
}

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

// --- Comments ---

export interface StoryComment {
  comment_id: number;
  author: string | null;
  text: string | null;
  time: number | null;
}

export async function getStoryComments(
  db: D1Database,
  hnId: number,
  limit = 20
): Promise<StoryComment[]> {
  const { results } = await db
    .prepare(
      `SELECT comment_id, author, text, time FROM story_comments
       WHERE hn_id = ?
       ORDER BY time ASC
       LIMIT ?`
    )
    .bind(hnId, limit)
    .all<StoryComment>();
  return results;
}

// --- Article sparklines ---

export interface SparklinePoint {
  section: string;
  final: number;
  evaluated_at: string;
}

export async function getArticleSparklines(db: D1Database, perArticle = 30): Promise<Map<string, number[]>> {
  const limit = perArticle * 31; // 31 articles max
  const { results } = await db
    .prepare(
      `SELECT sc.section, sc.final, s.evaluated_at
       FROM scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND sc.final IS NOT NULL AND s.evaluated_at IS NOT NULL
       ORDER BY s.evaluated_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<SparklinePoint>();

  const grouped = new Map<string, number[]>();
  for (const r of results) {
    let arr = grouped.get(r.section);
    if (!arr) {
      arr = [];
      grouped.set(r.section, arr);
    }
    if (arr.length < perArticle) {
      arr.push(r.final);
    }
  }
  // Reverse for chronological order (query was DESC)
  for (const [, arr] of grouped) {
    arr.reverse();
  }
  return grouped;
}

// --- Article pair stats (co-occurrence + correlation) ---

export interface ArticlePairData {
  cooccurrence: Map<string, number>;
  correlation: Map<string, number>;
  maxCooccurrence: number;
}

export async function getArticlePairStats(db: D1Database): Promise<ArticlePairData> {
  const { results } = await db
    .prepare(
      `SELECT a.section as section_a, b.section as section_b,
        COUNT(*) as n,
        SUM(a.final * b.final) as sum_ab,
        SUM(a.final) as sum_a, SUM(b.final) as sum_b,
        SUM(a.final * a.final) as sum_a2, SUM(b.final * b.final) as sum_b2
       FROM scores a JOIN scores b ON a.hn_id = b.hn_id
       WHERE a.final IS NOT NULL AND b.final IS NOT NULL AND a.sort_order <= b.sort_order
       GROUP BY a.section, b.section`
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

  return { cooccurrence, correlation, maxCooccurrence: maxCo };
}

// --- Domain DCP cache ---

export async function getDomainDcp(db: D1Database, domain: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT dcp_json FROM domain_dcp WHERE domain = ? LIMIT 1`)
      .bind(domain)
      .first<{ dcp_json: string }>();
    return row?.dcp_json ?? null;
  } catch {
    return null; // table may not exist
  }
}
