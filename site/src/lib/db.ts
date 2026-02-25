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

export type SortOption = 'top' | 'time' | 'score_desc' | 'score_asc' | 'hn_points' | 'conf_desc' | 'conf_asc' | 'setl_desc' | 'setl_asc';
export type FilterOption = 'all' | 'evaluated' | 'positive' | 'negative' | 'neutral' | 'pending' | 'failed';
export type TypeOption = 'all' | 'ask' | 'show' | 'job';

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
  offset = 0,
  day?: string
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
    case 'job': conditions.push("s.hn_type = 'job'"); break;
  }

  // Day filter: show stories from a specific date
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const dayStart = Math.floor(new Date(day + 'T00:00:00Z').getTime() / 1000);
    const dayEnd = dayStart + 86400;
    if (!isNaN(dayStart)) {
      conditions.push(`s.hn_time >= ${dayStart} AND s.hn_time < ${dayEnd}`);
    }
  }

  const where = conditions.join(' AND ');

  let orderBy = 's.hn_time DESC';
  let joinSetl = false;
  switch (sort) {
    case 'top': orderBy = 's.hn_rank ASC NULLS LAST, s.hn_time DESC'; break;
    case 'score_desc': orderBy = 's.hcb_weighted_mean DESC NULLS LAST'; break;
    case 'score_asc': orderBy = 's.hcb_weighted_mean ASC NULLS LAST'; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
    case 'conf_desc': orderBy = 'CAST((COALESCE(s.hcb_evidence_h,0)*1.0 + COALESCE(s.hcb_evidence_m,0)*0.6 + COALESCE(s.hcb_evidence_l,0)*0.2) AS REAL) / MAX(COALESCE(s.hcb_evidence_h,0) + COALESCE(s.hcb_evidence_m,0) + COALESCE(s.hcb_evidence_l,0) + COALESCE(s.hcb_nd_count,0), 1) DESC NULLS LAST'; break;
    case 'conf_asc': orderBy = 'CAST((COALESCE(s.hcb_evidence_h,0)*1.0 + COALESCE(s.hcb_evidence_m,0)*0.6 + COALESCE(s.hcb_evidence_l,0)*0.2) AS REAL) / MAX(COALESCE(s.hcb_evidence_h,0) + COALESCE(s.hcb_evidence_m,0) + COALESCE(s.hcb_evidence_l,0) + COALESCE(s.hcb_nd_count,0), 1) ASC NULLS LAST'; break;
    case 'setl_desc': joinSetl = true; orderBy = 'story_setl DESC NULLS LAST'; break;
    case 'setl_asc': joinSetl = true; orderBy = 'story_setl ASC NULLS LAST'; break;
  }

  // Stories query — excludes hcb_json blob but includes truncated hn_text preview
  const setlSelect = joinSetl ? `,
              (SELECT AVG(
                CASE WHEN sc2.editorial >= sc2.structural
                  THEN  SQRT(ABS(sc2.editorial - sc2.structural) * MAX(ABS(sc2.editorial), ABS(sc2.structural)))
                  ELSE -SQRT(ABS(sc2.editorial - sc2.structural) * MAX(ABS(sc2.editorial), ABS(sc2.structural)))
                END
               )
               FROM scores sc2
               WHERE sc2.hn_id = s.hn_id
                 AND sc2.editorial IS NOT NULL AND sc2.structural IS NOT NULL
                 AND (ABS(sc2.editorial) > 0 OR ABS(sc2.structural) > 0)
              ) as story_setl` : '';
  const { results: storyRows } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_score, hn_comments, hn_by,
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
              eval_model, eval_prompt_hash,
              eval_status, eval_error, evaluated_at, created_at,
              SUBSTR(hn_text, 1, 100) as hn_text_preview${setlSelect}
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
  limit = 30,
  offset = 0
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
       LIMIT ? OFFSET ?`
    )
    .bind(section, limit, offset)
    .all<ArticleRankingRow>();
  return results;
}

export interface ArticleCoverageRow {
  section: string;
  sort_order: number;
  signal_count: number;
  avg_final: number | null;
}

export async function getArticleCoverage(db: D1Database): Promise<ArticleCoverageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT section, sort_order,
              SUM(CASE WHEN final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
              AVG(final) as avg_final
       FROM scores
       GROUP BY section
       ORDER BY sort_order`
    )
    .all<ArticleCoverageRow>();
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
                CASE WHEN sc.editorial >= sc.structural
                  THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                  ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                END
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
                CASE WHEN sc.editorial >= sc.structural
                  THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                  ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                END
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
  avg_conf: number | null;
}

