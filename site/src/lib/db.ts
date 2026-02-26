import type { Score } from './types';
import { PRIMARY_MODEL_ID, getEnabledModels } from './shared-eval';

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
  fw_ratio: number | null;
  fw_observable_count: number | null;
  fw_inference_count: number | null;
  schema_version: string | null;
  hcb_theme_tag: string | null;
  hcb_sentiment_tag: string | null;
  hcb_executive_summary: string | null;
  // Supplementary signals
  eq_score: number | null;
  eq_source_quality: number | null;
  eq_evidence_reasoning: number | null;
  eq_uncertainty_handling: number | null;
  eq_purpose_transparency: number | null;
  eq_claim_density: string | null;
  pt_flag_count: number | null;
  pt_flags_json: string | null;
  so_score: number | null;
  so_framing: string | null;
  so_reader_agency: number | null;
  et_primary_tone: string | null;
  et_valence: number | null;
  et_arousal: number | null;
  et_dominance: number | null;
  sr_score: number | null;
  sr_perspective_count: number | null;
  sr_voice_balance: number | null;
  sr_who_speaks: string | null;
  sr_who_spoken_about: string | null;
  tf_primary_focus: string | null;
  tf_time_horizon: string | null;
  gs_scope: string | null;
  gs_regions_json: string | null;
  cl_reading_level: string | null;
  cl_jargon_density: string | null;
  cl_assumed_knowledge: string | null;
  td_score: number | null;
  td_author_identified: number | null;
  td_conflicts_disclosed: number | null;
  td_funding_disclosed: number | null;
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
  editorial_note: string;
  structural_note: string;
  combined: number | null;
  context_modifier: number | null;
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
    combined: row.combined ?? null,
    context_modifier: row.context_modifier ?? null,
    final: row.final,
    directionality: JSON.parse(row.directionality || '[]'),
    evidence: row.evidence,
    note: row.note,
    editorial_note: row.editorial_note || undefined,
    structural_note: row.structural_note || undefined,
  };
}

export type SortOption = 'top' | 'time' | 'score_desc' | 'score_asc' | 'hn_points' | 'conf_desc' | 'conf_asc' | 'setl_desc' | 'setl_asc' | 'velocity';
export type FilterOption = 'all' | 'evaluated' | 'positive' | 'negative' | 'neutral' | 'pending' | 'failed';
export type TypeOption = 'all' | 'ask' | 'show' | 'job';
export type ModelOption = string; // 'all' or a model ID like 'claude-haiku-4-5-20251001'

