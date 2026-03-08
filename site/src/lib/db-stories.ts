// SPDX-License-Identifier: Apache-2.0
import type { Score } from './types';
import { getEnabledModels } from './shared-eval';
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
  pt_score: number | null;
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
  tq_score: number | null;
  rts_tensions_json: string | null;
  // PSQ (Psychological Safety Quotient) — independent signal
  psq_score: number | null;
  psq_dimensions_json: string | null;
  psq_confidence: number | null;
  psq_consensus_score: number | null;
  psq_consensus_model_count: number | null;
  psq_consensus_spread: number | null;
  // Ensemble consensus
  consensus_score: number | null;
  consensus_model_count: number | null;
  consensus_spread: number | null;
  consensus_updated_at: string | null;
  // Content drift
  content_hash: string | null;
  content_last_fetched: string | null;
  eval_priority_score: number | null;
  // Detail-only columns (not in STORY_LIST_COLS)
  hcb_setl: number | null;
  hcb_confidence: number | null;
  methodology_hash: string | null;
  gate_category: string | null;
  gate_confidence: number | null;
  archive_url: string | null;
  archive_used: number | null;
}

// Explicit column list for list-view queries — omits hcb_json, hn_text, eval_system_prompt, eval_user_prompt (large blobs)
const STORY_LIST_COLS = `hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type,
  content_type, hcb_weighted_mean, hcb_editorial_mean, hcb_structural_mean, hcb_classification,
  hcb_signal_sections, hcb_nd_count, hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
  eval_model, eval_prompt_hash, eval_status, eval_error, evaluated_at, created_at, hn_rank,
  fw_ratio, fw_observable_count, fw_inference_count, schema_version,
  hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
  eq_score, eq_source_quality, eq_evidence_reasoning, eq_uncertainty_handling, eq_purpose_transparency, eq_claim_density,
  pt_flag_count, pt_score, pt_flags_json, so_score, so_framing, so_reader_agency,
  et_primary_tone, et_valence, et_arousal, et_dominance,
  sr_score, sr_perspective_count, sr_voice_balance, sr_who_speaks, sr_who_spoken_about,
  tf_primary_focus, tf_time_horizon, gs_scope, gs_regions_json,
  cl_reading_level, cl_jargon_density, cl_assumed_knowledge,
  td_score, td_author_identified, td_conflicts_disclosed, td_funding_disclosed,
  tq_score, rts_tensions_json,
  psq_score, psq_dimensions_json, psq_confidence,
  psq_consensus_score, psq_consensus_model_count, psq_consensus_spread,
  consensus_score, consensus_model_count, consensus_spread, consensus_updated_at,
  content_hash, content_last_fetched, eval_priority_score`;

// Detail-view columns — adds hn_text for self-post display, gate columns, archive. Still omits hcb_json (~12-15KB blob).
const STORY_DETAIL_COLS = `${STORY_LIST_COLS},
  hn_text, hcb_setl, hcb_confidence, methodology_hash,
  gate_category, gate_confidence, archive_url, archive_used`;

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

