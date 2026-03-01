/**
 * Evaluation result DB write helpers.
 *
 * Pure extraction from shared-eval.ts — no logic changes.
 */

import { computeSetl, EVIDENCE_WEIGHTS_CONFIDENCE } from './compute-aggregates';
import { ALL_SECTIONS, type EvalResult, type LiteEvalResponse } from './eval-types';
import { computeLiteAggregates } from './eval-parse';
import { PRIMARY_MODEL_ID } from './models';
import { logEvent } from './events';

// --- Propaganda technique weights (PTC-18) ---
// Weights reflect inherent rhetorical impact of each technique, not per-instance severity.
// Tier A (3): bypasses reasoning or dehumanizes
// Tier B (2): manipulative but recoverable
// Tier C (1): rhetorical but ubiquitous
const PT_TECHNIQUE_WEIGHTS: Record<string, number> = {
  reductio_ad_hitlerum: 3, appeal_to_fear: 3, name_calling: 3,
  false_dilemma: 3, thought_terminating_cliche: 3,
  causal_oversimplification: 2, strawman: 2, whataboutism: 2,
  bandwagon: 2, flag_waving: 2, exaggeration: 2, doubt: 2,
  loaded_language: 1, repetition: 1, appeal_to_authority: 1,
  slogans: 1, red_herring: 1, obfuscation: 1,
};

function computePtScore(flags: Array<{ technique: string }> | null | undefined): number | null {
  if (flags == null) return null;
  if (flags.length === 0) return 0;
  return flags.reduce((sum, f) => sum + (PT_TECHNIQUE_WEIGHTS[f.technique] ?? 0), 0);
}

// --- DB write helpers ---

export async function writeEvalResult(
  db: D1Database,
  hnId: number,
  result: EvalResult,
  model: string = PRIMARY_MODEL_ID,
  promptHash: string | null = null
): Promise<void> {
  // FK guard: bail if story doesn't exist (stale queue message)
  const exists = await db.prepare('SELECT 1 FROM stories WHERE hn_id = ?').bind(hnId).first();
  if (!exists) {
    throw new Error(`Story hn_id=${hnId} not found — skipping eval write (stale message)`);
  }

  const agg = result.aggregates;

  // Compute Fair Witness aggregates from scores
  let fwObservableCount = 0;
  let fwInferenceCount = 0;
  for (const score of result.scores) {
    if (score.witness_facts) fwObservableCount += score.witness_facts.length;
    if (score.witness_inferences) fwInferenceCount += score.witness_inferences.length;
  }
  const fwTotal = fwObservableCount + fwInferenceCount;
  const fwRatio = fwTotal > 0 ? fwObservableCount / fwTotal : null;

  // Compute story-level channel means for materialized columns
  const editorials = result.scores.filter(s => s.editorial !== null).map(s => s.editorial!);
  const structurals = result.scores.filter(s => s.structural !== null).map(s => s.structural!);
  const hcbEditorialMean = editorials.length > 0 ? editorials.reduce((a, b) => a + b, 0) / editorials.length : null;
  const hcbStructuralMean = structurals.length > 0 ? structurals.reduce((a, b) => a + b, 0) / structurals.length : null;

  // SETL
  const hcbSetl = computeSetl(result.scores);

  // Confidence
  let confWeightedSum = 0;
  const totalSections = result.scores.length;
  for (const s of result.scores) {
    const ev = s.evidence?.toUpperCase();
    if (ev && ev in EVIDENCE_WEIGHTS_CONFIDENCE) confWeightedSum += EVIDENCE_WEIGHTS_CONFIDENCE[ev];
  }
  const hcbConfidence = totalSections > 0 ? confWeightedSum / totalSections : null;

  // Extract supplementary signals with null fallbacks
  const eq = result.epistemic_quality;
  const pt = result.propaganda_flags;
  const so = result.solution_orientation;
  const et = result.emotional_tone;
  const sr = result.stakeholder_representation;
  const tf = result.temporal_framing;
  const gs = result.geographic_scope;
  const cl = result.complexity_level;
  const td = result.transparency_disclosure;

  await db
    .prepare(
      `UPDATE stories SET
        content_type = ?,
        hcb_weighted_mean = ?,
        hcb_classification = ?,
        hcb_signal_sections = ?,
        hcb_nd_count = ?,
        hcb_evidence_h = ?,
        hcb_evidence_m = ?,
        hcb_evidence_l = ?,
        hcb_json = ?,
        eval_model = ?,
        eval_prompt_hash = ?,
        fw_ratio = ?,
        fw_observable_count = ?,
        fw_inference_count = ?,
        hcb_editorial_mean = ?,
        hcb_structural_mean = ?,
        hcb_setl = ?,
        hcb_confidence = ?,
        schema_version = ?,
        hcb_theme_tag = ?,
        hcb_sentiment_tag = ?,
        hcb_executive_summary = ?,
        eq_score = ?,
        eq_source_quality = ?,
        eq_evidence_reasoning = ?,
        eq_uncertainty_handling = ?,
        eq_purpose_transparency = ?,
        eq_claim_density = ?,
        pt_flag_count = ?,
        pt_score = ?,
        pt_flags_json = ?,
        so_score = ?,
        so_framing = ?,
        so_reader_agency = ?,
        et_primary_tone = ?,
        et_valence = ?,
        et_arousal = ?,
        et_dominance = ?,
        sr_score = ?,
        sr_perspective_count = ?,
        sr_voice_balance = ?,
        sr_who_speaks = ?,
        sr_who_spoken_about = ?,
        tf_primary_focus = ?,
        tf_time_horizon = ?,
        gs_scope = ?,
        gs_regions_json = ?,
        cl_reading_level = ?,
        cl_jargon_density = ?,
        cl_assumed_knowledge = ?,
        td_score = ?,
        td_author_identified = ?,
        td_conflicts_disclosed = ?,
        td_funding_disclosed = ?,
        eval_status = 'done',
        eval_error = NULL,
        evaluated_at = datetime('now')
       WHERE hn_id = ?`
    )
    .bind(
      result.evaluation.content_type.primary,
      agg.weighted_mean,
      (agg.classification || '').split(' — ')[0],
      agg.signal_sections,
      agg.nd_count,
      agg.evidence_profile?.H ?? 0,
      agg.evidence_profile?.M ?? 0,
      agg.evidence_profile?.L ?? 0,
      JSON.stringify(result),
      model,
      promptHash,
      fwRatio,
      fwObservableCount,
      fwInferenceCount,
      hcbEditorialMean,
      hcbStructuralMean,
      hcbSetl,
      hcbConfidence,
      result.schema_version || null,
      result.theme_tag || null,
      result.sentiment_tag || null,
      result.executive_summary || null,
      // Epistemic Quality
      eq?.eq_score ?? null,
      eq?.source_quality ?? null,
      eq?.evidence_reasoning ?? null,
      eq?.uncertainty_handling ?? null,
      eq?.purpose_transparency ?? null,
      eq?.claim_density ?? null,
      // Propaganda Flags
      pt ? pt.length : 0,
      computePtScore(pt),
      pt && pt.length > 0 ? JSON.stringify(pt) : null,
      // Solution Orientation
      so?.so_score ?? null,
      so?.framing ?? null,
      so?.reader_agency ?? null,
      // Emotional Tone
      et?.primary_tone ?? null,
      et?.valence ?? null,
      et?.arousal ?? null,
      et?.dominance ?? null,
      // Stakeholder Representation
      sr?.sr_score ?? null,
      sr?.perspective_count ?? null,
      sr?.voice_balance ?? null,
      sr?.who_speaks ? JSON.stringify(sr.who_speaks) : null,
      sr?.who_is_spoken_about ? JSON.stringify(sr.who_is_spoken_about) : null,
      // Temporal Framing
      tf?.primary_focus ?? null,
      tf?.time_horizon ?? null,
      // Geographic Scope
      gs?.scope ?? null,
      gs?.regions_mentioned ? JSON.stringify(gs.regions_mentioned) : null,
      // Complexity Level
      cl?.reading_level ?? null,
      cl?.jargon_density ?? null,
      cl?.assumed_knowledge ?? null,
      // Transparency & Disclosure
      td?.td_score ?? null,
      td?.author_identified != null ? (td.author_identified ? 1 : 0) : null,
      td?.conflicts_disclosed != null ? (td.conflicts_disclosed ? 1 : 0) : null,
      td?.funding_disclosed != null ? (td.funding_disclosed ? 1 : 0) : null,
      hnId
    )
    .run();

  // Legacy scores/fair_witness tables removed — all per-section data
  // lives in rater_scores/rater_witness (written by writeRaterEvalResult)

  // Refresh materialized aggregates (best-effort)
  const domain = result.evaluation?.domain;
  if (domain) await refreshDomainAggregate(db, domain);

  // Refresh user aggregate — get hn_by from stories (already written above)
  const authorRow = await db
    .prepare('SELECT hn_by FROM stories WHERE hn_id = ?')
    .bind(hnId)
    .first<{ hn_by: string | null }>();
  if (authorRow?.hn_by) await refreshUserAggregate(db, authorRow.hn_by);

  await refreshDailySectionStats(db, result.scores);
}

