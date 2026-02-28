/**
 * Evaluation result DB write helpers.
 *
 * Pure extraction from shared-eval.ts — no logic changes.
 */

import { computeSetl } from './compute-aggregates';
import { ALL_SECTIONS, type EvalResult, type LiteEvalResponse } from './eval-types';
import { computeLiteAggregates } from './eval-parse';
import { PRIMARY_MODEL_ID } from './models';
import { logEvent } from './events';

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

  // Legacy scores/fair_witness tables removed — all per-section data
  // lives in rater_scores/rater_witness (written by writeRaterEvalResult)

  // Refresh materialized domain aggregate (best-effort)
  const domain = result.evaluation?.domain;
  if (domain) await refreshDomainAggregate(db, domain);

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
        `SELECT eval_model, hcb_weighted_mean, hcb_editorial_mean, prompt_mode, content_truncation_pct
         FROM rater_evals
         WHERE hn_id = ? AND eval_status = 'done'
           AND (hcb_weighted_mean IS NOT NULL OR hcb_editorial_mean IS NOT NULL)`
      )
      .bind(hnId)
      .all<{ eval_model: string; hcb_weighted_mean: number | null; hcb_editorial_mean: number | null; prompt_mode: string | null; content_truncation_pct: number | null }>();

    if (results.length < 2) return;

    let weightedSum = 0;
    let totalWeight = 0;
    const scores: number[] = [];

    for (const r of results) {
      const score = r.hcb_weighted_mean ?? r.hcb_editorial_mean;
      if (score === null) continue;
      const baseWeight = (r.prompt_mode === 'lite' || r.prompt_mode === 'light') ? 0.5 : 1.0;
      const truncPct = r.content_truncation_pct ?? 0;
      const weight = baseWeight * (1 - truncPct * 0.5);
      weightedSum += score * weight;
      totalWeight += weight;
      scores.push(score);
    }

    if (totalWeight === 0 || scores.length < 2) return;

    const consensusScore = weightedSum / totalWeight;
    const spread = Math.max(...scores) - Math.min(...scores);

    await db
      .prepare(
        `UPDATE stories SET consensus_score=?, consensus_model_count=?,
         consensus_spread=?, consensus_updated_at=datetime('now') WHERE hn_id=?`
      )
      .bind(consensusScore, results.length, spread, hnId)
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
           avg_eq, avg_so, avg_sr, avg_td, avg_pt_count,
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
           AVG(CASE WHEN eval_status = 'done' THEN pt_flag_count END),
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

export async function refreshDailySectionStats(
  db: D1Database,
  scores: Array<{ section: string; final: number | null }>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const stmts: D1PreparedStatement[] = [];
  for (const score of scores) {
    if (score.final === null) continue;
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
        eq_score, so_score, et_primary_tone, et_valence, et_arousal,
        sr_score, pt_flag_count, td_score,
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
        ?, ?, ?,
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

  // Refresh materialized domain aggregate (skip if writeEvalResult already did it above)
  const domain = result.evaluation?.domain;
  if (!promoted && domain) await refreshDomainAggregate(db, domain);
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
        sr_score, pt_flag_count, td_score,
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
        ?, ?, ?,
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
      null,                          // PT (not in lite — null, not 0)
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
