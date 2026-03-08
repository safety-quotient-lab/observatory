// SPDX-License-Identifier: Apache-2.0
/**
 * External PSQ scoring client.
 * Calls the DistilBERT student model at psq.unratified.org/score.
 * 10-dimension validated instrument (held-out r=0.680).
 */

import { refreshDomainAggregate, refreshUserAggregate } from './eval-write';

const PSQ_ENDPOINT = 'https://psq.unratified.org/score';
const PSQ_HEALTH = 'https://psq.unratified.org/health';

export interface PsqDimension {
  dimension: string;
  score: number;
  raw_score: number;
  confidence: number;
  meets_threshold: boolean;
}

export interface PsqFactors {
  factors_2: Record<string, { score: number; confidence: number }>;
  factors_3: Record<string, { score: number; confidence: number }>;
  factors_5: Record<string, { score: number; confidence: number }>;
  g_psq: { score: number; confidence: number };
}

export interface ExternalPsqResult {
  psq_composite: number;    // 0-100
  dimensions: PsqDimension[];
  hierarchy: PsqFactors;
  elapsed_ms: number;
}

/**
 * Call the external PSQ endpoint. Returns null on any failure.
 */
export async function scoreExternalPsq(
  text: string,
  timeoutMs = 5000,
): Promise<ExternalPsqResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(PSQ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.error(`[psq-external] HTTP ${resp.status} from endpoint`);
      return null;
    }

    const data = await resp.json() as any;

    if (!data.scores?.psq_composite || !data.dimensions) {
      console.error('[psq-external] Unexpected response shape');
      return null;
    }

    return {
      psq_composite: data.scores.psq_composite.value,
      dimensions: data.dimensions,
      hierarchy: data.hierarchy || null,
      elapsed_ms: data.elapsed_ms || 0,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`[psq-external] Timeout after ${timeoutMs}ms`);
    } else {
      console.error(`[psq-external] Error: ${err}`);
    }
    return null;
  }
}

/**
 * Check PSQ endpoint health.
 */
export async function checkPsqHealth(): Promise<boolean> {
  try {
    const resp = await fetch(PSQ_HEALTH, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const data = await resp.json() as any;
    return data.ready === true;
  } catch {
    return false;
  }
}

/**
 * Write external PSQ result to stories table.
 * Maps 0-100 composite → 0-10 scale (matches existing psq_score convention).
 */
export async function writeExternalPsqScore(
  db: D1Database,
  hnId: number,
  result: ExternalPsqResult,
): Promise<void> {
  const psqScore = Math.round((result.psq_composite / 10) * 1000) / 1000; // 0-100 → 0-10
  const dimsJson = JSON.stringify(
    Object.fromEntries(result.dimensions.map(d => [d.dimension, d.score]))
  );
  const factorsJson = result.hierarchy ? JSON.stringify(result.hierarchy) : null;
  const gPsqConf = result.hierarchy?.g_psq?.confidence ?? 0.68; // fallback to held-out r

  // Write to psq_external table (canonical external PSQ store)
  await db.prepare(
    `INSERT INTO psq_external (hn_id, psq_score, psq_dimensions_json, psq_factors_json, psq_confidence, elapsed_ms)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(hn_id) DO UPDATE SET
       psq_score = excluded.psq_score,
       psq_dimensions_json = excluded.psq_dimensions_json,
       psq_factors_json = excluded.psq_factors_json,
       psq_confidence = excluded.psq_confidence,
       elapsed_ms = excluded.elapsed_ms,
       scored_at = datetime('now')`
  ).bind(hnId, psqScore, dimsJson, factorsJson, gPsqConf, result.elapsed_ms ?? null).run();

  // External PSQ scores stored in psq_external only (not mirrored to stories).
  // stories.psq_score is sourced from LLM PSQ consensus (updatePsqConsensus)
  // because external DistilBERT lacks score breadth (range 4.0-6.4, 86% in one bucket).
}