// --- Internet Archive: fire-and-forget preservation (Phase 39C Part 1) ---

/**
 * Submit a URL to Internet Archive for preservation.
 * Rate-limited via KV: max 1 archive request per 10 seconds (key: archive:last_submit).
 * Stores the Wayback Machine URL in stories.archive_url.
 * Non-throwing — all errors are suppressed.
 */
export async function requestArchive(
  db: D1Database,
  kv: KVNamespace,
  hnId: number,
  url: string,
): Promise<void> {
  try {
    // Rate limit: 1 per 10 seconds
    const rateLimitKey = 'archive:last_submit';
    const lastSubmit = await kv.get(rateLimitKey);
    if (lastSubmit) return; // Still within rate limit window

    await kv.put(rateLimitKey, '1', { expirationTtl: 10 });

    const archiveUrl = `https://web.archive.org/save/${url}`;
    const resp = await fetch(archiveUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'HRCB-Evaluator/1.0 (hn-hrcb.pages.dev)' },
    });

    // Wayback Machine returns the Memento URL in the Content-Location header
    const mementoUrl = resp.headers.get('Content-Location');
    if (mementoUrl) {
      const fullArchiveUrl = mementoUrl.startsWith('http') ? mementoUrl : `https://web.archive.org${mementoUrl}`;
      await db
        .prepare(`UPDATE stories SET archive_url = ? WHERE hn_id = ?`)
        .bind(fullArchiveUrl, hnId)
        .run();
    }
  } catch {
    // Non-fatal: archive is best-effort
  }
}

// --- Consensus scoring ---

export async function updateConsensusScore(db: D1Database, hnId: number): Promise<void> {
  try {
    const { results } = await db
      .prepare(
        `SELECT re.eval_model, re.hcb_weighted_mean, re.hcb_editorial_mean, re.prompt_mode,
                re.content_truncation_pct, COALESCE(re.hcb_confidence, 0.5) as confidence
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.model_id = re.eval_model AND mr.enabled = 1
         WHERE re.hn_id = ? AND re.eval_status = 'done'
           AND (re.hcb_weighted_mean IS NOT NULL OR re.hcb_editorial_mean IS NOT NULL)
           AND re.schema_version NOT IN ('lite-1.3', 'light-1.3')`
      )
      .bind(hnId)
      .all<{ eval_model: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null; prompt_mode: string | null; content_truncation_pct: number | null; confidence: number }>();

    if (results.length < 2) return;

    let weightedSum = 0;
    let totalWeight = 0;
    const scores: number[] = [];

    for (const r of results) {
      const score = r.hcb_weighted_mean ?? r.hcb_editorial_mean;
      if (score == null) continue;
      const isLite = r.prompt_mode === 'lite' || r.prompt_mode === 'light';
      const baseWeight = isLite ? 0.5 : 1.0;
      // Confidence modulates within prompt mode — floor 0.2 so no model is fully silenced
      const confidenceFactor = Math.max(0.2, r.confidence);
      const truncPct = r.content_truncation_pct ?? 0;
      const weight = baseWeight * confidenceFactor * (1 - truncPct * 0.5);
      weightedSum += score * weight;
      totalWeight += weight;
      scores.push(score);
    }

    if (totalWeight === 0 || scores.length < 2) return;

    const consensusScore = Math.round((weightedSum / totalWeight) * 1000) / 1000;
    const spread = Math.round((Math.max(...scores) - Math.min(...scores)) * 1000) / 1000;

    await db
      .prepare(
        `UPDATE stories SET consensus_score=?, consensus_model_count=?,
         consensus_spread=?, consensus_updated_at=datetime('now') WHERE hn_id=?`
      )
      .bind(consensusScore, scores.length, spread, hnId)
      .run();

    // Alert on high cross-model divergence
    if (spread > 0.25) {
      const models = results.map(r => r.eval_model);
      const scoreMap = Object.fromEntries(results.map(r => [r.eval_model, r.hcb_weighted_mean ?? r.hcb_editorial_mean]));
      await logEvent(db, {
        hn_id: hnId,
        event_type: 'model_divergence',
        severity: spread > 0.50 ? 'error' : 'warn',
        message: `Cross-model spread ${spread.toFixed(2)} exceeds threshold (${results.length} models)`,
        details: { spread, consensus_score: consensusScore, model_count: results.length, models, scores: scoreMap },
      });
    }
  } catch (err) {
    // Non-throwing — consensus is best-effort
    console.error(`[eval-write] updateConsensusScore failed for hn_id=${hnId}:`, err);
  }
}