export async function getDistinctModels(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT eval_model FROM (
         SELECT eval_model FROM stories
         WHERE eval_status = 'done' AND eval_model IS NOT NULL
         UNION
         SELECT eval_model FROM rater_evals
         WHERE eval_status = 'done'
       ) ORDER BY eval_model`
    )
    .all<{ eval_model: string }>();
  return results.map(r => r.eval_model);
}

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
  day?: string,
  model: ModelOption = 'all'
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

  const bindParams: (string | number)[] = [];
  const isAltModel = model !== 'all' && model !== 'any' && model !== PRIMARY_MODEL_ID;

  // "all" model filter: only show stories evaluated by every enabled model
  if (model === 'all') {
    const enabledModelCount = getEnabledModels().length;
    if (enabledModelCount > 1) {
      conditions.push(
        `(SELECT COUNT(DISTINCT re_all.eval_model) FROM rater_evals re_all
          WHERE re_all.hn_id = s.hn_id AND re_all.eval_status = 'done') >= ${enabledModelCount}`
      );
    }
  }

  // Day filter: show stories from a specific date
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const dayStart = Math.floor(new Date(day + 'T00:00:00Z').getTime() / 1000);
    const dayEnd = dayStart + 86400;
    if (!isNaN(dayStart)) {
      conditions.push(`s.hn_time >= ${dayStart} AND s.hn_time < ${dayEnd}`);
    }
  }

  // For alt models, require a done rater_eval and override score columns
  if (isAltModel) {
    conditions.push(`re.eval_model = ?`);
    conditions.push(`re.eval_status = 'done'`);
    bindParams.push(model);
  }

  const where = conditions.join(' AND ');

  // Score column references differ for alt model (from rater_evals re) vs primary (from stories s)
  const scorePrefix = isAltModel ? 're' : 's';

  let orderBy = 's.hn_time DESC';
  let joinSetl = false;
  switch (sort) {
    case 'top': orderBy = 's.hn_rank ASC NULLS LAST, s.hn_time DESC'; break;
    case 'score_desc': orderBy = `${scorePrefix}.hcb_weighted_mean DESC NULLS LAST`; break;
    case 'score_asc': orderBy = `${scorePrefix}.hcb_weighted_mean ASC NULLS LAST`; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
    case 'conf_desc': orderBy = `CAST((COALESCE(${scorePrefix}.hcb_evidence_h,0)*1.0 + COALESCE(${scorePrefix}.hcb_evidence_m,0)*0.6 + COALESCE(${scorePrefix}.hcb_evidence_l,0)*0.2) AS REAL) / MAX(COALESCE(${scorePrefix}.hcb_evidence_h,0) + COALESCE(${scorePrefix}.hcb_evidence_m,0) + COALESCE(${scorePrefix}.hcb_evidence_l,0) + COALESCE(${scorePrefix}.hcb_nd_count,0), 1) DESC NULLS LAST`; break;
    case 'conf_asc': orderBy = `CAST((COALESCE(${scorePrefix}.hcb_evidence_h,0)*1.0 + COALESCE(${scorePrefix}.hcb_evidence_m,0)*0.6 + COALESCE(${scorePrefix}.hcb_evidence_l,0)*0.2) AS REAL) / MAX(COALESCE(${scorePrefix}.hcb_evidence_h,0) + COALESCE(${scorePrefix}.hcb_evidence_m,0) + COALESCE(${scorePrefix}.hcb_evidence_l,0) + COALESCE(${scorePrefix}.hcb_nd_count,0), 1) ASC NULLS LAST`; break;
    case 'setl_desc': joinSetl = true; orderBy = 'story_setl DESC NULLS LAST'; break;
    case 'setl_asc': joinSetl = true; orderBy = 'story_setl ASC NULLS LAST'; break;
    case 'velocity': orderBy = 's.hn_score DESC NULLS LAST'; break; // proxy: highest points = most momentum
  }

  // SETL subquery uses rater_scores for alt models
  const setlScoreTable = isAltModel ? 'rater_scores' : 'scores';
  const setlExtraWhere = isAltModel ? ` AND sc2.eval_model = '${model.replace(/'/g, "''")}'` : '';
  const setlSelect = joinSetl ? `,
              (SELECT AVG(
                CASE WHEN sc2.editorial >= sc2.structural
                  THEN  SQRT(ABS(sc2.editorial - sc2.structural) * MAX(ABS(sc2.editorial), ABS(sc2.structural)))
                  ELSE -SQRT(ABS(sc2.editorial - sc2.structural) * MAX(ABS(sc2.editorial), ABS(sc2.structural)))
                END
               )
               FROM ${setlScoreTable} sc2
               WHERE sc2.hn_id = s.hn_id
                 AND sc2.editorial IS NOT NULL AND sc2.structural IS NOT NULL
                 AND (ABS(sc2.editorial) > 0 OR ABS(sc2.structural) > 0)${setlExtraWhere}
              ) as story_setl` : '';

  // For alt models, JOIN rater_evals and overlay score columns
  const joinClause = isAltModel ? `INNER JOIN rater_evals re ON re.hn_id = s.hn_id` : '';
  const selectCols = isAltModel
    ? `s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_comments, s.hn_by,
              s.hn_time, s.hn_type, re.content_type,
              re.hcb_weighted_mean, re.hcb_classification,
              re.hcb_signal_sections, re.hcb_nd_count, re.hcb_evidence_h, re.hcb_evidence_m, re.hcb_evidence_l,
              re.eval_model, s.eval_prompt_hash,
              re.eval_status, re.eval_error, re.evaluated_at, s.created_at, re.schema_version,
              re.hcb_theme_tag,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`
    : `s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_comments, s.hn_by,
              s.hn_time, s.hn_type, s.content_type, s.hcb_weighted_mean, s.hcb_classification,
              s.hcb_signal_sections, s.hcb_nd_count, s.hcb_evidence_h, s.hcb_evidence_m, s.hcb_evidence_l,
              s.eval_model, s.eval_prompt_hash,
              s.eval_status, s.eval_error, s.evaluated_at, s.created_at, s.schema_version,
              s.hcb_theme_tag,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`;

  const { results: storyRows } = await db
    .prepare(
      `SELECT ${selectCols}
       FROM stories s ${joinClause} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .bind(...bindParams, limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null }>();

  // Fetch mini scores (final only) for evaluated stories
  const evaluatedIds = storyRows
    .filter(s => s.eval_status === 'done')
    .map(s => s.hn_id);

  const scoresByHnId = new Map<number, MiniScore[]>();

  if (evaluatedIds.length > 0) {
    // Use rater_scores for alt models, scores for primary/all
    const scoreTable = isAltModel ? 'rater_scores' : 'scores';
    const extraWhere = isAltModel ? ` AND eval_model = ?` : '';
    const extraBinds = isAltModel ? [model] : [];
    const { results: scoreRows } = await db
      .prepare(
        `SELECT hn_id, section, sort_order, final, editorial, structural
         FROM ${scoreTable}
         WHERE hn_id IN (${evaluatedIds.map(() => '?').join(',')})${extraWhere}
         ORDER BY sort_order`
      )
      .bind(...evaluatedIds, ...extraBinds)
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
       WHERE sc.section = ? AND sc.final IS NOT NULL AND TYPEOF(sc.final) != 'text'
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

async function getStoriesByEntity(
  db: D1Database,
  type: 'domain' | 'user',
  value: string,
  limit = 50,
  offset = 0
): Promise<{ stories: StoryWithMiniScores[]; total: number; avgScore: number | null }> {
  const col = type === 'domain' ? 'domain' : 'hn_by';
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt, AVG(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END) as avg_score FROM stories WHERE ${col} = ?`)
    .bind(value)
    .first<{ cnt: number; avg_score: number | null }>();

  const { results: storyRows } = await db
    .prepare(
      `SELECT hn_id, url, title, domain, hn_score, hn_comments, hn_by,
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
              eval_model, eval_prompt_hash,
              eval_status, eval_error, evaluated_at, created_at, schema_version,
              hcb_theme_tag,
              SUBSTR(hn_text, 1, 100) as hn_text_preview
       FROM stories WHERE ${col} = ? ORDER BY hn_time DESC LIMIT ? OFFSET ?`
    )
    .bind(value, limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null }>();

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

