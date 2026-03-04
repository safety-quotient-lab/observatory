// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic aggregate computation — moved from Claude output to Worker CPU.
 * Claude outputs only per-article scores; this module computes all aggregate metrics.
 */

import { CLASSIFICATIONS } from './types';
import type { EvalScore, SlimEvalScore } from './shared-eval';

/** Evidence weights for weighted_mean: higher spread rewards strong evidence more in the score itself. */
export const EVIDENCE_WEIGHTS_MEAN: Record<string, number> = { H: 1.0, M: 0.7, L: 0.4 };

/** Evidence weights for confidence: steeper drop-off reflects how much we trust the assessment. */
export const EVIDENCE_WEIGHTS_CONFIDENCE: Record<string, number> = { H: 1.0, M: 0.6, L: 0.2 };

const EVIDENCE_WEIGHTS = EVIDENCE_WEIGHTS_MEAN;

export interface Aggregates {
  weighted_mean: number;
  unweighted_mean: number;
  max: { value: number; section: string };
  min: { value: number; section: string };
  negative_count: number;
  nd_count: number;
  signal_sections: number;
  evidence_profile: Record<string, number>;
  channel_balance: Record<string, number>;
  directionality_profile: Record<string, number>;
  volatility: { value: number; label: string };
  classification: string;
}

export function computeAggregates(
  scores: EvalScore[],
  channelWeights: { editorial: number; structural: number },
): Aggregates {
  // Separate scored vs ND sections
  const scored = scores.filter(s => s.final !== null && s.final !== undefined);
  const ndCount = scores.length - scored.length;

  // Evidence profile
  const evidenceProfile: Record<string, number> = { H: 0, M: 0, L: 0, ND: 0 };
  for (const s of scores) {
    const ev = s.evidence?.toUpperCase() ?? 'ND';
    if (ev in evidenceProfile) {
      evidenceProfile[ev]++;
    } else {
      evidenceProfile['ND']++;
    }
  }

  // Channel balance
  const channelBalance: Record<string, number> = { E_only: 0, S_only: 0, both: 0 };
  for (const s of scored) {
    const hasE = s.editorial !== null && s.editorial !== undefined;
    const hasS = s.structural !== null && s.structural !== undefined;
    if (hasE && hasS) channelBalance['both']++;
    else if (hasE) channelBalance['E_only']++;
    else if (hasS) channelBalance['S_only']++;
  }

  // Directionality profile
  const directionalityProfile: Record<string, number> = { A: 0, P: 0, F: 0, C: 0 };
  for (const s of scores) {
    if (s.directionality) {
      for (const d of s.directionality) {
        const key = d.toUpperCase();
        if (key in directionalityProfile) {
          directionalityProfile[key]++;
        }
      }
    }
  }

  // If no scored sections, return zeroed aggregates
  if (scored.length === 0) {
    return {
      weighted_mean: 0,
      unweighted_mean: 0,
      max: { value: 0, section: 'N/A' },
      min: { value: 0, section: 'N/A' },
      negative_count: 0,
      nd_count: ndCount,
      signal_sections: 0,
      evidence_profile: evidenceProfile,
      channel_balance: channelBalance,
      directionality_profile: directionalityProfile,
      volatility: { value: 0, label: 'Low' },
      classification: 'Neutral',
    };
  }

  // Unweighted mean (simple average of final scores)
  const unweightedSum = scored.reduce((sum, s) => sum + s.final!, 0);
  const unweightedMean = round(unweightedSum / scored.length);

  // Weighted mean (weight by evidence strength)
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of scored) {
    const ev = s.evidence?.toUpperCase() ?? 'L';
    const w = EVIDENCE_WEIGHTS[ev] ?? 0.4;
    weightedSum += s.final! * w;
    totalWeight += w;
  }
  const weightedMean = totalWeight > 0 ? round(weightedSum / totalWeight) : 0;

  // Max and min
  let maxScore = scored[0];
  let minScore = scored[0];
  for (const s of scored) {
    if (s.final! > maxScore.final!) maxScore = s;
    if (s.final! < minScore.final!) minScore = s;
  }

  // Counts
  const negativeCount = scored.filter(s => s.final! < 0).length;

  // Volatility (std dev of non-ND final scores)
  const mean = unweightedSum / scored.length;
  const variance = scored.reduce((sum, s) => sum + Math.pow(s.final! - mean, 2), 0) / scored.length;
  const stdDev = round(Math.sqrt(variance));
  const volatilityLabel = stdDev < 0.10 ? 'Low' : stdDev < 0.25 ? 'Medium' : 'High';

  // Classification from weighted mean
  const classification = classifyScore(weightedMean);

  return {
    weighted_mean: weightedMean,
    unweighted_mean: unweightedMean,
    max: { value: maxScore.final!, section: maxScore.section },
    min: { value: minScore.final!, section: minScore.section },
    negative_count: negativeCount,
    nd_count: ndCount,
    signal_sections: scored.length,
    evidence_profile: evidenceProfile,
    channel_balance: channelBalance,
    directionality_profile: directionalityProfile,
    volatility: { value: stdDev, label: volatilityLabel },
    classification,
  };
}

