// No imports from other db modules needed - self-contained

// --- Model Agreement ---

export interface ModelAgreementPair {
  model_a: string;
  model_b: string;
  pairs: number;
  avg_diff: number;
  class_agree: number;
  pearson_r: number | null;
}

/** @internal Future use: multi-model analytics dashboard */
export async function getModelAgreement(db: D1Database): Promise<ModelAgreementPair[]> {
  const { results } = await db
    .prepare(
      `SELECT
        a.eval_model as model_a, b.eval_model as model_b,
        COUNT(*) as pairs,
        AVG(ABS(a.hcb_weighted_mean - b.hcb_weighted_mean)) as avg_diff,
        AVG(CASE WHEN a.hcb_classification = b.hcb_classification THEN 1.0 ELSE 0.0 END) as class_agree,
        CASE WHEN COUNT(*) >= 10 THEN
          (COUNT(*) * SUM(a.hcb_weighted_mean * b.hcb_weighted_mean)
           - SUM(a.hcb_weighted_mean) * SUM(b.hcb_weighted_mean))
          / NULLIF(
            SQRT(
              (COUNT(*) * SUM(a.hcb_weighted_mean * a.hcb_weighted_mean) - SUM(a.hcb_weighted_mean) * SUM(a.hcb_weighted_mean))
              * (COUNT(*) * SUM(b.hcb_weighted_mean * b.hcb_weighted_mean) - SUM(b.hcb_weighted_mean) * SUM(b.hcb_weighted_mean))
            ), 0)
        ELSE NULL END as pearson_r
       FROM rater_evals a
       JOIN rater_evals b ON a.hn_id = b.hn_id AND a.eval_model < b.eval_model
       WHERE a.eval_status = 'done' AND b.eval_status = 'done'
         AND a.hcb_weighted_mean IS NOT NULL AND b.hcb_weighted_mean IS NOT NULL
       GROUP BY a.eval_model, b.eval_model
       ORDER BY pairs DESC`
    )
    .all<ModelAgreementPair>();
  return results;
}

// --- Top Movers (biggest model disagreement per story) ---

export interface ModelMover {
  hn_id: number;
  title: string;
  domain: string | null;
  model_count: number;
  min_score: number;
  max_score: number;
  spread: number;
  primary_score: number | null;
}

/** @internal Future use: multi-model analytics dashboard */
export async function getTopModelMovers(db: D1Database, limit = 10): Promise<ModelMover[]> {
  const { results } = await db
    .prepare(
      `SELECT
        r.hn_id,
        s.title,
        s.domain,
        COUNT(DISTINCT r.eval_model) as model_count,
        MIN(r.hcb_weighted_mean) as min_score,
        MAX(r.hcb_weighted_mean) as max_score,
        MAX(r.hcb_weighted_mean) - MIN(r.hcb_weighted_mean) as spread,
        s.hcb_weighted_mean as primary_score
       FROM rater_evals r
       JOIN stories s ON s.hn_id = r.hn_id
       WHERE r.eval_status = 'done' AND r.hcb_weighted_mean IS NOT NULL
       GROUP BY r.hn_id
       HAVING COUNT(DISTINCT r.eval_model) >= 2
       ORDER BY spread DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<ModelMover>();
  return results;
}

// --- Multi-model (rater) query functions ---

export interface RaterEvalRow {
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
  prompt_mode: string | null;
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
export async function getRaterEvalsForStory(db: D1Database, hnId: number): Promise<RaterEvalRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rater_evals WHERE hn_id = ? AND eval_status = 'done' ORDER BY eval_model`
    )
    .bind(hnId)
    .all<RaterEvalRow>();
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
export interface RaterEvalRef {
  eval_model: string;
  prompt_mode: string | null;
}

export async function getRaterEvalCounts(db: D1Database, hnIds: number[]): Promise<Map<number, RaterEvalRef[]>> {
  if (hnIds.length === 0) return new Map();

  const placeholders = hnIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT hn_id, eval_model, prompt_mode FROM rater_evals
       WHERE hn_id IN (${placeholders}) AND eval_status = 'done'
       ORDER BY hn_id, eval_model`
    )
    .bind(...hnIds)
    .all<{ hn_id: number; eval_model: string; prompt_mode: string | null }>();

  const map = new Map<number, RaterEvalRef[]>();
  for (const row of results) {
    const existing = map.get(row.hn_id) || [];
    existing.push({ eval_model: row.eval_model, prompt_mode: row.prompt_mode });
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
  } catch (err) {
    console.error('[getRaterSummaryStats] DB error:', err);
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
  } catch (err) {
    console.error('[getRaterStatusBreakdown] DB error:', err);
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