export function getStoriesByDomain(db: D1Database, domain: string, limit = 50, offset = 0) {
  return getStoriesByEntity(db, 'domain', domain, limit, offset);
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

export interface EntityDetailStats {
  avgConf: number | null;
  avgEditorial: number | null;
  avgStructural: number | null;
  evaluatedCount: number;
  topStory: { hn_id: number; title: string; hcb_weighted_mean: number | null } | null;
  bottomStory: { hn_id: number; title: string; hcb_weighted_mean: number | null } | null;
}

export type DomainDetailStats = EntityDetailStats;

async function getEntityDetailStats(db: D1Database, type: 'domain' | 'user', value: string): Promise<EntityDetailStats> {
  const col = type === 'domain' ? 'domain' : 'hn_by';
  const stats = await db
    .prepare(
      `SELECT
        AVG(CAST((COALESCE(hcb_evidence_h,0)*1.0 + COALESCE(hcb_evidence_m,0)*0.6 + COALESCE(hcb_evidence_l,0)*0.2) AS REAL)
            / MAX(COALESCE(hcb_evidence_h,0) + COALESCE(hcb_evidence_m,0) + COALESCE(hcb_evidence_l,0) + COALESCE(hcb_nd_count,0), 1)) as avg_conf,
        SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END) as evaluated_count
       FROM stories WHERE ${col} = ? AND eval_status = 'done'`
    )
    .bind(value)
    .first<{ avg_conf: number | null; evaluated_count: number }>();

  const editStructRow = await db
    .prepare(
      `SELECT AVG(sc.editorial) as avg_ed, AVG(sc.structural) as avg_st
       FROM scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.${col} = ? AND sc.final IS NOT NULL`
    )
    .bind(value)
    .first<{ avg_ed: number | null; avg_st: number | null }>();

  const top = await db
    .prepare(
      `SELECT hn_id, title, hcb_weighted_mean FROM stories
       WHERE ${col} = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean DESC LIMIT 1`
    )
    .bind(value)
    .first<{ hn_id: number; title: string; hcb_weighted_mean: number | null }>();

  const bottom = await db
    .prepare(
      `SELECT hn_id, title, hcb_weighted_mean FROM stories
       WHERE ${col} = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean ASC LIMIT 1`
    )
    .bind(value)
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

export function getDomainDetailStats(db: D1Database, domain: string) {
  return getEntityDetailStats(db, 'domain', domain);
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
        (SELECT ROUND(AVG(sc.editorial), 4) FROM scores sc
         JOIN stories s2 ON s2.hn_id = sc.hn_id
         WHERE s2.domain = s.domain AND sc.editorial IS NOT NULL) as avg_editorial,
        (SELECT ROUND(AVG(sc.structural), 4) FROM scores sc
         JOIN stories s2 ON s2.hn_id = sc.hn_id
         WHERE s2.domain = s.domain AND sc.structural IS NOT NULL) as avg_structural
      FROM stories s
      WHERE s.domain IS NOT NULL
      GROUP BY s.domain
      HAVING stories >= ?
      ORDER BY ${orderBy}
      LIMIT ?`
    )
    .bind(minStories, limit)
    .all<DomainIntelligence>();
  return results;
}

// --- Story Dynamics ---

export interface StoryDynamics {
  hn_id: number;
  title: string;
  domain: string | null;
  hn_by: string | null;
  hn_type: string | null;
  hn_time: number;
  hcb_weighted_mean: number | null;
  peak_score: number;
  peak_comments: number;
  first_score: number;
  score_gain: number;
  comment_gain: number;
  snap_count: number;
  first_snap: string;
  last_snap: string;
  hours_tracked: number;
  score_velocity: number;   // points per hour in first 2 hours
  comment_velocity: number; // comments per hour in first 2 hours
  comment_ratio: number | null; // comments / score
}

export async function getStoryDynamics(
  db: D1Database,
  limit = 100
): Promise<StoryDynamics[]> {
  const { results } = await db
    .prepare(
      `WITH snap_agg AS (
        SELECT
          ss.hn_id,
          COUNT(*) as snap_count,
          MIN(ss.snapshot_at) as first_snap,
          MAX(ss.snapshot_at) as last_snap,
          MIN(ss.hn_score) as first_score,
          MAX(ss.hn_score) as peak_score,
          MAX(ss.hn_comments) as peak_comments,
          MAX(ss.hn_score) - MIN(ss.hn_score) as score_gain,
          MAX(ss.hn_comments) - MIN(ss.hn_comments) as comment_gain,
          ROUND((julianday(MAX(ss.snapshot_at)) - julianday(MIN(ss.snapshot_at))) * 24, 2) as hours_tracked
        FROM story_snapshots ss
        GROUP BY ss.hn_id
        HAVING snap_count >= 5
      ),
      early_velocity AS (
        SELECT
          ss.hn_id,
          MAX(ss.hn_score) - MIN(ss.hn_score) as early_score_gain,
          MAX(ss.hn_comments) - MIN(ss.hn_comments) as early_comment_gain,
          ROUND((julianday(MAX(ss.snapshot_at)) - julianday(MIN(ss.snapshot_at))) * 24, 2) as early_hours
        FROM story_snapshots ss
        JOIN snap_agg sa ON sa.hn_id = ss.hn_id
        WHERE ss.snapshot_at <= datetime(sa.first_snap, '+2 hours')
        GROUP BY ss.hn_id
      )
      SELECT
        s.hn_id, s.title, s.domain, s.hn_by, s.hn_type, s.hn_time,
        s.hcb_weighted_mean,
        sa.peak_score, sa.peak_comments, sa.first_score,
        sa.score_gain, sa.comment_gain,
        sa.snap_count, sa.first_snap, sa.last_snap, sa.hours_tracked,
        CASE WHEN ev.early_hours > 0 THEN ROUND(ev.early_score_gain / ev.early_hours, 1) ELSE 0 END as score_velocity,
        CASE WHEN ev.early_hours > 0 THEN ROUND(ev.early_comment_gain / ev.early_hours, 1) ELSE 0 END as comment_velocity,
        CASE WHEN sa.peak_score > 0 THEN ROUND(1.0 * sa.peak_comments / sa.peak_score, 2) ELSE NULL END as comment_ratio
      FROM snap_agg sa
      JOIN stories s ON s.hn_id = sa.hn_id
      LEFT JOIN early_velocity ev ON ev.hn_id = sa.hn_id
      ORDER BY sa.peak_score DESC
      LIMIT ?`
    )
    .bind(limit)
    .all<StoryDynamics>();
  return results;
}

export interface StoryTimeline {
  hn_score: number;
  hn_comments: number;
  hn_rank: number | null;
  snapshot_at: string;
  minutes_elapsed: number;
}

export async function getStoryTimeline(
  db: D1Database,
  hnId: number
): Promise<StoryTimeline[]> {
  const { results } = await db
    .prepare(
      `SELECT
        hn_score, hn_comments, hn_rank, snapshot_at,
        ROUND((julianday(snapshot_at) - julianday(
          (SELECT MIN(snapshot_at) FROM story_snapshots WHERE hn_id = ?)
        )) * 24 * 60, 0) as minutes_elapsed
      FROM story_snapshots
      WHERE hn_id = ?
      ORDER BY snapshot_at`
    )
    .bind(hnId, hnId)
    .all<StoryTimeline>();
  return results;
}

export interface TypeEngagement {
  hn_type: string;
  stories: number;
  avg_score: number;
  avg_comments: number;
  avg_comment_ratio: number | null;
  avg_hrcb: number | null;
}

export async function getEngagementByType(
  db: D1Database
): Promise<TypeEngagement[]> {
  const { results } = await db
    .prepare(
      `SELECT
        COALESCE(s.hn_type, 'story') as hn_type,
        COUNT(*) as stories,
        ROUND(AVG(s.hn_score), 1) as avg_score,
        ROUND(AVG(s.hn_comments), 1) as avg_comments,
        ROUND(1.0 * AVG(s.hn_comments) / NULLIF(AVG(s.hn_score), 0), 2) as avg_comment_ratio,
        ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END), 3) as avg_hrcb
      FROM stories s
      GROUP BY COALESCE(s.hn_type, 'story')
      ORDER BY stories DESC`
    )
    .all<TypeEngagement>();
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
  dominant_tone: string | null;
  dominant_scope: string | null;
  dominant_reading_level: string | null;
  dominant_sentiment: string | null;
}

export async function getDomainSignalProfiles(db: D1Database): Promise<Map<string, DomainSignalProfile>> {
  const { results } = await db
    .prepare(
      `SELECT
         s.domain,
         COUNT(*) as count,
         AVG(s.eq_score) as avg_eq,
         AVG(s.so_score) as avg_so,
         AVG(s.sr_score) as avg_sr,
         AVG(s.td_score) as avg_td,
         AVG(s.pt_flag_count) as avg_pt_count,
         AVG(s.et_valence) as avg_valence,
         AVG(s.et_arousal) as avg_arousal,
         AVG(s.et_dominance) as avg_dominance,
         AVG(s.fw_ratio) as avg_fw_ratio,
         AVG(s.hn_score) as avg_hn_score,
         AVG(s.hn_comments) as avg_hn_comments,
         AVG(u.karma) as avg_poster_karma,
         (SELECT AVG(
           CASE WHEN sc.editorial >= sc.structural
             THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
             ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
           END
          )
          FROM scores sc
          JOIN stories s3 ON s3.hn_id = sc.hn_id
          WHERE s3.domain = s.domain
            AND sc.editorial IS NOT NULL AND sc.structural IS NOT NULL
            AND (ABS(sc.editorial) > 0 OR ABS(sc.structural) > 0)
         ) as avg_setl,
         (SELECT s2.et_primary_tone FROM stories s2
          WHERE s2.domain = s.domain AND s2.eval_status = 'done' AND s2.et_primary_tone IS NOT NULL
          GROUP BY s2.et_primary_tone ORDER BY COUNT(*) DESC LIMIT 1) as dominant_tone,
         (SELECT s2.gs_scope FROM stories s2
          WHERE s2.domain = s.domain AND s2.eval_status = 'done' AND s2.gs_scope IS NOT NULL
          GROUP BY s2.gs_scope ORDER BY COUNT(*) DESC LIMIT 1) as dominant_scope,
         (SELECT s2.cl_reading_level FROM stories s2
          WHERE s2.domain = s.domain AND s2.eval_status = 'done' AND s2.cl_reading_level IS NOT NULL
          GROUP BY s2.cl_reading_level ORDER BY COUNT(*) DESC LIMIT 1) as dominant_reading_level,
         (SELECT s2.hcb_sentiment_tag FROM stories s2
          WHERE s2.domain = s.domain AND s2.eval_status = 'done' AND s2.hcb_sentiment_tag IS NOT NULL
          GROUP BY s2.hcb_sentiment_tag ORDER BY COUNT(*) DESC LIMIT 1) as dominant_sentiment
       FROM stories s
       LEFT JOIN hn_users u ON s.hn_by = u.username
       WHERE s.eval_status = 'done' AND s.domain IS NOT NULL
       GROUP BY s.domain
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC`
    )
    .all<DomainSignalProfile>();

  const map = new Map<string, DomainSignalProfile>();
  for (const r of results) {
    map.set(r.domain, r);
  }
  return map;
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
  } catch {
    return [];
  }
}

export interface VelocityCorrelation {
  hn_id: number;
  title: string;
  domain: string | null;
  velocity: number;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
}

export async function getVelocityVsHrcb(db: D1Database, limit = 100): Promise<VelocityCorrelation[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT s.hn_id, s.title, s.domain, s.hcb_weighted_mean, s.hcb_classification,
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
  } catch {
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
      `SELECT AVG(
        CASE WHEN sc.editorial >= sc.structural
          THEN  SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
          ELSE -SQRT(ABS(sc.editorial - sc.structural) * MAX(ABS(sc.editorial), ABS(sc.structural)))
        END
       ) as setl
       FROM scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.hn_by = ?
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
         FROM scores sc JOIN stories s ON s.hn_id = sc.hn_id
         WHERE s.hn_by = ? AND s.eval_status = 'done'
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
  } catch {
    return new Array(31).fill(null);
  }
}

