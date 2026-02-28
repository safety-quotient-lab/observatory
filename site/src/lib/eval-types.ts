/**
 * Shared HRCB evaluation types and constants.
 */

import { CLASSIFICATIONS } from './types';

// Re-export CLASSIFICATIONS so eval-parse.ts can access it
export { CLASSIFICATIONS };

export const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

// --- Supplementary Signal Interfaces ---

export interface EpistemicQuality {
  source_quality: number;
  evidence_reasoning: number;
  uncertainty_handling: number;
  purpose_transparency: number;
  claim_density: 'low' | 'medium' | 'high';
  eq_score: number;
}

export interface PropagandaFlag {
  technique: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SolutionOrientation {
  framing: 'problem_only' | 'mixed' | 'solution_oriented';
  reader_agency: number;
  so_score: number;
}

export interface EmotionalTone {
  primary_tone: string;
  valence: number;
  arousal: number;
  dominance: number;
}

export interface StakeholderRepresentation {
  perspective_count: number;
  voice_balance: number;
  who_speaks: string[];
  who_is_spoken_about: string[];
  sr_score: number;
}

export interface TemporalFraming {
  primary_focus: 'retrospective' | 'present' | 'prospective' | 'mixed';
  time_horizon: string;
}

export interface GeographicScope {
  scope: 'local' | 'national' | 'regional' | 'global' | 'unspecified';
  regions_mentioned: string[];
}

export interface ComplexityLevel {
  reading_level: 'accessible' | 'moderate' | 'technical' | 'expert';
  jargon_density: 'low' | 'medium' | 'high';
  assumed_knowledge: 'none' | 'general' | 'domain_specific' | 'expert';
}

export interface TransparencyDisclosure {
  author_identified: boolean;
  conflicts_disclosed: boolean | null;
  funding_disclosed: boolean | null;
  td_score: number;
}

// --- Core Evaluation Interfaces ---

export interface EvalScore {
  section: string;
  editorial: number | null;
  structural: number | null;
  combined: number | null;
  context_modifier: number | null;
  final: number | null;
  directionality: string[];
  evidence: string | null;
  note: string;
  editorial_note?: string;
  structural_note?: string;
  witness_facts?: string[];
  witness_inferences?: string[];
}

export interface SlimEvalScore {
  section: string;
  editorial: number | null;
  structural: number | null;
  directionality: string[];
  evidence: string | null;
  editorial_note: string;
  structural_note: string;
  note?: string; // backwards compat
  witness_facts?: string[];
  witness_inferences?: string[];
}

export interface EvalResult {
  schema_version: string;
  evaluation: {
    url: string;
    domain: string;
    content_type: { primary: string; secondary: string[] };
    channel_weights: { editorial: number; structural: number };
    eval_depth: string;
    date: string;
    methodology: string;
    off_domain: boolean;
    external_evidence: boolean;
    operator: string;
  };
  domain_context_profile: {
    domain: string;
    eval_date: string;
    elements: Record<string, unknown>;
  };
  scores: EvalScore[];
  theme_tag?: string;
  sentiment_tag?: string;
  executive_summary?: string;
  epistemic_quality?: EpistemicQuality;
  propaganda_flags?: PropagandaFlag[];
  solution_orientation?: SolutionOrientation;
  emotional_tone?: EmotionalTone;
  stakeholder_representation?: StakeholderRepresentation;
  temporal_framing?: TemporalFraming;
  geographic_scope?: GeographicScope;
  complexity_level?: ComplexityLevel;
  transparency_disclosure?: TransparencyDisclosure;
  aggregates: {
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
  };
  l2_scores?: unknown[];
  adversarial_gap?: unknown;
}

export interface SlimEvalResponse {
  schema_version: string;
  evaluation: {
    url: string;
    domain: string;
    content_type: { primary: string; secondary: string[] };
    channel_weights: { editorial: number; structural: number };
    eval_depth: string;
    date: string;
    methodology: string;
    off_domain: boolean;
    external_evidence: boolean;
    operator: string;
  };
  domain_context_profile: {
    domain: string;
    eval_date: string;
    elements: Record<string, unknown>;
  } | string;
  scores: EvalScore[];
  theme_tag?: string;
  sentiment_tag?: string;
  executive_summary?: string;
  epistemic_quality?: EpistemicQuality;
  propaganda_flags?: PropagandaFlag[];
  solution_orientation?: SolutionOrientation;
  emotional_tone?: EmotionalTone;
  stakeholder_representation?: StakeholderRepresentation;
  temporal_framing?: TemporalFraming;
  geographic_scope?: GeographicScope;
  complexity_level?: ComplexityLevel;
  transparency_disclosure?: TransparencyDisclosure;
  l2_scores?: unknown[];
  adversarial_gap?: unknown;
}

export interface LiteEvalResponse {
  schema_version: string;
  reasoning?: string | null;
  evaluation: {
    url: string;
    domain: string;
    content_type: string;
    editorial: number | null;
    evidence_strength: string;
    confidence: number;
  };
  theme_tag: string;
  sentiment_tag: string;
  short_description: string;
  eq_score: number | null;
  so_score: number | null;
  td_score: number | null;
  valence: number | null;
  arousal: number | null;
  primary_tone: string | null;
}

export interface RaterEval {
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
  eval_prompt_hash: string | null;
  methodology_hash: string | null;
  content_type: string | null;
  schema_version: string | null;
  hcb_theme_tag: string | null;
  hcb_sentiment_tag: string | null;
  hcb_executive_summary: string | null;
  fw_ratio: number | null;
  fw_observable_count: number;
  fw_inference_count: number;
  hcb_editorial_mean: number | null;
  hcb_structural_mean: number | null;
  hcb_setl: number | null;
  hcb_confidence: number | null;
  eq_score: number | null;
  so_score: number | null;
  et_primary_tone: string | null;
  et_valence: number | null;
  sr_score: number | null;
  pt_flag_count: number;
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
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  repairs: string[];
}