function classifyScore(score: number): string {
  // Clamp edge cases before range scan
  if (score >= 1.0) return 'Strong positive';
  if (score <= -1.0) return 'Strong negative';
  // Use exclusive upper bound so contiguous ranges don't overlap
  for (const c of CLASSIFICATIONS) {
    if (score >= c.min && score < c.max) {
      return c.label;
    }
  }
  return 'Neutral';
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// --- Fair Witness helpers ---

export function computeWitnessRatio(facts?: string[], inferences?: string[]): number | null {
  const factCount = facts?.length ?? 0;
  const inferenceCount = inferences?.length ?? 0;
  const total = factCount + inferenceCount;
  if (total === 0) return null;
  return round(factCount / total);
}

export interface FairWitnessAggregates {
  fw_ratio: number | null;
  fw_observable_count: number;
  fw_inference_count: number;
}

// --- Derived score field computation ---
// Computes combined, context_modifier, final from raw E/S scores + DCP elements.
// Also maps editorial_note/structural_note to backwards-compat note field.

export interface DcpElement {
  modifier: number | null;
  affects: string[];
  note: string;
}

export function computeDerivedScoreFields(
  scores: (SlimEvalScore | EvalScore)[],
  channelWeights: { editorial: number; structural: number },
  dcpElements: Record<string, DcpElement> | null,
): EvalScore[] {
  // Validate channel weights: must sum ≈ 1.0 and both be positive
  let weights = channelWeights;
  const wSum = channelWeights.editorial + channelWeights.structural;
  if (channelWeights.editorial <= 0 || channelWeights.structural <= 0 || Math.abs(wSum - 1.0) > 0.01) {
    weights = { editorial: 0.65, structural: 0.35 };
  }

  return scores.map(s => {
    const eScore = s.editorial;
    const sScore = s.structural;

    // Combined = weighted average of E and S channels
    let combined: number | null = null;
    if (eScore !== null && sScore !== null) {
      combined = round(weights.editorial * eScore + weights.structural * sScore);
    } else if (eScore !== null) {
      combined = eScore;
    } else if (sScore !== null) {
      combined = sScore;
    }

    // Context modifier = sum of matching DCP element modifiers for this section
    let contextModifier: number | null = null;
    if (dcpElements && combined !== null) {
      let modSum = 0;
      for (const el of Object.values(dcpElements)) {
        if (el.modifier !== null && el.affects?.includes(s.section)) {
          modSum += el.modifier;
        }
      }
      // Cap at +/- 0.30
      contextModifier = round(Math.max(-0.30, Math.min(0.30, modSum)));
    }

    // Final = combined + context_modifier, clamped [-1.0, +1.0]
    let final_: number | null = null;
    if (combined !== null) {
      const mod = contextModifier ?? 0;
      final_ = round(Math.max(-1.0, Math.min(1.0, combined + mod)));
    }

    // Note fallback for backwards compat
    const editorialNote = (s as SlimEvalScore).editorial_note || '';
    const structuralNote = (s as SlimEvalScore).structural_note || '';
    const note = (s as EvalScore).note || editorialNote || structuralNote || '';

    return {
      section: s.section,
      editorial: eScore,
      structural: sScore,
      combined,
      context_modifier: contextModifier,
      final: final_,
      directionality: s.directionality || [],
      evidence: s.evidence,
      note,
      editorial_note: editorialNote,
      structural_note: structuralNote,
      witness_facts: s.witness_facts,
      witness_inferences: s.witness_inferences,
    };
  });
}

// --- SETL (Structural-Editorial Tension Level) ---

export function computeSetl(scores: Array<{ editorial: number | null; structural: number | null }>): number | null {
  const vals: number[] = [];
  for (const s of scores) {
    if (s.editorial !== null && s.structural !== null && (Math.abs(s.editorial) > 0 || Math.abs(s.structural) > 0)) {
      const diff = Math.abs(s.editorial - s.structural);
      const maxAbs = Math.max(Math.abs(s.editorial), Math.abs(s.structural));
      const mag = Math.sqrt(diff * maxAbs);
      vals.push(s.editorial >= s.structural ? mag : -mag);
    }
  }
  if (vals.length === 0) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return round(Math.max(-1.0, Math.min(1.0, avg)));
}

// --- Story-level aggregate helpers ---

export interface StoryLevelAggregates {
  hcb_editorial_mean: number | null;
  hcb_structural_mean: number | null;
  hcb_setl: number | null;
  hcb_confidence: number | null;
}

export function computeStoryLevelAggregates(scores: EvalScore[]): StoryLevelAggregates {
  const editorials = scores.filter(s => s.editorial !== null).map(s => s.editorial!);
  const structurals = scores.filter(s => s.structural !== null).map(s => s.structural!);

  const hcb_editorial_mean = editorials.length > 0
    ? round(editorials.reduce((a, b) => a + b, 0) / editorials.length)
    : null;
  const hcb_structural_mean = structurals.length > 0
    ? round(structurals.reduce((a, b) => a + b, 0) / structurals.length)
    : null;

  const hcb_setl = computeSetl(scores);

  // Confidence: evidence-weighted coverage
  const scored = scores.filter(s => s.final !== null);
  const total = scores.length;
  let hcb_confidence: number | null = null;
  if (total > 0) {
    let weightedSum = 0;
    for (const s of scores) {
      const ev = s.evidence?.toUpperCase();
      if (ev && ev in EVIDENCE_WEIGHTS_CONFIDENCE) weightedSum += EVIDENCE_WEIGHTS_CONFIDENCE[ev];
      // ND contributes 0
    }
    hcb_confidence = round(weightedSum / total);
  }

  return { hcb_editorial_mean, hcb_structural_mean, hcb_setl, hcb_confidence };
}

export function computeFairWitnessAggregates(scores: EvalScore[]): FairWitnessAggregates {
  let totalFacts = 0;
  let totalInferences = 0;
  for (const s of scores) {
    if (s.witness_facts) totalFacts += s.witness_facts.length;
    if (s.witness_inferences) totalInferences += s.witness_inferences.length;
  }
  const total = totalFacts + totalInferences;
  return {
    fw_ratio: total > 0 ? round(totalFacts / total) : null,
    fw_observable_count: totalFacts,
    fw_inference_count: totalInferences,
  };
}

// --- Rights Entanglement Map (REM) ---

export interface RemCluster {
  provisions: string[];      // UDHR article IDs e.g. "Art12"
  avgInternalCorr: number;   // mean pairwise r within cluster
  representative: string;    // provision with highest mean r to cluster members
}

/**
 * Single-linkage hierarchical clustering on a provision correlation Map.
 * Merges two provisions into the same cluster when pearson_r >= threshold.
 * Returns clusters sorted by size descending.
 */
export function computeRemClusters(
  correlation: Map<string, number>,
  threshold = 0.35
): RemCluster[] {
  // Collect all provision IDs from the correlation keys
  const provisions = new Set<string>();
  for (const key of correlation.keys()) {
    const [a, b] = key.split('|');
    provisions.add(a);
    provisions.add(b);
  }
  if (provisions.size === 0) return [];

  // Union-Find
  const parent = new Map<string, string>();
  for (const p of provisions) parent.set(p, p);

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  // Build sorted edge list (descending r) and merge above threshold
  const edges: Array<{ a: string; b: string; r: number }> = [];
  for (const [key, r] of correlation) {
    const [a, b] = key.split('|');
    if (a !== b) edges.push({ a, b, r });
  }
  edges.sort((x, y) => y.r - x.r);

  for (const { a, b, r } of edges) {
    if (r < threshold) break;
    union(a, b);
  }

  // Group provisions by root
  const groups = new Map<string, string[]>();
  for (const p of provisions) {
    const root = find(p);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(p);
  }

  // Compute cluster stats
  const clusters: RemCluster[] = [];
  for (const members of groups.values()) {
    let corrSum = 0;
    let corrCount = 0;
    const memberCorrs = new Map<string, number>(); // provision → sum of r to cluster members
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${members[i]}|${members[j]}`;
        const altKey = `${members[j]}|${members[i]}`;
        const r = correlation.get(key) ?? correlation.get(altKey) ?? 0;
        corrSum += r;
        corrCount++;
        memberCorrs.set(members[i], (memberCorrs.get(members[i]) ?? 0) + r);
        memberCorrs.set(members[j], (memberCorrs.get(members[j]) ?? 0) + r);
      }
    }
    const avgInternalCorr = corrCount > 0 ? round(corrSum / corrCount) : 0;

    // Representative: highest mean r to other cluster members
    let representative = members[0];
    let maxCorr = -Infinity;
    for (const [p, sum] of memberCorrs) {
      if (sum > maxCorr) { maxCorr = sum; representative = p; }
    }

    clusters.push({ provisions: members.sort(), avgInternalCorr, representative });
  }

  return clusters.sort((a, b) => b.provisions.length - a.provisions.length);
}