// --- User SETL temporal tracking ---

export async function getUserSetlHistory(db: D1Database, username: string, limit = 60): Promise<DomainSetlPoint[]> {
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
         WHERE s.hn_by = ?
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
  } catch {
    return [];
  }
}

// --- Global SETL temporal tracking ---

export async function getGlobalSetlHistory(db: D1Database, limit = 90): Promise<DomainSetlPoint[]> {
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
         WHERE s.eval_status = 'done'
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
  top_pt_technique: string | null;
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
  } catch {
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
    ).first<{ age_sec: number }>(),
    db.prepare(
      `SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) as age_sec
       FROM events WHERE event_type = 'eval_success' ORDER BY created_at DESC LIMIT 1`
    ).first<{ age_sec: number }>(),
    db.prepare(
      `SELECT
        SUM(CASE WHEN eval_status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN eval_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN eval_status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM stories`
    ).first<{ queued: number; pending: number; failed: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM dlq_messages WHERE status = 'pending'`)
      .first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    db.prepare(
      `SELECT COUNT(*) as cnt FROM events WHERE event_type = 'eval_success' AND created_at > datetime('now', '-24 hours')`
    ).first<{ cnt: number }>(),
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
          AVG(pt_flag_count) as avg_pt_count
        FROM stories
        WHERE eval_status = 'done' AND eq_score IS NOT NULL`
      )
      .first<{ total_with_signals: number; avg_eq: number | null; avg_so: number | null; avg_sr: number | null; avg_td: number | null; avg_pt_count: number | null }>();

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

    // Most common propaganda technique
    let topPtTechnique: string | null = null;
    try {
      const ptRows = await db
        .prepare(
          `SELECT pt_flags_json FROM stories
           WHERE eval_status = 'done' AND pt_flags_json IS NOT NULL AND pt_flag_count > 0`
        )
        .all<{ pt_flags_json: string }>();
      const techCounts: Record<string, number> = {};
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
      top_pt_technique: topPtTechnique,
      tone_distribution: toneDistribution,
      scope_distribution: scopeDistribution,
      reading_level_distribution: readingLevelDistribution,
    };
  } catch {
    return {
      total_with_signals: 0,
      avg_eq: null, avg_so: null, avg_sr: null, avg_td: null,
      avg_pt_count: null, top_pt_technique: null,
      tone_distribution: {}, scope_distribution: {}, reading_level_distribution: {},
    };
  }
}

