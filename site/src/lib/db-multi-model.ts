// SPDX-License-Identifier: Apache-2.0
import { scoreToColor, formatScore } from './colors';
import { ALL_SECTIONS } from './eval-types';
import { ARTICLE_TITLES } from './udhr';
import { meanCI } from './stats';

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
       INNER JOIN model_registry mr_a ON mr_a.model_id = a.eval_model AND mr_a.enabled = 1
       INNER JOIN model_registry mr_b ON mr_b.model_id = b.eval_model AND mr_b.enabled = 1
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
       INNER JOIN model_registry mr ON mr.model_id = r.eval_model AND mr.enabled = 1
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
  pt_score: number | null;
  td_score: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  evaluated_at: string | null;
  created_at: string;
  prompt_mode: string | null;
  et_arousal: number | null;
  eval_batch_id: string | null;
  content_truncation_pct: number | null;
  reasoning: string | null;
  psq_score: number | null;
  psq_dimensions_json: string | null;
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
      `SELECT re.hn_id, re.eval_model, re.prompt_mode FROM rater_evals re
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       WHERE re.hn_id IN (${placeholders}) AND re.eval_status = 'done'
       ORDER BY re.hn_id, re.eval_model`
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
        `SELECT re.eval_model AS model,
                COUNT(*) AS eval_count,
                AVG(re.hcb_weighted_mean) AS avg_score,
                AVG(re.hcb_confidence) AS avg_confidence
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
         GROUP BY re.eval_model
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
           SUM(CASE WHEN re.eval_status = 'done'       AND re.hn_id > 0 THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN re.eval_status = 'queued'     AND re.hn_id > 0 THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN re.eval_status = 'failed'     AND re.hn_id > 0 THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN re.eval_status = 'pending'    AND re.hn_id > 0 THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN re.eval_status = 'evaluating' AND re.hn_id > 0 THEN 1 ELSE 0 END) AS evaluating,
           (SELECT COUNT(*) FROM stories WHERE hn_id > 0) AS total_primary
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
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
      `WITH shared AS (
         SELECT re.hn_id FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
         GROUP BY re.hn_id HAVING COUNT(DISTINCT re.eval_model) >= 2
       )
       SELECT re.hn_id, re.eval_model, re.hcb_weighted_mean, re.hcb_classification,
              re.hcb_confidence, re.hcb_setl, re.hcb_theme_tag,
              s.title, s.url, s.domain, s.hn_score
       FROM rater_evals re
       JOIN shared sh ON sh.hn_id = re.hn_id
       JOIN stories s ON s.hn_id = re.hn_id
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       WHERE re.eval_status = 'done'
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
  std_dev: number;
  ci_margin: number;
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
}[]> {
  const raw = await db
    .prepare(
      `WITH shared AS (
         SELECT re.hn_id FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
         GROUP BY re.hn_id HAVING COUNT(DISTINCT re.eval_model) >= 2
       )
       SELECT
         re.eval_model AS model,
         COUNT(*) AS story_count,
         AVG(re.hcb_weighted_mean) AS avg_score,
         AVG(ABS(re.hcb_weighted_mean)) AS avg_abs_score,
         AVG(re.hcb_weighted_mean * re.hcb_weighted_mean) AS avg_sq,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS positive_pct,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS negative_pct,
         ROUND(100.0 * SUM(CASE WHEN re.hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END) / COUNT(*), 1) AS neutral_pct
       FROM rater_evals re
       JOIN shared sh ON sh.hn_id = re.hn_id
       INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
       WHERE re.eval_status = 'done'
       GROUP BY re.eval_model
       ORDER BY re.eval_model`
    )
    .all<{ model: string; story_count: number; avg_score: number; avg_abs_score: number; avg_sq: number; positive_pct: number; negative_pct: number; neutral_pct: number }>();
  return raw.results.map(r => {
    const variance = Math.max(0, (r.avg_sq ?? 0) - (r.avg_score ?? 0) ** 2);
    const std_dev = Math.sqrt(variance);
    const { margin: ci_margin } = meanCI(r.avg_score ?? 0, std_dev, r.story_count);
    return { ...r, std_dev: Math.round(std_dev * 1000) / 1000, ci_margin: Math.round(ci_margin * 1000) / 1000 };
  });
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
      `WITH shared AS (
         SELECT re.hn_id FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.eval_status = 'done'
         GROUP BY re.hn_id HAVING COUNT(DISTINCT re.eval_model) >= 2
       )
       SELECT
         rs.eval_model AS model,
         rs.section,
         AVG(rs.final) AS avg_final,
         COUNT(*) AS count
       FROM rater_scores rs
       JOIN shared sh ON sh.hn_id = rs.hn_id
       INNER JOIN model_registry mr ON mr.model_id = rs.eval_model AND mr.enabled = 1
       WHERE rs.final IS NOT NULL
       GROUP BY rs.eval_model, rs.section
       ORDER BY rs.section, rs.eval_model`
    )
    .all<{ model: string; section: string; avg_final: number; count: number }>();
  return results;
}