export async function getDomainStats(db: D1Database, limit = 10): Promise<DomainStat[]> {
  const { results } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as count, AVG(s.hcb_weighted_mean) as avg_score,
              (SELECT AVG(
                CASE WHEN sc.editorial >= sc.structural
                  THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                  ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                END
               )
               FROM scores sc
               JOIN stories s2 ON s2.hn_id = sc.hn_id
               WHERE s2.domain = s.domain
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as avg_setl,
              AVG(
                CAST((COALESCE(s.hcb_evidence_h,0)*1.0 + COALESCE(s.hcb_evidence_m,0)*0.6 + COALESCE(s.hcb_evidence_l,0)*0.2) AS REAL)
                / MAX(COALESCE(s.hcb_evidence_h,0) + COALESCE(s.hcb_evidence_m,0) + COALESCE(s.hcb_evidence_l,0) + COALESCE(s.hcb_nd_count,0), 1)
              ) as avg_conf
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
        CASE WHEN sc.editorial >= sc.structural
          THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
          ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
        END
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
        CASE WHEN sc.editorial >= sc.structural
          THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
          ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
        END
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
        CASE WHEN sc.editorial >= sc.structural
          THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
          ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
        END
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

export interface DomainDetailStats {
  avgConf: number | null;
  avgEditorial: number | null;
  avgStructural: number | null;
  evaluatedCount: number;
  topStory: { hn_id: number; title: string; hcb_weighted_mean: number | null } | null;
  bottomStory: { hn_id: number; title: string; hcb_weighted_mean: number | null } | null;
}

export async function getDomainDetailStats(db: D1Database, domain: string): Promise<DomainDetailStats> {
  const stats = await db
    .prepare(
      `SELECT
        AVG(CAST((COALESCE(hcb_evidence_h,0)*1.0 + COALESCE(hcb_evidence_m,0)*0.6 + COALESCE(hcb_evidence_l,0)*0.2) AS REAL)
            / MAX(COALESCE(hcb_evidence_h,0) + COALESCE(hcb_evidence_m,0) + COALESCE(hcb_evidence_l,0) + COALESCE(hcb_nd_count,0), 1)) as avg_conf,
        SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END) as evaluated_count
       FROM stories WHERE domain = ? AND eval_status = 'done'`
    )
    .bind(domain)
    .first<{ avg_conf: number | null; evaluated_count: number }>();

  const editStructRow = await db
    .prepare(
      `SELECT AVG(sc.editorial) as avg_ed, AVG(sc.structural) as avg_st
       FROM scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.domain = ? AND sc.final IS NOT NULL`
    )
    .bind(domain)
    .first<{ avg_ed: number | null; avg_st: number | null }>();

  const top = await db
    .prepare(
      `SELECT hn_id, title, hcb_weighted_mean FROM stories
       WHERE domain = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean DESC LIMIT 1`
    )
    .bind(domain)
    .first<{ hn_id: number; title: string; hcb_weighted_mean: number | null }>();

  const bottom = await db
    .prepare(
      `SELECT hn_id, title, hcb_weighted_mean FROM stories
       WHERE domain = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean ASC LIMIT 1`
    )
    .bind(domain)
    .first<{ hn_id: number; title: string; hcb_weighted_mean: number | null }>();

  return {
    avgConf: stats?.avg_conf ?? null,
    avgEditorial: editStructRow?.avg_ed ?? null,
    avgStructural: editStructRow?.avg_st ?? null,
    evaluatedCount: stats?.evaluated_count ?? 0,
    topStory: top ?? null,
    bottomStory: bottom ?? null,
  };
}

export type DomainSortOption = 'count' | 'score' | 'setl' | 'conf';

export async function getAllDomainStats(
  db: D1Database,
  sort: DomainSortOption = 'count',
  limit = 50
): Promise<DomainStat[]> {
  let orderBy = 'count DESC';
  switch (sort) {
    case 'score': orderBy = 'avg_score DESC NULLS LAST'; break;
    case 'setl': orderBy = 'avg_setl DESC NULLS LAST'; break;
    case 'conf': orderBy = 'avg_conf DESC NULLS LAST'; break;
  }
  const { results } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as count,
              AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_score,
              (SELECT AVG(
                CASE WHEN sc.editorial >= sc.structural
                  THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                  ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                END
               )
               FROM scores sc
               JOIN stories s2 ON s2.hn_id = sc.hn_id
               WHERE s2.domain = s.domain
                 AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
                 AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
              ) as avg_setl,
              AVG(
                CASE WHEN s.eval_status = 'done' THEN
                  CAST((COALESCE(s.hcb_evidence_h,0)*1.0 + COALESCE(s.hcb_evidence_m,0)*0.6 + COALESCE(s.hcb_evidence_l,0)*0.2) AS REAL)
                  / MAX(COALESCE(s.hcb_evidence_h,0) + COALESCE(s.hcb_evidence_m,0) + COALESCE(s.hcb_evidence_l,0) + COALESCE(s.hcb_nd_count,0), 1)
                END
              ) as avg_conf
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
  parent_id: number | null;
  author: string | null;
  text: string | null;
  time: number | null;
  depth: number;
  hn_score: number | null;
}

export async function getStoryComments(
  db: D1Database,
  hnId: number,
  limit = 50
): Promise<StoryComment[]> {
  const { results } = await db
    .prepare(
      `SELECT comment_id, parent_id, author, text, time, depth, hn_score FROM story_comments
       WHERE hn_id = ?
       ORDER BY depth ASC, time ASC
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
      `SELECT AVG(
        CAST((COALESCE(hcb_evidence_h,0)*1.0 + COALESCE(hcb_evidence_m,0)*0.6 + COALESCE(hcb_evidence_l,0)*0.2) AS REAL)
        / MAX(COALESCE(hcb_evidence_h,0) + COALESCE(hcb_evidence_m,0) + COALESCE(hcb_evidence_l,0) + COALESCE(hcb_nd_count,0), 1)
       ) as mean_conf
       FROM stories
       WHERE eval_status = 'done'
         AND (hcb_evidence_h IS NOT NULL OR hcb_evidence_m IS NOT NULL OR hcb_evidence_l IS NOT NULL)`
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
  daysActive: number;
  daysToClearing: number | null;
}

export async function getVelocityStats(db: D1Database, pendingCount: number): Promise<VelocityStats> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as n,
              MIN(evaluated_at) as first_eval,
              MAX(evaluated_at) as last_eval
       FROM stories WHERE eval_status = 'done' AND evaluated_at IS NOT NULL`
    )
    .first<{ n: number; first_eval: string | null; last_eval: string | null }>();

  if (!row || !row.first_eval || !row.last_eval || row.n < 2) {
    return { evalsPerDay: 0, daysActive: 0, daysToClearing: null };
  }

  const firstMs = new Date(row.first_eval).getTime();
  const lastMs = new Date(row.last_eval).getTime();
  const daysActive = Math.max(1, (lastMs - firstMs) / (1000 * 60 * 60 * 24));
  const evalsPerDay = row.n / daysActive;
  const daysToClearing = pendingCount > 0 && evalsPerDay > 0
    ? pendingCount / evalsPerDay
    : null;

  return { evalsPerDay, daysActive: Math.round(daysActive), daysToClearing };
}

// --- Top/Bottom Confidence stories ---

export async function getTopConfidenceStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT *,
              CAST((COALESCE(hcb_evidence_h,0)*1.0 + COALESCE(hcb_evidence_m,0)*0.6 + COALESCE(hcb_evidence_l,0)*0.2) AS REAL)
              / MAX(COALESCE(hcb_evidence_h,0) + COALESCE(hcb_evidence_m,0) + COALESCE(hcb_evidence_l,0) + COALESCE(hcb_nd_count,0), 1) as conf
       FROM stories WHERE eval_status = 'done'
         AND (hcb_evidence_h IS NOT NULL OR hcb_evidence_m IS NOT NULL OR hcb_evidence_l IS NOT NULL)
       ORDER BY conf DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export async function getBottomConfidenceStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT *,
              CAST((COALESCE(hcb_evidence_h,0)*1.0 + COALESCE(hcb_evidence_m,0)*0.6 + COALESCE(hcb_evidence_l,0)*0.2) AS REAL)
              / MAX(COALESCE(hcb_evidence_h,0) + COALESCE(hcb_evidence_m,0) + COALESCE(hcb_evidence_l,0) + COALESCE(hcb_nd_count,0), 1) as conf
       FROM stories WHERE eval_status = 'done'
         AND (hcb_evidence_h IS NOT NULL OR hcb_evidence_m IS NOT NULL OR hcb_evidence_l IS NOT NULL)
       ORDER BY conf ASC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
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
       FROM scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND s.domain IN (${domains.map(() => '?').join(',')})
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
  const { results } = await db
    .prepare(
      `SELECT s.hn_id, s.title, s.domain, s.hcb_weighted_mean,
              AVG(sc.editorial) as avg_editorial,
              AVG(sc.structural) as avg_structural,
              CAST((COALESCE(s.hcb_evidence_h,0)*1.0 + COALESCE(s.hcb_evidence_m,0)*0.6 + COALESCE(s.hcb_evidence_l,0)*0.2) AS REAL)
              / MAX(COALESCE(s.hcb_evidence_h,0) + COALESCE(s.hcb_evidence_m,0) + COALESCE(s.hcb_evidence_l,0) + COALESCE(s.hcb_nd_count,0), 1) as conf
       FROM stories s JOIN scores sc ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
       GROUP BY s.hn_id
       ORDER BY s.evaluated_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<StoryScatterPoint>();
  return results;
}

// --- Seldon Dashboard: rolling averages + per-article daily + per-content-type daily ---

export interface DailyArticleHrcb {
  day: string;
  section: string;
  avg_final: number;
  count: number;
}

export async function getDailyArticleHrcb(db: D1Database, limit = 90): Promise<DailyArticleHrcb[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT DATE(s.evaluated_at) as day, sc.section, AVG(sc.final) as avg_final, COUNT(*) as count
         FROM scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.eval_status = 'done' AND s.evaluated_at IS NOT NULL AND sc.final IS NOT NULL
         GROUP BY DATE(s.evaluated_at), sc.section
         ORDER BY day DESC
         LIMIT ?`
      )
      .bind(limit * 31)
      .all<DailyArticleHrcb>();
    return results;
  } catch {
    return [];
  }
}

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
  } catch {
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
  } catch {
    return [];
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
                AVG(
                  CASE WHEN sc.editorial >= sc.structural
                    THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                    ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
                  END
                ) as avg_setl,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                COUNT(DISTINCT s.hn_id) as count
         FROM scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.domain = ?
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
  } catch {
    return [];
  }
}