// --- Multi-model (rater) query functions ---

export interface RaterEval {
  hn_id: number;
  eval_model: string;
  eval_provider: string;
  eval_status: string;
  eval_error: string | null;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  hcb_json: string | null;
  hcb_signal_sections: number | null;
  hcb_nd_count: number | null;
  hcb_evidence_h: number | null;
  hcb_evidence_m: number | null;
  hcb_evidence_l: number | null;
  content_type: string | null;
  schema_version: string | null;
  hcb_theme_tag: string | null;
  hcb_sentiment_tag: string | null;
  hcb_executive_summary: string | null;
  fw_ratio: number | null;
  fw_observable_count: number | null;
  fw_inference_count: number | null;
  hcb_editorial_mean: number | null;
  hcb_structural_mean: number | null;
  hcb_setl: number | null;
  hcb_confidence: number | null;
  eq_score: number | null;
  so_score: number | null;
  et_primary_tone: string | null;
  et_valence: number | null;
  sr_score: number | null;
  pt_flag_count: number | null;
  td_score: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  evaluated_at: string | null;
  created_at: string;
}

export interface RaterScore {
  hn_id: number;
  section: string;
  eval_model: string;
  sort_order: number;
  final: number | null;
  editorial: number | null;
  structural: number | null;
  evidence: string | null;
  directionality: string;
  note: string;
  editorial_note: string;
  structural_note: string;
  combined: number | null;
  context_modifier: number | null;
}