// --- Pre-computed model comparison blob (cron worker → KV → models page) ---
// Moves heavy queries + O(n²) compute out of CF Pages (10ms CPU limit) into
// cron worker (30s CPU budget). Models page reads single KV blob.

export const MODEL_COMPARISON_KV_KEY = 'sys:models:comparison';
export const MODEL_COMPARISON_TTL = 600; // 10 minutes

/** JSON-serializable blob with all multi-model comparison data pre-computed */
export interface ModelComparisonBlob {
  // Per-model aggregates (from getModelComparisonAggregates)
  aggregates: {
    model: string;
    story_count: number;
    avg_score: number;
    avg_abs_score: number;
    std_dev: number;
    ci_margin: number;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
  }[];

  // Computed stats
  modelIds: string[];
  totalStories: number;
  agreeCount: number;
  agreePct: number;
  classAgreeCount: number;
  classAgreePct: number;
  avgDelta: number;
  medianDelta: number;

  // Pair correlations
  pairCorrelations: { modelA: string; modelB: string; r: number | null; n: number }[];

  // Histograms (Map serialized as array)
  histograms: { model: string; counts: number[] }[];
  histMaxCount: number;

  // Section divergence (pre-sorted by delta)
  sectionDivergence: { section: string; idx: number; vals: (number | null)[]; delta: number; title: string }[];
  topDivergent: { section: string; idx: number; vals: (number | null)[]; delta: number; title: string }[];

  // Bias analysis
  biasAnalysis: { model: string; higher: number; lower: number; total: number; higherPct: number; lowerPct: number }[];

  // Most disagreed/agreed (top 10 each, pre-colored)
  mostDisagreed: ComparedStory[];
  mostAgreed: ComparedStory[];

  // All compared stories (pre-colored for template rendering)
  comparedStories: ComparedStory[];

  // Excluded models (< MIN_STORIES shared)
  excludedModels: { model: string; story_count: number }[];

  // Section averages lookup: { model, section, avg_final }[]
  sectionAverages: { model: string; section: string; avg_final: number }[];

  // Metadata
  computedAt: string;
}

export interface ComparedStory {
  hn_id: number;
  title: string;
  domain: string | null;
  allAgree: boolean;
  classAgree: boolean;
  maxDelta: number;
  models: { model: string; score: number; scoreColor: string; scoreFormatted: string; classification: string | null }[];
}

const CMP_MIN_STORIES = 10;
const CMP_BINS = 10;
const CMP_BIN_MIN = -0.5;
const CMP_BIN_MAX = 0.5;
const CMP_BIN_WIDTH = (CMP_BIN_MAX - CMP_BIN_MIN) / CMP_BINS;

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? null : num / denom;
}

/** Pre-compute everything the models page comparison sections need.
 *  Runs in cron worker (30s CPU) — result stored in KV for page to read. */