// --- Domain aggregates (materialized per-domain signal summary) ---

export async function refreshDomainAggregate(db: D1Database, domain: string): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO domain_aggregates (
           domain, story_count, evaluated_count,
           avg_hrcb, avg_setl, avg_editorial, avg_structural, avg_confidence,
           avg_eq, avg_so, avg_sr, avg_td, avg_pt_count, avg_pt_score,
           avg_valence, avg_arousal, avg_dominance, avg_fw_ratio,
           avg_hn_score, avg_hn_comments,
           dominant_tone, dominant_scope, dominant_reading_level, dominant_sentiment,
           last_updated_at
         )
         SELECT
           domain,
           COUNT(*),
           SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END),
           AVG(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END),
           AVG(CASE WHEN eval_status = 'done' THEN hcb_setl END),
           AVG(CASE WHEN eval_status = 'done' THEN hcb_editorial_mean END),
           AVG(CASE WHEN eval_status = 'done' THEN hcb_structural_mean END),
           AVG(CASE WHEN eval_status = 'done' THEN hcb_confidence END),
           AVG(CASE WHEN eval_status = 'done' THEN eq_score END),
           AVG(CASE WHEN eval_status = 'done' THEN so_score END),
           AVG(CASE WHEN eval_status = 'done' THEN sr_score END),
           AVG(CASE WHEN eval_status = 'done' THEN td_score END),
           AVG(CASE WHEN eval_status = 'done' AND pt_flag_count IS NOT NULL THEN pt_flag_count END),
           AVG(CASE WHEN eval_status = 'done' AND pt_score IS NOT NULL THEN pt_score END),
           AVG(CASE WHEN eval_status = 'done' THEN et_valence END),
           AVG(CASE WHEN eval_status = 'done' THEN et_arousal END),
           AVG(CASE WHEN eval_status = 'done' THEN et_dominance END),
           AVG(CASE WHEN eval_status = 'done' THEN fw_ratio END),
           AVG(hn_score),
           AVG(hn_comments),
           (SELECT et_primary_tone FROM stories
            WHERE domain = ? AND eval_status = 'done' AND et_primary_tone IS NOT NULL
            GROUP BY et_primary_tone ORDER BY COUNT(*) DESC LIMIT 1),
           (SELECT gs_scope FROM stories
            WHERE domain = ? AND eval_status = 'done' AND gs_scope IS NOT NULL
            GROUP BY gs_scope ORDER BY COUNT(*) DESC LIMIT 1),
           (SELECT cl_reading_level FROM stories
            WHERE domain = ? AND eval_status = 'done' AND cl_reading_level IS NOT NULL
            GROUP BY cl_reading_level ORDER BY COUNT(*) DESC LIMIT 1),
           (SELECT hcb_sentiment_tag FROM stories
            WHERE domain = ? AND eval_status = 'done' AND hcb_sentiment_tag IS NOT NULL
            GROUP BY hcb_sentiment_tag ORDER BY COUNT(*) DESC LIMIT 1),
           datetime('now')
         FROM stories WHERE domain = ?
         ON CONFLICT(domain) DO UPDATE SET
           story_count = excluded.story_count,
           evaluated_count = excluded.evaluated_count,
           avg_hrcb = excluded.avg_hrcb,
           avg_setl = excluded.avg_setl,
           avg_editorial = excluded.avg_editorial,
           avg_structural = excluded.avg_structural,
           avg_confidence = excluded.avg_confidence,
           avg_eq = excluded.avg_eq,
           avg_so = excluded.avg_so,
           avg_sr = excluded.avg_sr,
           avg_td = excluded.avg_td,
           avg_pt_count = excluded.avg_pt_count,
           avg_pt_score = excluded.avg_pt_score,
           avg_valence = excluded.avg_valence,
           avg_arousal = excluded.avg_arousal,
           avg_dominance = excluded.avg_dominance,
           avg_fw_ratio = excluded.avg_fw_ratio,
           avg_hn_score = excluded.avg_hn_score,
           avg_hn_comments = excluded.avg_hn_comments,
           dominant_tone = excluded.dominant_tone,
           dominant_scope = excluded.dominant_scope,
           dominant_reading_level = excluded.dominant_reading_level,
           dominant_sentiment = excluded.dominant_sentiment,
           last_updated_at = excluded.last_updated_at`
      )
      .bind(domain, domain, domain, domain, domain)
      .run();
  } catch (err) {
    console.error(`[eval-write] refreshDomainAggregate failed for ${domain}:`, err);
  }
}

/**
 * Refresh all domain_aggregates from the current stories table state.
 * Used after bulk data corrections (migrations) that make aggregates stale.
 * Pages through domain_aggregates in chunks to stay within D1 limits.
 */
export async function refreshAllDomainAggregates(
  db: D1Database,
  opts: { chunkSize?: number; minEvaluated?: number } = {},
): Promise<{ refreshed: number; errors: number; durationMs: number }> {
  const { chunkSize = 100, minEvaluated = 1 } = opts;
  const t0 = Date.now();
  let refreshed = 0;
  let errors = 0;
  let offset = 0;

  while (true) {
    const { results } = await db
      .prepare(
        `SELECT domain FROM domain_aggregates
         WHERE evaluated_count >= ?
         ORDER BY domain
         LIMIT ? OFFSET ?`,
      )
      .bind(minEvaluated, chunkSize, offset)
      .all<{ domain: string }>();

    if (results.length === 0) break;

    for (const { domain } of results) {
      try {
        await refreshDomainAggregate(db, domain);
        refreshed++;
      } catch (err) {
        errors++;
        console.error(`[refreshAllDomainAggregates] Failed for ${domain}:`, err);
      }
    }

    offset += results.length;
    if (results.length < chunkSize) break;
  }

  return { refreshed, errors, durationMs: Date.now() - t0 };
}

// --- User aggregates (materialized per-user signal summary) ---

/**
 * Upsert user_aggregates for a single username from current stories state.
 * Same pattern as refreshDomainAggregate. Called at eval write time and
 * from crawlUserProfiles after each user batch.
 *
 * karma/submitted_count/account_age_days come from hn_users (crawled separately).
 * COALESCE on conflict preserves existing values when subqueries return NULL.
 */
export async function refreshUserAggregate(db: D1Database, username: string): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO user_aggregates (
           username, stories, full_evaluated, lite_evaluated,
           avg_hrcb, min_hrcb, max_hrcb, hrcb_range,
           positive_pct, negative_pct, neutral_pct,
           avg_structural, avg_setl,
           avg_editorial_full, avg_editorial_lite,
           avg_eq, avg_so, avg_td,
           total_hn_score, avg_hn_score,
           total_comments, avg_comments,
           unique_domains, top_domain, dominant_tone,
           karma, submitted_count, account_age_days,
           last_updated_at
         )
         SELECT
           hn_by,
           COUNT(*),
           SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END),
           SUM(CASE WHEN hcb_editorial_mean IS NOT NULL AND eval_status != 'done' THEN 1 ELSE 0 END),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END), 4),
           MIN(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END),
           MAX(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END),
           ROUND(MAX(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END) -
                 MIN(CASE WHEN eval_status = 'done' THEN hcb_weighted_mean END), 4),
           ROUND(100.0 * SUM(CASE WHEN eval_status = 'done' AND hcb_weighted_mean > 0.05 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END), 0), 1),
           ROUND(100.0 * SUM(CASE WHEN eval_status = 'done' AND hcb_weighted_mean < -0.05 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END), 0), 1),
           ROUND(100.0 * SUM(CASE WHEN eval_status = 'done' AND hcb_weighted_mean BETWEEN -0.05 AND 0.05 THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN eval_status = 'done' THEN 1 ELSE 0 END), 0), 1),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN hcb_structural_mean END), 4),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN hcb_setl END), 4),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN hcb_editorial_mean END), 4),
           ROUND(AVG(CASE WHEN hcb_editorial_mean IS NOT NULL AND eval_status != 'done' THEN hcb_editorial_mean END), 4),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN eq_score END), 4),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN so_score END), 4),
           ROUND(AVG(CASE WHEN eval_status = 'done' THEN td_score END), 4),
           COALESCE(SUM(hn_score), 0),
           ROUND(AVG(hn_score), 1),
           COALESCE(SUM(hn_comments), 0),
           ROUND(AVG(hn_comments), 1),
           COUNT(DISTINCT domain),
           (SELECT domain FROM stories
            WHERE hn_by = ? AND hn_id > 0 AND domain IS NOT NULL
            GROUP BY domain ORDER BY COUNT(*) DESC LIMIT 1),
           (SELECT et_primary_tone FROM stories
            WHERE hn_by = ? AND hn_id > 0 AND eval_status = 'done' AND et_primary_tone IS NOT NULL
            GROUP BY et_primary_tone ORDER BY COUNT(*) DESC LIMIT 1),
           (SELECT karma FROM hn_users WHERE username = ?),
           (SELECT submitted_count FROM hn_users WHERE username = ?),
           (SELECT CAST((julianday('now') - julianday(datetime(created, 'unixepoch'))) AS INTEGER)
            FROM hn_users WHERE username = ?),
           datetime('now')
         FROM stories WHERE hn_by = ? AND hn_id > 0
         ON CONFLICT(username) DO UPDATE SET
           stories = excluded.stories,
           full_evaluated = excluded.full_evaluated,
           lite_evaluated = excluded.lite_evaluated,
           avg_hrcb = excluded.avg_hrcb,
           min_hrcb = excluded.min_hrcb,
           max_hrcb = excluded.max_hrcb,
           hrcb_range = excluded.hrcb_range,
           positive_pct = excluded.positive_pct,
           negative_pct = excluded.negative_pct,
           neutral_pct = excluded.neutral_pct,
           avg_structural = excluded.avg_structural,
           avg_setl = excluded.avg_setl,
           avg_editorial_full = excluded.avg_editorial_full,
           avg_editorial_lite = excluded.avg_editorial_lite,
           avg_eq = excluded.avg_eq,
           avg_so = excluded.avg_so,
           avg_td = excluded.avg_td,
           total_hn_score = excluded.total_hn_score,
           avg_hn_score = excluded.avg_hn_score,
           total_comments = excluded.total_comments,
           avg_comments = excluded.avg_comments,
           unique_domains = excluded.unique_domains,
           top_domain = excluded.top_domain,
           dominant_tone = excluded.dominant_tone,
           karma = COALESCE(excluded.karma, user_aggregates.karma),
           submitted_count = COALESCE(excluded.submitted_count, user_aggregates.submitted_count),
           account_age_days = COALESCE(excluded.account_age_days, user_aggregates.account_age_days),
           last_updated_at = excluded.last_updated_at`
      )
      .bind(username, username, username, username, username, username)
      .run();
  } catch (err) {
    console.error(`[eval-write] refreshUserAggregate failed for ${username}:`, err);
  }
}