export interface RaterWitness {
  id: number;
  hn_id: number;
  eval_model: string;
  section: string;
  fact_type: string;
  fact_text: string;
}

/** Get all done rater_evals for a story */
export async function getRaterEvalsForStory(db: D1Database, hnId: number): Promise<RaterEval[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rater_evals WHERE hn_id = ? AND eval_status = 'done' ORDER BY eval_model`
    )
    .bind(hnId)
    .all<RaterEval>();
  return results;
}

/** Get rater_scores for a specific model */
export async function getRaterScores(db: D1Database, hnId: number, evalModel: string): Promise<RaterScore[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rater_scores WHERE hn_id = ? AND eval_model = ? ORDER BY sort_order`
    )
    .bind(hnId, evalModel)
    .all<RaterScore>();
  return results;
}

/** Get rater_witness for a specific model */
export async function getRaterWitness(db: D1Database, hnId: number, evalModel: string): Promise<RaterWitness[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rater_witness WHERE hn_id = ? AND eval_model = ? ORDER BY section, fact_type`
    )
    .bind(hnId, evalModel)
    .all<RaterWitness>();
  return results;
}

/** Get model IDs that have done evals for given hn_ids (for badge display) */
export async function getRaterEvalCounts(db: D1Database, hnIds: number[]): Promise<Map<number, string[]>> {
  if (hnIds.length === 0) return new Map();

  const placeholders = hnIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT hn_id, eval_model FROM rater_evals
       WHERE hn_id IN (${placeholders}) AND eval_status = 'done'
       ORDER BY hn_id, eval_model`
    )
    .bind(...hnIds)
    .all<{ hn_id: number; eval_model: string }>();

  const map = new Map<number, string[]>();
  for (const row of results) {
    const existing = map.get(row.hn_id) || [];
    existing.push(row.eval_model);
    map.set(row.hn_id, existing);
  }
  return map;
}