export type SortOption = 'top' | 'time' | 'time_asc' | 'score_desc' | 'score_asc' | 'hn_points' | 'hn_points_asc' | 'conf_desc' | 'conf_asc' | 'setl_desc' | 'setl_asc' | 'velocity' | 'psq_desc' | 'psq_asc' | 'editorial_desc' | 'editorial_asc' | 'structural_desc' | 'structural_asc';
export type FilterOption = 'all' | 'evaluated' | 'positive' | 'negative' | 'neutral' | 'pending' | 'failed' | 'psq_safe' | 'psq_mixed' | 'psq_threat';
export type TypeOption = 'all' | 'ask' | 'show' | 'job';
export type ContentTypeOption = 'all' | 'ED' | 'PO' | 'LP' | 'PR' | 'AC' | 'MI';
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
  model: ModelOption = 'all',
  ctype: ContentTypeOption = 'all',
  pt?: string,       // propaganda technique filter (re.pt_flags_json)
  jargon?: string,   // jargon density filter (re.jargon_density)
  temporal?: string  // temporal framing filter (re.tf_primary_focus)
): Promise<StoryWithMiniScores[]> {
  const conditions: string[] = ['1=1'];
  switch (filter) {
    case 'evaluated': conditions.push("s.eval_status = 'done'"); break;
    case 'positive': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) > 0.05"); break;
    case 'negative': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) < -0.05"); break;
    case 'neutral': conditions.push("s.eval_status = 'done' AND COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) BETWEEN -0.05 AND 0.05"); break;
    case 'psq_safe': conditions.push("s.psq_score IS NOT NULL AND s.psq_score > 6"); break;
    case 'psq_mixed': conditions.push("s.psq_score IS NOT NULL AND s.psq_score BETWEEN 4 AND 6"); break;
    case 'psq_threat': conditions.push("s.psq_score IS NOT NULL AND s.psq_score < 4"); break;
    case 'pending': conditions.push("s.eval_status IN ('pending', 'queued', 'evaluating')"); break;
    case 'failed': conditions.push("s.eval_status IN ('failed', 'skipped')"); break;
  }

  switch (type) {
    case 'ask': conditions.push("s.hn_type = 'ask'"); break;
    case 'show': conditions.push("s.hn_type = 'show'"); break;
    case 'job': conditions.push("s.hn_type = 'job'"); break;
  }

  if (ctype !== 'all') conditions.push(`s.content_type = '${ctype}'`);

  const bindParams: (string | number)[] = [];
  const isAltModel = model !== 'all' && model !== 'any';
  const hasSupplFilter = !!(pt || jargon || temporal);

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

  // Supplemental signal filters (require JOIN to rater_evals on primary model)
  if (pt) { conditions.push(`re.pt_flags_json LIKE ?`); bindParams.push(`%"${pt}"%`); }
  if (jargon) { conditions.push(`re.jargon_density = ?`); bindParams.push(jargon); }
  if (temporal) { conditions.push(`re.tf_primary_focus = ?`); bindParams.push(temporal); }

  const where = conditions.join(' AND ');

  // Score column references differ for alt model (from rater_evals re) vs primary (from stories s)
  const scorePrefix = isAltModel ? 're' : 's';

  // Zero-score stories (low signal) sort after meaningful scores in time/top views
  const zeroScoreDemote = `CASE WHEN s.eval_status = 'done' AND ABS(COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean, 0)) < 0.005 THEN 1 ELSE 0 END`;
  let orderBy = `${zeroScoreDemote}, s.hn_time DESC`;
  let joinSetl = false;
  switch (sort) {
    case 'top': orderBy = `${zeroScoreDemote}, s.hn_rank ASC NULLS LAST, s.hn_time DESC`; break;
    case 'time_asc': orderBy = `s.hn_time ASC NULLS LAST`; break;
    case 'score_desc': orderBy = `COALESCE(${scorePrefix}.hcb_weighted_mean, ${scorePrefix}.hcb_editorial_mean) DESC NULLS LAST`; break;
    case 'score_asc': orderBy = `COALESCE(${scorePrefix}.hcb_weighted_mean, ${scorePrefix}.hcb_editorial_mean) ASC NULLS LAST`; break;
    case 'hn_points': orderBy = 's.hn_score DESC NULLS LAST'; break;
    case 'hn_points_asc': orderBy = 's.hn_score ASC NULLS LAST'; break;
    case 'conf_desc': orderBy = `${scorePrefix}.hcb_confidence DESC NULLS LAST`; break;
    case 'conf_asc': orderBy = `${scorePrefix}.hcb_confidence ASC NULLS LAST`; break;
    case 'setl_desc': joinSetl = true; orderBy = 'story_setl DESC NULLS LAST'; break;
    case 'setl_asc': joinSetl = true; orderBy = 'story_setl ASC NULLS LAST'; break;
    case 'velocity': orderBy = 's.hn_score DESC NULLS LAST'; break; // proxy: highest points = most momentum
    case 'psq_desc': orderBy = `${scorePrefix === 're' ? 're' : 's'}.psq_score DESC NULLS LAST`; break;
    case 'psq_asc': orderBy = `${scorePrefix === 're' ? 're' : 's'}.psq_score ASC NULLS LAST`; break;
    case 'editorial_desc': orderBy = `COALESCE(${scorePrefix}.hcb_editorial_mean) DESC NULLS LAST`; break;
    case 'editorial_asc': orderBy = `COALESCE(${scorePrefix}.hcb_editorial_mean) ASC NULLS LAST`; break;
    case 'structural_desc': orderBy = `${scorePrefix}.hcb_structural_mean DESC NULLS LAST`; break;
    case 'structural_asc': orderBy = `${scorePrefix}.hcb_structural_mean ASC NULLS LAST`; break;
  }

  // SETL subquery always uses rater_scores
  const setlExtraWhere = isAltModel ? ` AND sc2.eval_model = ?` : ` AND sc2.eval_model = s.eval_model`;
  const setlBindParams: (string | number)[] = isAltModel && joinSetl ? [model] : [];
  const setlSelect = joinSetl ? `,
              (SELECT AVG(${SETL_CASE_SQL('sc2')})
               FROM rater_scores sc2
               WHERE sc2.hn_id = s.hn_id
                 AND sc2.editorial IS NOT NULL AND sc2.structural IS NOT NULL
                 AND (ABS(sc2.editorial) > 0 OR ABS(sc2.structural) > 0)${setlExtraWhere}
              ) as story_setl` : '';

  // For alt models, JOIN rater_evals and overlay score columns.
  // Also JOIN for supplemental signal filters (pt/jargon/temporal) on primary model path.
  const joinClause = isAltModel
    ? `INNER JOIN rater_evals re ON re.hn_id = s.hn_id`
    : hasSupplFilter
      ? `INNER JOIN rater_evals re ON re.hn_id = s.hn_id AND re.eval_model = s.eval_model AND re.eval_status = 'done' AND re.prompt_mode = 'full'`
      : '';
  const selectCols = isAltModel
    ? `s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_comments, s.hn_by,
              s.hn_time, s.hn_type, re.content_type,
              re.hcb_weighted_mean, re.hcb_editorial_mean, re.hcb_structural_mean, re.hcb_classification,
              re.hcb_signal_sections, re.hcb_nd_count, re.hcb_evidence_h, re.hcb_evidence_m, re.hcb_evidence_l,
              re.eval_model, s.eval_prompt_hash,
              re.eval_status, re.eval_error, re.evaluated_at, s.created_at, re.schema_version,
              re.hcb_theme_tag, s.psq_score,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`
    : `s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_comments, s.hn_by,
              s.hn_time, s.hn_type, s.content_type, s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_structural_mean, s.hcb_classification,
              s.hcb_signal_sections, s.hcb_nd_count, s.hcb_evidence_h, s.hcb_evidence_m, s.hcb_evidence_l,
              s.eval_model, s.eval_prompt_hash,
              s.eval_status, s.eval_error, s.evaluated_at, s.created_at, s.schema_version,
              s.hcb_theme_tag, s.consensus_score, s.consensus_model_count, s.consensus_spread,
              s.psq_score,
              SUBSTR(s.hn_text, 1, 100) as hn_text_preview${setlSelect}`;

  const storyQueryResult = await db
    .prepare(
      `SELECT ${selectCols}
       FROM stories s ${joinClause} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .bind(...setlBindParams, ...bindParams, limit, offset)
    .all<Omit<Story, 'hn_text'> & { hn_text_preview: string | null }>()
    .catch((err) => { console.error('[getFilteredStoriesWithScores] DB error:', err); return { results: [] as (Omit<Story, 'hn_text'> & { hn_text_preview: string | null })[] }; });
  const { results: storyRows } = storyQueryResult;

  // Fetch mini scores (final only) for evaluated stories
  const evaluatedIds = storyRows
    .filter(s => s.eval_status === 'done')
    .map(s => s.hn_id);

  const scoresByHnId = new Map<number, MiniScore[]>();

  if (evaluatedIds.length > 0) {
    // Always read from rater_scores — for alt models filter by requested model,
    // otherwise use each story's eval_model via JOIN
    const extraWhere = isAltModel ? ` AND rs.eval_model = ?` : ` AND rs.eval_model = s2.eval_model`;
    const extraBinds = isAltModel ? [model] : [];
    const { results: scoreRows } = await db
      .prepare(
        `SELECT rs.hn_id, rs.section, rs.sort_order, rs.final, rs.editorial, rs.structural
         FROM rater_scores rs
         JOIN stories s2 ON s2.hn_id = rs.hn_id
         WHERE rs.hn_id IN (${evaluatedIds.map(() => '?').join(',')})${extraWhere}
         ORDER BY rs.sort_order`
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
    miniScores: scoresByHnId.get(story.hn_id) || [],
    hn_text_preview: story.hn_text_preview || null,
  }));
}

// --- Detail page ---

export async function getStory(db: D1Database, hnId: number): Promise<StoryWithScores | null> {
  try {
    const story = await db
      .prepare(`SELECT ${STORY_DETAIL_COLS} FROM stories WHERE hn_id = ?`)
      .bind(hnId)
      .first<Story>();

    if (!story) return null;

    // Read per-section scores from rater_scores using the story's eval_model
    let scores: Score[] = [];
    if (story.eval_status === 'done') {
      let targetModel = story.eval_model;
      if (!targetModel) {
        const best = await db
          .prepare(`SELECT eval_model FROM rater_evals WHERE hn_id = ? AND eval_status = 'done' AND prompt_mode = 'full' ORDER BY evaluated_at DESC LIMIT 1`)
          .bind(hnId)
          .first<{ eval_model: string }>();
        targetModel = best?.eval_model ?? null;
      }
      if (targetModel) {
        const { results: scoreRows } = await db
          .prepare(`SELECT hn_id, section, eval_model, sort_order, final, editorial, structural, evidence, directionality, note, editorial_note, structural_note, combined, context_modifier FROM rater_scores WHERE hn_id = ? AND eval_model = ? ORDER BY sort_order`)
          .bind(hnId, targetModel)
          .all<ScoreRow>();
        scores = scoreRows.map(scoreRowToScore);
      }
    }

    return {
      ...story,
      scores,
    };
  } catch (err) {
    console.error('[getStory] DB error:', err);
    return null;
  }
}

export interface FairWitnessFact {
  section: string;
  fact_type: 'observable' | 'inference';
  fact_text: string;
}

export async function getFairWitnessForStory(db: D1Database, hnId: number, evalModel?: string | null): Promise<FairWitnessFact[]> {
  try {
    if (evalModel) {
      const { results } = await db
        .prepare(`SELECT section, fact_type, fact_text FROM rater_witness WHERE hn_id = ? AND eval_model = ? ORDER BY section, fact_type`)
        .bind(hnId, evalModel)
        .all<FairWitnessFact>();
      return results;
    }
    // No model specified — get from any full-mode rater
    const { results } = await db
      .prepare(
        `SELECT rw.section, rw.fact_type, rw.fact_text FROM rater_witness rw
         JOIN stories s ON s.hn_id = rw.hn_id
         WHERE rw.hn_id = ? AND rw.eval_model = s.eval_model
         ORDER BY rw.section, rw.fact_type`
      )
      .bind(hnId)
      .all<FairWitnessFact>();
    return results;
  } catch (err) {
    console.error('[getFairWitnessForStory] DB error:', err);
    return [];
  }
}

// --- Article ranking ---

export async function getArticleRanking(
  db: D1Database,
  articleNum: number,
  limit = 30,
  offset = 0,
  sortDir: 'asc' | 'desc' = 'desc'
): Promise<ArticleRankingRow[]> {
  try {
    const section = articleNum === 0 ? 'Preamble' : `Article ${articleNum}`;
    const order = sortDir === 'asc' ? 'ASC' : 'DESC';
    const { results } = await db
      .prepare(
        `SELECT s.hn_id, s.title, s.domain, s.url, s.hn_score, s.hn_comments,
                s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_classification,
                s.hcb_signal_sections, s.hcb_nd_count,
                s.hcb_evidence_h, s.hcb_evidence_m, s.hcb_evidence_l,
                sc.section, sc.final, sc.editorial, sc.structural,
                sc.evidence, sc.note
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE sc.section = ? AND sc.final IS NOT NULL AND TYPEOF(sc.final) != 'text'
           AND sc.eval_model = s.eval_model
         ORDER BY sc.final ${order}, s.hn_id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(section, limit, offset)
      .all<ArticleRankingRow>();
    return results;
  } catch (err) {
    console.error('[getArticleRanking] DB error:', err);
    return [];
  }
}