/**
 * Refresh all user_aggregates from the current stories table state.
 * Used for bulk backfill after migration or data corrections.
 */
export async function refreshAllUserAggregates(
  db: D1Database,
  opts: { chunkSize?: number } = {},
): Promise<{ refreshed: number; errors: number; durationMs: number }> {
  const { chunkSize = 50 } = opts;
  const t0 = Date.now();
  let refreshed = 0;
  let errors = 0;
  let offset = 0;

  while (true) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT hn_by FROM stories
         WHERE hn_by IS NOT NULL AND hn_id > 0
         ORDER BY hn_by
         LIMIT ? OFFSET ?`,
      )
      .bind(chunkSize, offset)
      .all<{ hn_by: string }>();

    if (results.length === 0) break;

    for (const { hn_by } of results) {
      try {
        await refreshUserAggregate(db, hn_by);
        refreshed++;
      } catch (err) {
        errors++;
        console.error(`[refreshAllUserAggregates] Failed for ${hn_by}:`, err);
      }
    }

    offset += results.length;
    if (results.length < chunkSize) break;
  }

  return { refreshed, errors, durationMs: Date.now() - t0 };
}

/**
 * Backfill pt_score for stories that have pt_flags_json but no pt_score yet.
 * Reads existing flag data, applies PT_TECHNIQUE_WEIGHTS, writes pt_score to stories.
 * Safe to run multiple times (WHERE pt_score IS NULL guard).
 */
export async function backfillPtScores(
  db: D1Database,
  opts: { limit?: number } = {},
): Promise<{ updated: number; errors: number }> {
  const { limit = 500 } = opts;

  // Fetch stories with pt_flags_json but no pt_score yet
  const { results } = await db
    .prepare(
      `SELECT hn_id, pt_flags_json FROM stories
       WHERE pt_flags_json IS NOT NULL AND pt_score IS NULL
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ hn_id: number; pt_flags_json: string }>();

  let updated = 0;
  let errors = 0;

  for (const row of results) {
    try {
      let flags: Array<{ technique: string }> | null = null;
      try {
        flags = JSON.parse(row.pt_flags_json);
      } catch {
        flags = null;
      }
      const score = computePtScore(flags);
      if (score == null) continue;
      await db
        .prepare(`UPDATE stories SET pt_score = ? WHERE hn_id = ?`)
        .bind(score, row.hn_id)
        .run();
      updated++;
    } catch (err) {
      errors++;
      console.error(`[backfillPtScores] Failed for hn_id=${row.hn_id}:`, err);
    }
  }

  return { updated, errors };
}