/** Per-model summary stats for dashboard */
export async function getRaterSummaryStats(db: D1Database): Promise<{
  model: string;
  eval_count: number;
  avg_score: number | null;
  avg_confidence: number | null;
}[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT eval_model AS model,
                COUNT(*) AS eval_count,
                AVG(hcb_weighted_mean) AS avg_score,
                AVG(hcb_confidence) AS avg_confidence
         FROM rater_evals
         WHERE eval_status = 'done'
         GROUP BY eval_model
         ORDER BY eval_count DESC`
      )
      .all<{ model: string; eval_count: number; avg_score: number | null; avg_confidence: number | null }>();
    return results;
  } catch {
    return [];
  }
}

/** Per-model queue/status breakdown for dashboard */
export async function getRaterStatusBreakdown(db: D1Database): Promise<{
  model: string;
  done: number;
  queued: number;
  failed: number;
  pending: number;
  evaluating: number;
  total_primary: number;
}[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT
           re.eval_model AS model,
           SUM(CASE WHEN re.eval_status = 'done' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN re.eval_status = 'queued' THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN re.eval_status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN re.eval_status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN re.eval_status = 'evaluating' THEN 1 ELSE 0 END) AS evaluating,
           (SELECT COUNT(*) FROM stories WHERE eval_status = 'done') AS total_primary
         FROM rater_evals re
         GROUP BY re.eval_model
         ORDER BY re.eval_model`
      )
      .all<{ model: string; done: number; queued: number; failed: number; pending: number; evaluating: number; total_primary: number }>();
    return results;
  } catch {
    return [];
  }
}

/** Stories evaluated by 2+ models, with each model's score */
export interface MultiModelStory {
  hn_id: number;
  title: string;
  url: string | null;
  domain: string | null;
  hn_score: number | null;
  models: { model: string; score: number; classification: string | null; confidence: number | null; setl: number | null; theme: string | null }[];
}