// --- Feed source analytics ---

export interface FeedStat {
  feed: string;
  story_count: number;
  avg_hrcb: number | null;
  positive_pct: number;
  negative_pct: number;
}

export async function getFeedStats(db: D1Database): Promise<FeedStat[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT sf.feed,
                COUNT(DISTINCT sf.hn_id) as story_count,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_hrcb,
                CAST(SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) AS REAL)
                  / MAX(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 1) as positive_pct,
                CAST(SUM(CASE WHEN s.eval_status = 'done' AND s.hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) AS REAL)
                  / MAX(SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END), 1) as negative_pct
         FROM story_feeds sf
         JOIN stories s ON s.hn_id = sf.hn_id
         GROUP BY sf.feed
         ORDER BY story_count DESC`
      )
      .all<FeedStat>();
    return results;
  } catch {
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
      .prepare(`SELECT * FROM hn_users WHERE username = ?`)
      .bind(username)
      .first<HnUser>();
  } catch {
    return null;
  }
}

export interface PosterStats {
  username: string;
  karma: number | null;
  account_age_days: number | null;
  story_count: number;
  avg_hrcb: number | null;
  avg_hn_score: number | null;
}

export async function getTopPosters(db: D1Database, limit = 20): Promise<PosterStats[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT s.hn_by as username, u.karma, u.created,
                COUNT(*) as story_count,
                AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_hrcb,
                AVG(s.hn_score) as avg_hn_score
         FROM stories s
         LEFT JOIN hn_users u ON u.username = s.hn_by
         WHERE s.hn_by IS NOT NULL
         GROUP BY s.hn_by
         HAVING COUNT(*) >= 2
         ORDER BY story_count DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<{ username: string; karma: number | null; created: number | null; story_count: number; avg_hrcb: number | null; avg_hn_score: number | null }>();

    const now = Math.floor(Date.now() / 1000);
    return results.map(r => ({
      ...r,
      account_age_days: r.created ? Math.floor((now - r.created) / 86400) : null,
    }));
  } catch {
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
  } catch {
    return null; // table may not exist
  }
}