export interface ArticleCoverageRow {
  section: string;
  sort_order: number;
  signal_count: number;
  avg_final: number | null;
}

export async function getArticleCoverage(db: D1Database): Promise<ArticleCoverageRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT sc.section, sc.sort_order,
                SUM(CASE WHEN sc.final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
                AVG(sc.final) as avg_final
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE sc.eval_model = s.eval_model
         GROUP BY sc.section
         ORDER BY sc.sort_order`
      )
      .all<ArticleCoverageRow>();
    return results;
  } catch (err) {
    console.error('[getArticleCoverage] DB error:', err);
    return [];
  }
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
  coverageLite: number;       // hcb_editorial_mean IS NOT NULL AND hcb_weighted_mean IS NULL
  coverageMultiModel: number; // consensus_model_count >= 2
  coverageNone: number;       // no scores at all, non-skipped (pending/evaluating/failed with no editorial)
}

export async function getStatusCounts(db: D1Database): Promise<StatusCounts> {
  const { results } = await db
    .prepare(`SELECT eval_status, COUNT(*) as cnt FROM stories GROUP BY eval_status`)
    .all<{ eval_status: string; cnt: number }>();

  const counts: StatusCounts = {
    done: 0, pending: 0, evaluating: 0, failed: 0, skipped: 0, total: 0,
    coverageFull: 0, coverageLite: 0, coverageMultiModel: 0, coverageNone: 0,
  };
  for (const r of results) {
    const key = r.eval_status as keyof Omit<StatusCounts, 'total' | 'coverageFull' | 'coverageLite' | 'coverageMultiModel' | 'coverageNone'>;
    if (key in counts) (counts as any)[key] = r.cnt;
    counts.total += r.cnt;
  }

  // Coverage spectrum (single query, 3 conditional counts)
  const cov = await db.prepare(
    `SELECT
       COUNT(CASE WHEN hcb_weighted_mean IS NOT NULL AND eval_status != 'skipped' THEN 1 END) as full_coverage,
       COUNT(CASE WHEN hcb_editorial_mean IS NOT NULL AND hcb_weighted_mean IS NULL AND eval_status != 'skipped' THEN 1 END) as light_only,
       COUNT(CASE WHEN consensus_model_count >= 2 AND eval_status != 'skipped' THEN 1 END) as multi_model
     FROM stories WHERE hn_id > 0`
  ).first<{ full_coverage: number; light_only: number; multi_model: number }>();

  if (cov) {
    counts.coverageFull = cov.full_coverage;
    counts.coverageLite = cov.light_only;
    counts.coverageMultiModel = cov.multi_model;
    counts.coverageNone = counts.total - cov.full_coverage - cov.light_only - counts.skipped; // light_only is SQL alias, stays
  }

  return counts;
}

export interface ContentTypeStat {
  content_type: string;
  count: number;
  avg_score: number;
}

export async function getContentTypeStats(db: D1Database): Promise<ContentTypeStat[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT content_type, COUNT(*) as count, AVG(hcb_weighted_mean) as avg_score
         FROM stories WHERE eval_status = 'done'
         GROUP BY content_type ORDER BY count DESC`
      )
      .all<ContentTypeStat>();
    return results;
  } catch (err) {
    console.error('[getContentTypeStats] DB error:', err);
    return [];
  }
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
  try {
    const { results } = await db
      .prepare(
        `SELECT sc.section, sc.sort_order,
                AVG(sc.final) as avg_final,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                AVG(sc.final * sc.final) as avg_final_sq,
                SUM(CASE WHEN sc.final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
                SUM(CASE WHEN sc.final IS NULL THEN 1 ELSE 0 END) as nd_count,
                SUM(CASE WHEN sc.evidence = 'H' THEN 1 ELSE 0 END) as evidence_h,
                SUM(CASE WHEN sc.evidence = 'M' THEN 1 ELSE 0 END) as evidence_m,
                SUM(CASE WHEN sc.evidence = 'L' THEN 1 ELSE 0 END) as evidence_l
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE sc.eval_model = s.eval_model
         GROUP BY sc.section ORDER BY sc.sort_order`
      )
      .all<ArticleDetailedStat & { avg_final_sq: number | null }>();
    return results.map(r => {
      const avgFinalSq = r.avg_final_sq ?? 0;
      const avgFinal = r.avg_final ?? 0;
      const stddev = Math.sqrt(Math.max(0, avgFinalSq - avgFinal * avgFinal));
      return { ...r, stddev_final: stddev };
    });
  } catch (err) {
    console.error('[getArticleDetailedStats] DB error:', err);
    return [];
  }
}