export async function getMultiModelStories(db: D1Database, limit = 500): Promise<MultiModelStory[]> {
  const { results: rows } = await db
    .prepare(
      `SELECT re.hn_id, re.eval_model, re.hcb_weighted_mean, re.hcb_classification,
              re.hcb_confidence, re.hcb_setl, re.hcb_theme_tag,
              s.title, s.url, s.domain, s.hn_score
       FROM rater_evals re
       JOIN stories s ON s.hn_id = re.hn_id
       WHERE re.eval_status = 'done'
         AND re.hn_id IN (
           SELECT hn_id FROM rater_evals
           WHERE eval_status = 'done'
           GROUP BY hn_id HAVING COUNT(DISTINCT eval_model) >= 2
         )
       ORDER BY s.hn_time DESC, re.eval_model
       LIMIT ?`
    )
    .bind(limit * 3)
    .all<{
      hn_id: number; eval_model: string; hcb_weighted_mean: number;
      hcb_classification: string | null; hcb_confidence: number | null;
      hcb_setl: number | null; hcb_theme_tag: string | null;
      title: string; url: string | null; domain: string | null; hn_score: number | null;
    }>();

  const storyMap = new Map<number, MultiModelStory>();
  for (const row of rows) {
    let story = storyMap.get(row.hn_id);
    if (!story) {
      story = { hn_id: row.hn_id, title: row.title, url: row.url, domain: row.domain, hn_score: row.hn_score, models: [] };
      storyMap.set(row.hn_id, story);
    }
    story.models.push({
      model: row.eval_model,
      score: row.hcb_weighted_mean,
      classification: row.hcb_classification,
      confidence: row.hcb_confidence,
      setl: row.hcb_setl,
      theme: row.hcb_theme_tag,
    });
  }

  return [...storyMap.values()].filter(s => s.models.length >= 2).slice(0, limit);
}

/** Aggregate model comparison stats across all shared stories */
export async function getModelComparisonAggregates(db: D1Database): Promise<{
  model: string;
  story_count: number;
  avg_score: number;
  avg_abs_score: number;
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
}[]> {
  const { results } = await db
    .prepare(
      `SELECT
         re.eval_model AS model,
         COUNT(*) AS story_count,
         AVG(re.hcb_weighted_mean) AS avg_score,
         AVG(ABS(re.hcb_weighted_mean)) AS avg_abs_score,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS positive_pct,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS negative_pct,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS neutral_pct
       FROM rater_evals re
       WHERE re.eval_status = 'done'
         AND re.hn_id IN (
           SELECT hn_id FROM rater_evals
           WHERE eval_status = 'done'
           GROUP BY hn_id HAVING COUNT(DISTINCT eval_model) >= 2
         )
       GROUP BY re.eval_model
       ORDER BY re.eval_model`
    )
    .all<{ model: string; story_count: number; avg_score: number; avg_abs_score: number; positive_pct: number; negative_pct: number; neutral_pct: number }>();
  return results;
}

/** Per-section average scores across all shared stories, per model */
export async function getModelSectionAverages(db: D1Database): Promise<{
  model: string;
  section: string;
  avg_final: number;
  count: number;
}[]> {
  const { results } = await db
    .prepare(
      `SELECT
         rs.eval_model AS model,
         rs.section,
         AVG(rs.final) AS avg_final,
         COUNT(*) AS count
       FROM rater_scores rs
       WHERE rs.hn_id IN (
         SELECT hn_id FROM rater_evals
         WHERE eval_status = 'done'
         GROUP BY hn_id HAVING COUNT(DISTINCT eval_model) >= 2
       )
       AND rs.final IS NOT NULL
       GROUP BY rs.eval_model, rs.section
       ORDER BY rs.section, rs.eval_model`
    )
    .all<{ model: string; section: string; avg_final: number; count: number }>();
  return results;
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
          ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN
            (SELECT AVG(sc.editorial) FROM scores sc WHERE sc.hn_id = s.hn_id AND sc.editorial IS NOT NULL)
          END), 4) AS avg_editorial,
          ROUND(AVG(CASE WHEN s.eval_status = 'done' THEN
            (SELECT AVG(sc.structural) FROM scores sc WHERE sc.hn_id = s.hn_id AND sc.structural IS NOT NULL)
          END), 4) AS avg_structural
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
  return results;
}

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