export async function computeModelComparisonBlob(db: D1Database): Promise<ModelComparisonBlob> {
  // 1. Run the 3 heavy queries
  const [stories, allAggregates, sectionAvgs] = await Promise.all([
    getMultiModelStories(db, 500),
    getModelComparisonAggregates(db),
    getModelSectionAverages(db),
  ]);

  // 2. Filter to models with enough shared stories
  const aggregates = allAggregates.filter(a => a.story_count >= CMP_MIN_STORIES);
  const modelIds = aggregates.map(a => a.model);

  // 3. Filter stories to only include qualifying models
  const filteredStories = stories.map(s => ({
    ...s,
    models: s.models.filter(m => modelIds.includes(m.model)),
  })).filter(s => s.models.length >= 2);

  // 4. Build section averages lookup
  const sectionByModelMap = new Map<string, Map<string, number>>();
  for (const row of sectionAvgs) {
    if (!modelIds.includes(row.model)) continue;
    if (!sectionByModelMap.has(row.model)) sectionByModelMap.set(row.model, new Map());
    sectionByModelMap.get(row.model)!.set(row.section, row.avg_final);
  }

  // 5. Per-story agreement and delta
  const storyStats = filteredStories.map(s => {
    const scores = s.models.map(m => m.score);
    const signs = scores.map(sc => sc >= 0 ? 1 : -1);
    const allAgree = signs.every(sg => sg === signs[0]);
    const maxDelta = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : 0;
    const classes = s.models.map(m => m.classification).filter(Boolean);
    const classAgree = classes.length >= 2 && classes.every(c => c === classes[0]);
    return { ...s, allAgree, classAgree, maxDelta };
  });

  const totalStories = storyStats.length;
  const agreeCount = storyStats.filter(s => s.allAgree).length;
  const agreePct = totalStories > 0 ? Math.round((agreeCount / totalStories) * 100) : 0;
  const classAgreeCount = storyStats.filter(s => s.classAgree).length;
  const classAgreePct = totalStories > 0 ? Math.round((classAgreeCount / totalStories) * 100) : 0;
  const avgDelta = totalStories > 0 ? storyStats.reduce((sum, s) => sum + s.maxDelta, 0) / totalStories : 0;
  const medianDelta = (() => {
    const sorted = [...storyStats].map(s => s.maxDelta).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  // 6. Most disagreed / agreed (pre-compute colors for template)
  const sortedByDelta = [...storyStats].sort((a, b) => b.maxDelta - a.maxDelta);

  function toComparedStory(s: typeof storyStats[0]): ComparedStory {
    return {
      hn_id: s.hn_id,
      title: s.title,
      domain: s.domain,
      allAgree: s.allAgree,
      classAgree: s.classAgree,
      maxDelta: s.maxDelta,
      models: s.models.map(m => ({
        model: m.model,
        score: m.score,
        scoreColor: scoreToColor(m.score),
        scoreFormatted: formatScore(m.score),
        classification: m.classification,
      })),
    };
  }

  const mostDisagreed = sortedByDelta.slice(0, 10).map(toComparedStory);
  const mostAgreed = [...storyStats].sort((a, b) => a.maxDelta - b.maxDelta).slice(0, 10).map(toComparedStory);
  const comparedStories = sortedByDelta.map(toComparedStory);

  // 7. Pair correlations
  const pairCorrelations: ModelComparisonBlob['pairCorrelations'] = [];
  for (let i = 0; i < modelIds.length; i++) {
    for (let j = i + 1; j < modelIds.length; j++) {
      const a = modelIds[i], b = modelIds[j];
      const xs: number[] = [], ys: number[] = [];
      for (const s of filteredStories) {
        const sa = s.models.find(m => m.model === a);
        const sb = s.models.find(m => m.model === b);
        if (sa && sb) { xs.push(sa.score); ys.push(sb.score); }
      }
      pairCorrelations.push({ modelA: a, modelB: b, r: pearsonCorrelation(xs, ys), n: xs.length });
    }
  }

  // 8. Histograms
  const histograms: ModelComparisonBlob['histograms'] = [];
  for (const mid of modelIds) {
    const counts = new Array(CMP_BINS).fill(0);
    for (const s of filteredStories) {
      const me = s.models.find(m => m.model === mid);
      if (!me) continue;
      const bin = Math.min(CMP_BINS - 1, Math.max(0, Math.floor((me.score - CMP_BIN_MIN) / CMP_BIN_WIDTH)));
      counts[bin]++;
    }
    histograms.push({ model: mid, counts });
  }
  const histMaxCount = Math.max(1, ...histograms.flatMap(h => h.counts));

  // 9. Section divergence
  const sectionDivergence = ALL_SECTIONS.map((section, idx) => {
    const vals = modelIds.map(m => sectionByModelMap.get(m)?.get(section) ?? null);
    const validVals = vals.filter((v): v is number => v !== null);
    const delta = validVals.length >= 2 ? Math.max(...validVals) - Math.min(...validVals) : 0;
    const title = ARTICLE_TITLES[section] ?? section;
    return { section, idx, vals, delta, title };
  }).sort((a, b) => b.delta - a.delta);

  // 10. Bias analysis
  const biasAnalysis = modelIds.map(mid => {
    let higher = 0, lower = 0, total = 0;
    for (const s of storyStats) {
      const me = s.models.find(m => m.model === mid);
      if (!me || s.models.length < 2) continue;
      const otherScores = s.models.filter(m => m.model !== mid).map(m => m.score);
      const otherMean = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
      if (me.score > otherMean + 0.01) higher++;
      else if (me.score < otherMean - 0.01) lower++;
      total++;
    }
    return { model: mid, higher, lower, total, higherPct: total > 0 ? Math.round((higher / total) * 100) : 0, lowerPct: total > 0 ? Math.round((lower / total) * 100) : 0 };
  });

  // 11. Excluded models
  const excludedModels = allAggregates
    .filter(a => a.story_count < CMP_MIN_STORIES && a.story_count > 0)
    .map(a => ({ model: a.model, story_count: a.story_count }));

  // 12. Section averages (serialized from map)
  const sectionAverages = sectionAvgs
    .filter(r => modelIds.includes(r.model))
    .map(r => ({ model: r.model, section: r.section, avg_final: r.avg_final }));

  return {
    aggregates,
    modelIds,
    totalStories,
    agreeCount,
    agreePct,
    classAgreeCount,
    classAgreePct,
    avgDelta,
    medianDelta,
    pairCorrelations,
    histograms,
    histMaxCount,
    sectionDivergence,
    topDivergent: sectionDivergence.slice(0, 5),
    biasAnalysis,
    mostDisagreed,
    mostAgreed,
    comparedStories,
    excludedModels,
    sectionAverages,
    computedAt: new Date().toISOString(),
  };
}
