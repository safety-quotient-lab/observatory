import type { Score } from './types';
import { PRIMARY_MODEL_ID, getEnabledModels } from './shared-eval';
import { SETL_CASE_SQL } from './db-utils';

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
  hcb_editorial_mean: number | null;
  hcb_structural_mean: number | null;
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
  // Ensemble consensus
  consensus_score: number | null;
  consensus_model_count: number | null;
  consensus_spread: number | null;
  consensus_updated_at: string | null;
  // Content drift
  content_hash: string | null;
  content_last_fetched: string | null;
}

// Explicit column list for list-view queries — omits hcb_json and hn_text (large blobs not needed for cards)
const STORY_LIST_COLS = `hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type,
  content_type, hcb_weighted_mean, hcb_editorial_mean, hcb_structural_mean, hcb_classification,
  hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
  eval_model, eval_prompt_hash, eval_status, eval_error, evaluated_at, created_at, hn_rank,
  fw_ratio, fw_observable_count, fw_inference_count, schema_version,
  hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
  eq_score, eq_source_quality, eq_evidence_reasoning, eq_uncertainty_handling, eq_purpose_transparency, eq_claim_density,
  pt_flag_count, pt_flags_json, so_score, so_framing, so_reader_agency,
  et_primary_tone, et_valence, et_arousal, et_dominance,
  sr_score, sr_perspective_count, sr_voice_balance, sr_who_speaks, sr_who_spoken_about,
  tf_primary_focus, tf_time_horizon, gs_scope, gs_regions_json,
  cl_reading_level, cl_jargon_density, cl_assumed_knowledge,
  td_score, td_author_identified, td_conflicts_disclosed, td_funding_disclosed,
  consensus_score, consensus_model_count, consensus_spread, consensus_updated_at`;

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
  hcb_editorial_mean: number | null;
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
    directionality: (() => { try { return JSON.parse(row.directionality || '[]'); } catch { return []; } })(),
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
    case 'positive': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) > 0.05"); break;
    case 'negative': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) < -0.05"); break;
    case 'neutral': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) BETWEEN -0.05 AND 0.05"); break;
    case 'pending': conditions.push("s.eval_status IN ('pending', 'queued', 'evaluating')"); break;
    case 'failed': conditions.push("s.eval_status IN ('failed', 'skipped')"); break;
  }

  switch (type) {
    case 'ask': conditions.push("s.hn_type = 'ask'"); break;
    case 'show': conditions.push("s.hn_type = 'show'"); break;
    case 'job': conditions.push("s.hn_type = 'job'"); break;
  }

  const bindParams: (string | number)[] = [];
  const isAltModel = model !== 'all' && model !== 'any' && model !== PRIMARY_MODEL_ID;

  // "all" model filter: only show stories evaluated by every enabled full-mode model
  if (model === 'all') {
    const enabledFullModelCount = getEnabledModels().filter(m => m.prompt_mode === 'full').length;
    if (enabledFullModelCount > 1) {
      conditions.push(
        `(SELECT COUNT(DISTINCT re_all.eval_model) FROM rater_evals re_all
          WHERE re_all.hn_id = s.hn_id AND re_all.eval_status = 'done' AND re_all.prompt_mode = 'full') >= ?`
      );
      bindParams.push(enabledFullModelCount);
    }
  }

  // Day filter: show stories from a specific date
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const dayStart = Math.floor(new Date(day + 'T00:00:00Z').getTime() / 1000);
    const dayEnd = dayStart + 86400;
    if (!isNaN(dayStart)) {
      conditions.push(`s.hn_time >= ? AND s.hn_time < ?`);
      bindParams.push(dayStart, dayEnd);
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
    case 'score_desc': orderBy = `COALESCE(${scorePrefix}.hcb_weighted_mean, ${scorePrefix}.hcb_editorial_mean) DESC NULLS LAST`; break;
    case 'score_asc': orderBy = `COALESCE(${scorePrefix}.hcb_weighted_mean, ${scorePrefix}.hcb_editorial_mean) ASC NULLS LAST`; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
    case 'conf_desc': orderBy = `${scorePrefix}.hcb_confidence DESC NULLS LAST`; break;
    case 'conf_asc': orderBy = `${scorePrefix}.hcb_confidence ASC NULLS LAST`; break;
    case 'setl_desc': joinSetl = true; orderBy = 'story_setl DESC NULLS LAST'; break;
    case 'setl_asc': joinSetl = true; orderBy = 'story_setl ASC NULLS LAST'; break;
    case 'velocity': orderBy = 's.hn_score DESC NULLS LAST'; break; // proxy: highest points = most momentum
  }

  // SETL subquery uses rater_scores for alt models
  const setlScoreTable = isAltModel ? 'rater_scores' : 'scores';
  const setlExtraWhere = isAltModel ? ` AND sc2.eval_model = ?` : '';
  const setlBindParams: (string | number)[] = isAltModel && joinSetl ? [model] : [];
  const setlSelect = joinSetl ? `,
              (SELECT AVG(${SETL_CASE_SQL('sc2')})
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
              re.hcb_weighted_mean, re.hcb_editorial_mean, re.hcb_structural_mean, re.hcb_classification,
              re.hcb_signal_sections, re.hcb_nd_count, re.hcb_evidence_h, re.hcb_evidence_m, re.hcb_evidence_l,
              re.eval_model, s.eval_prompt_hash,
              re.eval_status, re.eval_error, re.evaluated_at, s.created_at, re.schema_version,
              re.hcb_theme_tag,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`
    : `s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_comments, s.hn_by,
              s.hn_time, s.hn_type, s.content_type, s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_structural_mean, s.hcb_classification,
              s.hcb_signal_sections, s.hcb_nd_count, s.hcb_evidence_h, s.hcb_evidence_m, s.hcb_evidence_l,
              s.eval_model, s.eval_prompt_hash,
              s.eval_status, s.eval_error, s.evaluated_at, s.created_at, s.schema_version,
              s.hcb_theme_tag, s.consensus_score, s.consensus_model_count, s.consensus_spread,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`;

  const storyQueryResult = await db
    .prepare(
      `SELECT ${selectCols}
       FROM stories s ${joinClause} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .bind(...setlBindParams, ...bindParams, limit, offset)
    .all<Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null }>()
    .catch((err) => { console.error('[getFilteredStoriesWithScores] DB error:', err); return { results: [] as (Omit<Story, 'hcb_json' | 'hn_text'> & { hn_text_preview: string | null })[] }; });
  const { results: storyRows } = storyQueryResult;

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
  try {
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
  } catch (err) {
    console.error('[getStory] DB error:', err);
    return null;
  }
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
              s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_classification,
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
  // Coverage spectrum
  coverageFull: number;       // done + hcb_weighted_mean IS NOT NULL
  coverageLight: number;      // hcb_editorial_mean IS NOT NULL AND hcb_weighted_mean IS NULL
  coverageMultiModel: number; // consensus_model_count >= 2
  coverageNone: number;       // no scores at all (pending/evaluating/failed with no editorial)
}

export async function getStatusCounts(db: D1Database): Promise<StatusCounts> {
  const { results } = await db
    .prepare(`SELECT eval_status, COUNT(*) as cnt FROM stories GROUP BY eval_status`)
    .all<{ eval_status: string; cnt: number }>();

  const counts: StatusCounts = {
    done: 0, pending: 0, evaluating: 0, failed: 0, skipped: 0, total: 0,
    coverageFull: 0, coverageLight: 0, coverageMultiModel: 0, coverageNone: 0,
  };
  for (const r of results) {
    const key = r.eval_status as keyof Omit<StatusCounts, 'total' | 'coverageFull' | 'coverageLight' | 'coverageMultiModel' | 'coverageNone'>;
    if (key in counts) (counts as any)[key] = r.cnt;
    counts.total += r.cnt;
  }

  // Coverage spectrum (single query, 3 conditional counts)
  const cov = await db.prepare(
    `SELECT
       COUNT(CASE WHEN hcb_weighted_mean IS NOT NULL THEN 1 END) as full_coverage,
       COUNT(CASE WHEN hcb_editorial_mean IS NOT NULL AND hcb_weighted_mean IS NULL THEN 1 END) as light_only,
       COUNT(CASE WHEN consensus_model_count >= 2 THEN 1 END) as multi_model
     FROM stories WHERE hn_id > 0`
  ).first<{ full_coverage: number; light_only: number; multi_model: number }>();

  if (cov) {
    counts.coverageFull = cov.full_coverage;
    counts.coverageLight = cov.light_only;
    counts.coverageMultiModel = cov.multi_model;
    counts.coverageNone = counts.total - cov.full_coverage - cov.light_only - counts.skipped;
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
      `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status = 'done'
       ORDER BY hcb_weighted_mean DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export async function getTopNegativeStories(db: D1Database, limit = 5): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status = 'done'
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
              (SELECT AVG(${SETL_CASE_SQL('sc')})
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
              (SELECT AVG(${SETL_CASE_SQL('sc')})
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
      `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status = 'done'
       ORDER BY evaluated_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

export interface DomainStat {
  domain: string;
  count: number;
  evaluated: number;
  avg_score: number;
  avg_setl: number | null;
  avg_conf: number | null;
}

export async function getDomainStats(db: D1Database, limit = 10): Promise<DomainStat[]> {
  const { results } = await db
    .prepare(
      `SELECT s.domain,
              COUNT(*) as count,
              SUM(CASE WHEN s.eval_status = 'done' THEN 1 ELSE 0 END) as evaluated,
              AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_weighted_mean END) as avg_score,
              AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_setl END) as avg_setl,
              AVG(CASE WHEN s.eval_status = 'done' THEN s.hcb_confidence END) as avg_conf
       FROM stories s WHERE s.domain IS NOT NULL
       GROUP BY s.domain ORDER BY count DESC LIMIT ?`
    )
    .bind(limit)
    .all<DomainStat>();
  return results;
}

export async function getQueueStories(db: D1Database, limit = 100): Promise<Story[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status IN ('pending', 'evaluating')
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
      `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status = 'failed'
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<Story>();
  return results;
}