/** @internal Future use: article deep dive (Round 6) */
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

/** @internal Future use: article deep dive (Round 6) */
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

/** @internal Future use: dashboard candidate */
export async function getTopSetlStories(db: D1Database, limit = 5): Promise<SetlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STORY_LIST_COLS},
              (SELECT AVG(${SETL_CASE_SQL('sc')})
               FROM rater_scores sc
               WHERE sc.hn_id = s.hn_id AND sc.eval_model = s.eval_model
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

/** @internal Future use: dashboard candidate */
export async function getBottomSetlStories(db: D1Database, limit = 5): Promise<SetlStory[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STORY_LIST_COLS},
              (SELECT AVG(${SETL_CASE_SQL('sc')})
               FROM rater_scores sc
               WHERE sc.hn_id = s.hn_id AND sc.eval_model = s.eval_model
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


/** @internal Future use: dashboard candidate */
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
  avg_editorial: number | null;
  avg_structural: number | null;
  avg_setl: number | null;
  avg_conf: number | null;
}

export async function getDomainStats(db: D1Database, limit = 10): Promise<DomainStat[]> {
  try {
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
  } catch (err) {
    console.error('[getDomainStats] DB error:', err);
    return [];
  }
}

export async function getQueueStories(db: D1Database, limit = 100): Promise<Story[]> {
  try {
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
  } catch (err) {
    console.error('[getQueueStories] DB error:', err);
    return [];
  }
}

export interface ModelStat {
  eval_model: string;
  count: number;
  avg_score: number;
}

export async function getModelStats(db: D1Database): Promise<ModelStat[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT eval_model, COUNT(*) as count, AVG(hcb_weighted_mean) as avg_score
         FROM stories WHERE eval_status = 'done' AND eval_model IS NOT NULL
         GROUP BY eval_model ORDER BY count DESC`
      )
      .all<ModelStat>();
    return results;
  } catch (err) {
    console.error('[getModelStats] DB error:', err);
    return [];
  }
}

export async function getFailedStories(db: D1Database, limit = 10): Promise<Story[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT ${STORY_LIST_COLS} FROM stories WHERE eval_status = 'failed'
         ORDER BY created_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<Story>();
    return results;
  } catch (err) {
    console.error('[getFailedStories] DB error:', err);
    return [];
  }
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
    .all<Omit<Story, 'hn_text'> & { hn_text_preview: string | null }>();

  const evaluatedIds = storyRows
    .filter(s => s.eval_status === 'done')
    .map(s => s.hn_id);

  const scoresByHnId = new Map<number, MiniScore[]>();

  if (evaluatedIds.length > 0) {
    const { results: scoreRows } = await db
      .prepare(
        `SELECT rs.hn_id, rs.section, rs.sort_order, rs.final, rs.editorial, rs.structural
         FROM rater_scores rs
         JOIN stories s2 ON s2.hn_id = rs.hn_id
         WHERE rs.hn_id IN (${evaluatedIds.map(() => '?').join(',')})
           AND rs.eval_model = s2.eval_model
         ORDER BY rs.sort_order`
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
  try {
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
       FROM rater_scores sc JOIN stories s ON s.hn_id = sc.hn_id
       WHERE s.${col} = ? AND sc.final IS NOT NULL AND sc.eval_model = s.eval_model`
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
  } catch (err) {
    console.error('[getEntityDetailStats] DB error:', err);
    return { avgConf: null, avgEditorial: null, avgStructural: null, evaluatedCount: 0, topStory: null, bottomStory: null };
  }
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
  } catch (err) {
    console.error('[getEvalHistoryForStory] DB error:', err);
    return [];
  }
}
