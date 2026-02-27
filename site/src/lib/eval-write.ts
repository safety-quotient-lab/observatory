/**
 * Evaluation result DB write helpers.
 *
 * Pure extraction from shared-eval.ts — no logic changes.
 */

import { computeSetl } from './compute-aggregates';
import { ALL_SECTIONS, type EvalResult, type LightEvalResponse } from './eval-types';
import { computeLightAggregates } from './eval-parse';
import { PRIMARY_MODEL_ID } from './models';

// Default eval model (same as shared-eval.ts)
const EVAL_MODEL = 'claude-haiku-4-5-20251001';

// --- DB write helpers ---

export async function writeEvalResult(
  db: D1Database,
  hnId: number,
  result: EvalResult,
  model: string = EVAL_MODEL,
  promptHash: string | null = null
): Promise<void> {
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
    if (ev === 'H') confWeightedSum += 1.0;
    else if (ev === 'M') confWeightedSum += 0.6;
    else if (ev === 'L') confWeightedSum += 0.2;
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

  const stmts = result.scores.map((score) => {
    const sortOrder = ALL_SECTIONS.indexOf(score.section);
    const editorialNote = score.editorial_note || '';
    const structuralNote = score.structural_note || '';
    const note = score.note || editorialNote || structuralNote || '';
    return db
      .prepare(
        `INSERT OR REPLACE INTO scores (hn_id, section, sort_order, final, editorial, structural, evidence, directionality, note, editorial_note, structural_note, combined, context_modifier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        hnId,
        score.section,
        sortOrder >= 0 ? sortOrder : 0,
        score.final,
        score.editorial,
        score.structural,
        score.evidence,
        JSON.stringify(score.directionality || []),
        note,
        editorialNote,
        structuralNote,
        score.combined ?? null,
        score.context_modifier ?? null
      );
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  // Write Fair Witness facts/inferences to normalized table
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
    // Clear previous FW data for this story
    await db
      .prepare(`DELETE FROM fair_witness WHERE hn_id = ?`)
      .bind(hnId)
      .run();

    // Insert in chunks of 100 (D1 batch limit)
    for (let i = 0; i < fwRows.length; i += 100) {
      const chunk = fwRows.slice(i, i + 100);
      const fwStmts = chunk.map((row) =>
        db
          .prepare(
            `INSERT INTO fair_witness (hn_id, section, fact_type, fact_text) VALUES (?, ?, ?, ?)`
          )
          .bind(hnId, row.section, row.factType, row.factText)
      );
      await db.batch(fwStmts);
    }
  }
}

export async function markFailed(db: D1Database, hnId: number, error: string): Promise<void> {
  await db
    .prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`)
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
      .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ?, gate_category = ?, gate_confidence = ? WHERE hn_id = ?`)
      .bind(reason, gateCategory, gateConfidence ?? null, hnId)
      .run();
  } else {
    await db
      .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ? WHERE hn_id = ?`)
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
): Promise<void> {
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

  // SETL + Confidence
  const hcbSetl = computeSetl(result.scores);
  let confWeightedSum = 0;
  const totalSections = result.scores.length;
  for (const s of result.scores) {
    const ev = s.evidence?.toUpperCase();
    if (ev === 'H') confWeightedSum += 1.0;
    else if (ev === 'M') confWeightedSum += 0.6;
    else if (ev === 'L') confWeightedSum += 0.2;
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
        eq_score, so_score, et_primary_tone, et_valence,
        sr_score, pt_flag_count, td_score,
        input_tokens, output_tokens,
        evaluated_at
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
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        datetime('now')
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
        sr_score = excluded.sr_score,
        pt_flag_count = excluded.pt_flag_count,
        td_score = excluded.td_score,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
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
      et?.primary_tone ?? null, et?.valence ?? null,
      sr?.sr_score ?? null,
      pt ? pt.length : 0,
      td?.td_score ?? null,
      inputTokens, outputTokens,
    )
    .run();

  // DELETE + INSERT rater_scores
  await db
    .prepare(`DELETE FROM rater_scores WHERE hn_id = ? AND eval_model = ?`)
    .bind(hnId, modelId)
    .run();

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
    for (let i = 0; i < scoreStmts.length; i += 100) {
      await db.batch(scoreStmts.slice(i, i + 100));
    }
  }

  // DELETE + INSERT rater_witness
  await db
    .prepare(`DELETE FROM rater_witness WHERE hn_id = ? AND eval_model = ?`)
    .bind(hnId, modelId)
    .run();

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
    for (let i = 0; i < fwRows.length; i += 100) {
      const chunk = fwRows.slice(i, i + 100);
      const fwStmts = chunk.map((row) =>
        db
          .prepare(
            `INSERT INTO rater_witness (hn_id, eval_model, section, fact_type, fact_text) VALUES (?, ?, ?, ?, ?)`
          )
          .bind(hnId, modelId, row.section, row.factType, row.factText)
      );
      await db.batch(fwStmts);
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

  // If this is the primary model, also write to stories/scores/fair_witness for backward compat
  if (modelId === PRIMARY_MODEL_ID) {
    await writeEvalResult(db, hnId, result, modelId, promptHash);
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

// --- Light eval write helpers ---

export async function writeLightRaterEvalResult(
  db: D1Database,
  hnId: number,
  light: LightEvalResponse,
  modelId: string,
  provider: string,
  promptHash: string | null,
  methodologyHash: string | null,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const agg = computeLightAggregates(light);

  // Evidence counts from single evidence_strength value
  const evStr = light.evaluation.evidence_strength?.toUpperCase() || 'M';
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
        eq_score, so_score, et_primary_tone, et_valence,
        sr_score, pt_flag_count, td_score,
        input_tokens, output_tokens,
        evaluated_at
      ) VALUES (
        ?, ?, ?, 'done', 'light',
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        datetime('now')
      )
      ON CONFLICT(hn_id, eval_model) DO UPDATE SET
        eval_status = 'done',
        eval_error = NULL,
        prompt_mode = 'light',
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
        sr_score = excluded.sr_score,
        pt_flag_count = excluded.pt_flag_count,
        td_score = excluded.td_score,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        evaluated_at = excluded.evaluated_at`
    )
    .bind(
      hnId, modelId, provider,
      agg.weighted_mean,
      agg.classification,
      JSON.stringify(light),
      0, // hcb_signal_sections (no per-section data)
      0, // hcb_nd_count
      hcbEvidenceH, hcbEvidenceM, hcbEvidenceL,
      promptHash, methodologyHash,
      light.evaluation.content_type || 'MX',
      light.schema_version || 'light-1.2',
      light.theme_tag || null,
      light.sentiment_tag || null,
      light.short_description || null,
      null, // fw_ratio
      0,    // fw_observable_count
      0,    // fw_inference_count
      light.evaluation.editorial,   // hcb_editorial_mean
      null,                         // hcb_structural_mean (editorial-only in light mode)
      0,                            // hcb_setl (no structural channel)
      light.evaluation.confidence,  // hcb_confidence
      light.eq_score ?? null,
      light.so_score ?? null,
      light.primary_tone ?? null,   // et_primary_tone
      null,                         // et_valence (not in light)
      null,                         // sr_score (not in light)
      0,                            // pt_flag_count (not in light)
      light.td_score ?? null,
      inputTokens, outputTokens,
    )
    .run();

  // No rater_scores or rater_witness writes for light evals

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
      JSON.stringify(light),
      inputTokens, outputTokens,
    )
    .run();
}