// --- Domain pages ---

export async function getStoriesByEntity(
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
              hn_time, hn_type, content_type, hcb_weighted_mean, hcb_editorial_mean, hcb_structural_mean, hcb_classification,
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

// --- Entity detail stats (shared by domain + user pages) ---

export interface EntityDetailStats {
  avgConf: number | null;
  avgEditorial: number | null;
  avgStructural: number | null;
  evaluatedCount: number;
  topStory: { hn_id: number; title: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null } | null;
  bottomStory: { hn_id: number; title: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null } | null;
}

export type DomainDetailStats = EntityDetailStats;

export async function getEntityDetailStats(db: D1Database, type: 'domain' | 'user', value: string): Promise<EntityDetailStats> {
  const col = type === 'domain' ? 'domain' : 'hn_by';
  const stats = await db
    .prepare(
      `SELECT
        AVG(hcb_confidence) as avg_conf,
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
      `SELECT hn_id, title, hcb_weighted_mean, hcb_editorial_mean FROM stories
       WHERE ${col} = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean DESC LIMIT 1`
    )
    .bind(value)
    .first<{ hn_id: number; title: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null }>();

  const bottom = await db
    .prepare(
      `SELECT hn_id, title, hcb_weighted_mean, hcb_editorial_mean FROM stories
       WHERE ${col} = ? AND eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY hcb_weighted_mean ASC LIMIT 1`
    )
    .bind(value)
    .first<{ hn_id: number; title: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null }>();

  return {
    avgConf: stats?.avg_conf ?? null,
    avgEditorial: editStructRow?.avg_ed ?? null,
    avgStructural: editStructRow?.avg_st ?? null,
    evaluatedCount: stats?.evaluated_count ?? 0,
    topStory: top ?? null,
    bottomStory: bottom ?? null,
  };
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
  hcb_editorial_mean: number | null;
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
        s.hcb_weighted_mean, s.hcb_editorial_mean,
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

// --- Eval History (for audit trail on item page) ---

export interface EvalHistoryRow {
  eval_model: string;
  hcb_weighted_mean: number | null;
  hcb_classification: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  evaluated_at: string;
}

export async function getEvalHistoryForStory(
  db: D1Database,
  hnId: number,
): Promise<EvalHistoryRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT eval_model, hcb_weighted_mean, hcb_classification,
                input_tokens, output_tokens, evaluated_at
         FROM eval_history WHERE hn_id = ? ORDER BY evaluated_at DESC`
      )
      .bind(hnId)
      .all<EvalHistoryRow>();
    return results;
  } catch {
    return [];
  }
}