export async function refreshDailySectionStats(
  db: D1Database,
  scores: Array<{ section: string; final: number | null }>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const stmts: D1PreparedStatement[] = [];
  for (const score of scores) {
    if (score.final == null) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO daily_section_stats (day, section, mean_final, min_final, max_final, eval_count)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(day, section) DO UPDATE SET
             mean_final  = (mean_final * eval_count + excluded.mean_final) / (eval_count + 1),
             min_final   = MIN(min_final,  excluded.min_final),
             max_final   = MAX(max_final,  excluded.max_final),
             eval_count  = eval_count + 1`
        )
        .bind(today, score.section, score.final, score.final, score.final)
    );
  }
  if (stmts.length === 0) return;
  try {
    await db.batch(stmts);
  } catch (err) {
    console.error(`[eval-write] refreshDailySectionStats batch failed:`, err);
  }
}

export async function markFailed(db: D1Database, hnId: number, error: string): Promise<void> {
  await db
    .prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ? AND eval_status NOT IN ('done', 'rescoring')`)
    .bind(error.slice(0, 500), hnId)
    .run();
}

export async function markSkipped(
  db: D1Database,
  hnId: number,
  reason: string,
  gateCategory?: string,
  gateConfidence?: number,
): Promise<void> {
  if (gateCategory != null) {
    await db
      .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ?, gate_category = ?, gate_confidence = ? WHERE hn_id = ? AND eval_status NOT IN ('done', 'rescoring')`)
      .bind(reason, gateCategory, gateConfidence ?? null, hnId)
      .run();
  } else {
    await db
      .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ? WHERE hn_id = ? AND eval_status NOT IN ('done', 'rescoring')`)
      .bind(reason, hnId)
      .run();
  }
}

// --- DCP Cache helpers ---

export async function getCachedDcp(
  db: D1Database,
  domain: string,
  maxAgeDays = 7,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT dcp_json FROM domain_dcp
       WHERE domain = ? AND cached_at >= datetime('now', ? || ' days')`
    )
    .bind(domain, -maxAgeDays)
    .first<{ dcp_json: string }>();

  if (!row) return null;

  try {
    return JSON.parse(row.dcp_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function cacheDcp(
  db: D1Database,
  domain: string,
  dcp: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO domain_dcp (domain, dcp_json, cached_at)
       VALUES (?, ?, datetime('now'))`
    )
    .bind(domain, JSON.stringify(dcp))
    .run();
}

// --- Rater eval write helpers ---

