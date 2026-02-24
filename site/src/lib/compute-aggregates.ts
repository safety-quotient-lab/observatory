/**
 * Deterministic aggregate computation — moved from Claude output to Worker CPU.
 * Claude outputs only per-article scores; this module computes all aggregate metrics.
 */

import { CLASSIFICATIONS } from './types';
import type { EvalScore } from './shared-eval';

const EVIDENCE_WEIGHTS: Record<string, number> = {
  H: 1.0,
  M: 0.7,
  L: 0.4,
};

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
  const volatilityLabel = stdDev < 0.15 ? 'Low' : stdDev < 0.35 ? 'Medium' : 'High';

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
  for (const c of CLASSIFICATIONS) {
    if (score >= c.min && score <= c.max) {
      return c.label;
    }
  }
  // Edge case: score is exactly between ranges (e.g., -0.1 overlaps neutral and mild-negative)
  // CLASSIFICATIONS is ordered from most positive to most negative, first match wins
  return 'Neutral';
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