export async function writeRaterEvalResult(
  db: D1Database,
  hnId: number,
  result: EvalResult,
  modelId: string,
  provider: string,
  promptHash: string | null,
  methodologyHash: string | null,
  inputTokens: number,
  outputTokens: number,
  contentTruncationPct: number = 0,
  batchId: string | null = null,
): Promise<void> {
  // FK guard: bail if story doesn't exist (stale queue message)
  const exists = await db.prepare('SELECT 1 FROM stories WHERE hn_id = ?').bind(hnId).first();
  if (!exists) {
    throw new Error(`Story hn_id=${hnId} not found — skipping rater eval write (stale message)`);
  }

  const agg = result.aggregates;

  // Fair Witness aggregates
  let fwObservableCount = 0;
  let fwInferenceCount = 0;
  for (const score of result.scores) {
    if (score.witness_facts) fwObservableCount += score.witness_facts.length;
    if (score.witness_inferences) fwInferenceCount += score.witness_inferences.length;
  }
  const fwTotal = fwObservableCount + fwInferenceCount;
  const fwRatio = fwTotal > 0 ? fwObservableCount / fwTotal : null;

  // Channel means
  const editorials = result.scores.filter(s => s.editorial !== null).map(s => s.editorial!);
  const structurals = result.scores.filter(s => s.structural !== null).map(s => s.structural!);
  const hcbEditorialMean = editorials.length > 0 ? editorials.reduce((a, b) => a + b, 0) / editorials.length : null;
  const hcbStructuralMean = structurals.length > 0 ? structurals.reduce((a, b) => a + b, 0) / structurals.length : null;

  // Guard: full eval must have structural scores. If model returned editorial-only,
  // demote to lite-like behavior — write rater data but don't promote story to done.
  const missingStructural = hcbStructuralMean === null && editorials.length > 0;

  // SETL + Confidence
  const hcbSetl = computeSetl(result.scores);
  let confWeightedSum = 0;
  const totalSections = result.scores.length;
  for (const s of result.scores) {
    const ev = s.evidence?.toUpperCase();
    if (ev && ev in EVIDENCE_WEIGHTS_CONFIDENCE) confWeightedSum += EVIDENCE_WEIGHTS_CONFIDENCE[ev];
  }
  const hcbConfidence = totalSections > 0 ? confWeightedSum / totalSections : null;

  const eq = result.epistemic_quality;
  const pt = result.propaganda_flags;
  const so = result.solution_orientation;
  const et = result.emotional_tone;
  const sr = result.stakeholder_representation;
  const td = result.transparency_disclosure;

  // UPSERT rater_evals
  await db
    .prepare(
      `INSERT INTO rater_evals (
        hn_id, eval_model, eval_provider, eval_status, prompt_mode,
        hcb_weighted_mean, hcb_classification, hcb_json,
        hcb_signal_sections, hcb_nd_count,
        hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
        eval_prompt_hash, methodology_hash,
        content_type, schema_version,
        hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
        fw_ratio, fw_observable_count, fw_inference_count,
        hcb_editorial_mean, hcb_structural_mean, hcb_setl, hcb_confidence,
        eq_score, so_score, et_primary_tone, et_valence, et_arousal,
        sr_score, pt_flag_count, pt_score, td_score,
        input_tokens, output_tokens, content_truncation_pct,
        eval_batch_id, evaluated_at
      ) VALUES (
        ?, ?, ?, 'done', 'full',
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, datetime('now')
      )
      ON CONFLICT(hn_id, eval_model) DO UPDATE SET
        eval_status = 'done',
        eval_error = NULL,
        prompt_mode = 'full',
        hcb_weighted_mean = excluded.hcb_weighted_mean,
        hcb_classification = excluded.hcb_classification,
        hcb_json = excluded.hcb_json,
        hcb_signal_sections = excluded.hcb_signal_sections,
        hcb_nd_count = excluded.hcb_nd_count,
        hcb_evidence_h = excluded.hcb_evidence_h,
        hcb_evidence_m = excluded.hcb_evidence_m,
        hcb_evidence_l = excluded.hcb_evidence_l,
        eval_prompt_hash = excluded.eval_prompt_hash,
        methodology_hash = excluded.methodology_hash,
        content_type = excluded.content_type,
        schema_version = excluded.schema_version,
        hcb_theme_tag = excluded.hcb_theme_tag,
        hcb_sentiment_tag = excluded.hcb_sentiment_tag,
        hcb_executive_summary = excluded.hcb_executive_summary,
        fw_ratio = excluded.fw_ratio,
        fw_observable_count = excluded.fw_observable_count,
        fw_inference_count = excluded.fw_inference_count,
        hcb_editorial_mean = excluded.hcb_editorial_mean,
        hcb_structural_mean = excluded.hcb_structural_mean,
        hcb_setl = excluded.hcb_setl,
        hcb_confidence = excluded.hcb_confidence,
        eq_score = excluded.eq_score,
        so_score = excluded.so_score,
        et_primary_tone = excluded.et_primary_tone,
        et_valence = excluded.et_valence,
        et_arousal = excluded.et_arousal,
        sr_score = excluded.sr_score,
        pt_flag_count = excluded.pt_flag_count,
        pt_score = excluded.pt_score,
        td_score = excluded.td_score,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        content_truncation_pct = excluded.content_truncation_pct,
        eval_batch_id = excluded.eval_batch_id,
        evaluated_at = excluded.evaluated_at`
    )
    .bind(
      hnId, modelId, provider,
      agg.weighted_mean,
      (agg.classification || '').split(' — ')[0],
      JSON.stringify(result),
      agg.signal_sections, agg.nd_count,
      agg.evidence_profile?.H ?? 0, agg.evidence_profile?.M ?? 0, agg.evidence_profile?.L ?? 0,
      promptHash, methodologyHash,
      result.evaluation.content_type.primary,
      result.schema_version || null,
      result.theme_tag || null, result.sentiment_tag || null, result.executive_summary || null,
      fwRatio, fwObservableCount, fwInferenceCount,
      hcbEditorialMean, hcbStructuralMean, hcbSetl, hcbConfidence,
      eq?.eq_score ?? null,
      so?.so_score ?? null,
      et?.primary_tone ?? null, et?.valence ?? null, et?.arousal ?? null,
      sr?.sr_score ?? null,
      pt ? pt.length : 0,
      computePtScore(pt),
      td?.td_score ?? null,
      inputTokens, outputTokens, contentTruncationPct,
      batchId,
    )
    .run();

  // DELETE + INSERT rater_scores atomically (DELETE + ≤31 INSERTs always fits in one batch)
  const scoreStmts = result.scores.map((score) => {
    const sortOrder = ALL_SECTIONS.indexOf(score.section);
    const editorialNote = score.editorial_note || '';
    const structuralNote = score.structural_note || '';
    const note = score.note || editorialNote || structuralNote || '';
    return db
      .prepare(
        `INSERT INTO rater_scores (hn_id, section, eval_model, sort_order, final, editorial, structural, evidence, directionality, note, editorial_note, structural_note, combined, context_modifier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        hnId, score.section, modelId,
        sortOrder >= 0 ? sortOrder : 0,
        score.final, score.editorial, score.structural, score.evidence,
        JSON.stringify(score.directionality || []),
        note, editorialNote, structuralNote,
        score.combined ?? null, score.context_modifier ?? null,
      );
  });
  if (scoreStmts.length > 0) {
    const deleteScores = db.prepare(`DELETE FROM rater_scores WHERE hn_id = ? AND eval_model = ?`).bind(hnId, modelId);
    for (let i = 0; i < scoreStmts.length; i += 99) {
      const chunk = i === 0
        ? [deleteScores, ...scoreStmts.slice(0, 99)]
        : scoreStmts.slice(i, i + 99);
      await db.batch(chunk);
    }
  }

  // DELETE + INSERT rater_witness (13B: DELETE only when rows exist; 8A: first chunk is atomic)
  const fwRows: { section: string; factType: string; factText: string }[] = [];
  for (const score of result.scores) {
    if (score.witness_facts) {
      for (const fact of score.witness_facts) {
        fwRows.push({ section: score.section, factType: 'observable', factText: fact });
      }
    }
    if (score.witness_inferences) {
      for (const inference of score.witness_inferences) {
        fwRows.push({ section: score.section, factType: 'inference', factText: inference });
      }
    }
  }
  if (fwRows.length > 0) {
    const deleteFw = db.prepare(`DELETE FROM rater_witness WHERE hn_id = ? AND eval_model = ?`).bind(hnId, modelId);
    const fwStmts = fwRows.map((row) =>
      db
        .prepare(`INSERT INTO rater_witness (hn_id, eval_model, section, fact_type, fact_text) VALUES (?, ?, ?, ?, ?)`)
        .bind(hnId, modelId, row.section, row.factType, row.factText)
    );
    for (let i = 0; i < fwStmts.length; i += 99) {
      const chunk = i === 0
        ? [deleteFw, ...fwStmts.slice(0, 99)]
        : fwStmts.slice(i, i + 99);
      await db.batch(chunk);
    }
  }

  // Write to eval_history
  await db
    .prepare(
      `INSERT INTO eval_history (hn_id, eval_model, hcb_weighted_mean, hcb_classification, hcb_json, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      hnId, modelId,
      agg.weighted_mean,
      agg.classification,
      JSON.stringify(result),
      inputTokens, outputTokens,
    )
    .run();

  // Promote story to done: first full eval wins, later evals don't overwrite.
  // All models are peers — no primary model special case.
  // Guard: don't promote if structural channel is entirely missing (malformed full eval).
  const story = await db.prepare(
    `SELECT eval_status FROM stories WHERE hn_id = ?`
  ).bind(hnId).first<{ eval_status: string }>();
  const promoted = story && story.eval_status !== 'done' && story.eval_status !== 'rescoring' && !missingStructural;
  if (missingStructural) {
    await logEvent(db, {
      hn_id: hnId,
      event_type: 'eval_skip',
      model: modelId,
      detail: `Full eval missing structural channel (${editorials.length} editorial, 0 structural) — not promoting to done`,
    });
  }
  if (promoted) {
    // writeEvalResult also calls refreshDomainAggregate internally
    await writeEvalResult(db, hnId, result, modelId, promptHash);
  }

  // Update ensemble consensus score (best-effort, non-blocking)
  await updateConsensusScore(db, hnId);

  // Refresh materialized aggregates (skip if writeEvalResult already did them above)
  const domain = result.evaluation?.domain;
  if (!promoted && domain) await refreshDomainAggregate(db, domain);
  if (!promoted) {
    // writeEvalResult already called refreshUserAggregate if promoted
    const authorRow2 = await db
      .prepare('SELECT hn_by FROM stories WHERE hn_id = ?')
      .bind(hnId)
      .first<{ hn_by: string | null }>();
    if (authorRow2?.hn_by) await refreshUserAggregate(db, authorRow2.hn_by);
  }
}

export async function markRaterFailed(
  db: D1Database,
  hnId: number,
  modelId: string,
  provider: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rater_evals (hn_id, eval_model, eval_provider, eval_status, eval_error)
       VALUES (?, ?, ?, 'failed', ?)
       ON CONFLICT(hn_id, eval_model) DO UPDATE SET
         eval_status = 'failed',
         eval_error = excluded.eval_error`
    )
    .bind(hnId, modelId, provider, error.slice(0, 500))
    .run();
}

// --- Calibration longitudinal store ---

/**
 * Write a single calibration eval snapshot to calibration_evals.
 * Called from ingest.ts when hn_id is a calibration ID and a calibration_run is active.
 * Never deleted — accumulates across runs for longitudinal drift tracking.
 */
export async function writeCalibrationEval(
  db: D1Database,
  calibrationRun: number,
  hnId: number,
  lite: LiteEvalResponse,
  modelId: string,
  provider: string,
): Promise<void> {
  const agg = computeLiteAggregates(lite);
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO calibration_evals (
           calibration_run, hn_id, eval_model, eval_provider, prompt_mode, schema_version,
           hcb_editorial_mean, hcb_weighted_mean, hcb_classification,
           eq_score, so_score, td_score, et_valence, et_arousal, et_primary_tone
         ) VALUES (?, ?, ?, ?, 'lite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        calibrationRun, hnId, modelId, provider,
        lite.schema_version || 'lite-1.3',
        lite.evaluation.editorial,
        agg.weighted_mean,
        agg.classification,
        lite.eq_score ?? null,
        lite.so_score ?? null,
        lite.td_score ?? null,
        lite.valence ?? null,
        lite.arousal ?? null,
        lite.primary_tone ?? null,
      )
      .run();
  } catch (err) {
    console.error(`[eval-write] writeCalibrationEval failed for hn_id=${hnId}:`, err);
  }
}

// --- Lite eval write helpers ---

export async function writeLiteRaterEvalResult(
  db: D1Database,
  hnId: number,
  lite: LiteEvalResponse,
  modelId: string,
  provider: string,
  promptHash: string | null,
  methodologyHash: string | null,
  inputTokens: number,
  outputTokens: number,
  contentTruncationPct: number = 0,
  batchId: string | null = null,
): Promise<void> {
  // FK guard: bail if story doesn't exist (stale queue message)
  const exists = await db.prepare('SELECT 1 FROM stories WHERE hn_id = ?').bind(hnId).first();
  if (!exists) {
    throw new Error(`Story hn_id=${hnId} not found — skipping lite eval write (stale message)`);
  }

  const agg = computeLiteAggregates(lite);

  // Evidence counts from single evidence_strength value
  const evStr = lite.evaluation.evidence_strength?.toUpperCase() || 'M';
  const hcbEvidenceH = evStr === 'H' ? 1 : 0;
  const hcbEvidenceM = evStr === 'M' ? 1 : 0;
  const hcbEvidenceL = evStr === 'L' ? 1 : 0;

  // UPSERT rater_evals
  await db
    .prepare(
      `INSERT INTO rater_evals (
        hn_id, eval_model, eval_provider, eval_status, prompt_mode,
        hcb_weighted_mean, hcb_classification, hcb_json,
        hcb_signal_sections, hcb_nd_count,
        hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
        eval_prompt_hash, methodology_hash,
        content_type, schema_version,
        hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
        fw_ratio, fw_observable_count, fw_inference_count,
        hcb_editorial_mean, hcb_structural_mean, hcb_setl, hcb_confidence,
        eq_score, so_score, et_primary_tone, et_valence, et_arousal,
        sr_score, pt_flag_count, pt_score, td_score,
        input_tokens, output_tokens, content_truncation_pct,
        eval_batch_id, reasoning, evaluated_at
      ) VALUES (
        ?, ?, ?, 'done', 'lite',
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, datetime('now')
      )
      ON CONFLICT(hn_id, eval_model) DO UPDATE SET
        eval_status = 'done',
        eval_error = NULL,
        prompt_mode = 'lite',
        hcb_weighted_mean = excluded.hcb_weighted_mean,
        hcb_classification = excluded.hcb_classification,
        hcb_json = excluded.hcb_json,
        hcb_signal_sections = excluded.hcb_signal_sections,
        hcb_nd_count = excluded.hcb_nd_count,
        hcb_evidence_h = excluded.hcb_evidence_h,
        hcb_evidence_m = excluded.hcb_evidence_m,
        hcb_evidence_l = excluded.hcb_evidence_l,
        eval_prompt_hash = excluded.eval_prompt_hash,
        methodology_hash = excluded.methodology_hash,
        content_type = excluded.content_type,
        schema_version = excluded.schema_version,
        hcb_theme_tag = excluded.hcb_theme_tag,
        hcb_sentiment_tag = excluded.hcb_sentiment_tag,
        hcb_executive_summary = excluded.hcb_executive_summary,
        fw_ratio = excluded.fw_ratio,
        fw_observable_count = excluded.fw_observable_count,
        fw_inference_count = excluded.fw_inference_count,
        hcb_editorial_mean = excluded.hcb_editorial_mean,
        hcb_structural_mean = excluded.hcb_structural_mean,
        hcb_setl = excluded.hcb_setl,
        hcb_confidence = excluded.hcb_confidence,
        eq_score = excluded.eq_score,
        so_score = excluded.so_score,
        et_primary_tone = excluded.et_primary_tone,
        et_valence = excluded.et_valence,
        et_arousal = excluded.et_arousal,
        sr_score = excluded.sr_score,
        pt_flag_count = excluded.pt_flag_count,
        pt_score = excluded.pt_score,
        td_score = excluded.td_score,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        content_truncation_pct = excluded.content_truncation_pct,
        eval_batch_id = excluded.eval_batch_id,
        reasoning = excluded.reasoning,
        evaluated_at = excluded.evaluated_at`
    )
    .bind(
      hnId, modelId, provider,
      agg.weighted_mean,
      agg.classification,
      JSON.stringify(lite),
      0, // hcb_signal_sections (no per-section data)
      0, // hcb_nd_count
      hcbEvidenceH, hcbEvidenceM, hcbEvidenceL,
      promptHash, methodologyHash,
      lite.evaluation.content_type || 'MX',
      lite.schema_version || 'lite-1.3',
      lite.theme_tag || null,
      lite.sentiment_tag || null,
      lite.short_description || null,
      null, // fw_ratio
      0,    // fw_observable_count
      0,    // fw_inference_count
      lite.evaluation.editorial ?? null,   // hcb_editorial_mean
      null,                                // hcb_structural_mean (editorial-only in lite mode)
      0,                                   // hcb_setl (no structural channel)
      lite.evaluation.confidence ?? null,  // hcb_confidence
      lite.eq_score ?? null,        // EQ
      lite.so_score ?? null,        // SO
      lite.primary_tone ?? null,    // tone
      lite.valence ?? null,         // VA (lite-1.3+)
      lite.arousal ?? null,         // AR (lite-1.3+)
      null,                          // SR (not in lite)
      null,                          // PT flag count (not in lite — null, not 0)
      null,                          // PT score (not in lite)
      lite.td_score ?? null,        // TD
      inputTokens, outputTokens, contentTruncationPct,
      batchId,
      lite.reasoning ?? null,       // reasoning (lite-1.4+): pre-commit classification string
    )
    .run();

  // COALESCE fill-in: write lite signals to stories where full eval hasn't set them yet.
  // Lite evals do NOT promote eval_status — stories stay pending/queued until a full eval
  // calls writeEvalResult(). EvalCard.hasEval checks scores directly (not eval_status),
  // so lite-filled stories still display in the feed with editorial scores + [L] icon.
  await db.prepare(
    `UPDATE stories SET
       eq_score = COALESCE(eq_score, ?),
       so_score = COALESCE(so_score, ?),
       td_score = COALESCE(td_score, ?),
       et_primary_tone = COALESCE(et_primary_tone, ?),
       et_valence = COALESCE(et_valence, ?),
       et_arousal = COALESCE(et_arousal, ?),
       hcb_editorial_mean = COALESCE(hcb_editorial_mean, ?),
       hcb_theme_tag = COALESCE(hcb_theme_tag, ?),
       hcb_sentiment_tag = COALESCE(hcb_sentiment_tag, ?),
       hcb_executive_summary = COALESCE(hcb_executive_summary, ?)
     WHERE hn_id = ?`
  ).bind(
    lite.eq_score ?? null,   // EQ
    lite.so_score ?? null,   // SO
    lite.td_score ?? null,   // TD
    lite.primary_tone ?? null, // tone
    lite.valence ?? null,    // VA
    lite.arousal ?? null,    // AR
    lite.evaluation.editorial ?? null,  // hcb_editorial_mean
    lite.theme_tag || null,  // hcb_theme_tag
    lite.sentiment_tag || null, // hcb_sentiment_tag
    lite.short_description || null, // hcb_executive_summary
    hnId,
  ).run().catch(() => {});

  // Refresh domain aggregate now that stories has updated signals
  if (lite.evaluation.domain) {
    await refreshDomainAggregate(db, lite.evaluation.domain);
  }

  // Refresh user aggregate (lite evals contribute to lite_evaluated + avg_editorial_lite)
  const liteAuthorRow = await db
    .prepare('SELECT hn_by FROM stories WHERE hn_id = ?')
    .bind(hnId)
    .first<{ hn_by: string | null }>();
  if (liteAuthorRow?.hn_by) await refreshUserAggregate(db, liteAuthorRow.hn_by);

  // No rater_scores or rater_witness writes for lite evals

  // Update ensemble consensus score (best-effort, non-blocking)
  await updateConsensusScore(db, hnId);

  // Write to eval_history
  await db
    .prepare(
      `INSERT INTO eval_history (hn_id, eval_model, hcb_weighted_mean, hcb_classification, hcb_json, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      hnId, modelId,
      agg.weighted_mean,
      agg.classification,
      JSON.stringify(lite),
      inputTokens, outputTokens,
    )
    .run();
}
