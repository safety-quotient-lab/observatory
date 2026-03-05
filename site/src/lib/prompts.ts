// SPDX-License-Identifier: Apache-2.0
//
// Prompt assembly for HRCB evaluation.
// This file composes the methodology content (CC BY-SA 4.0, in methodology-content.ts)
// with variant-specific output schemas to produce the final system prompts.

import { METHODOLOGY_PREAMBLE, METHODOLOGY_LITE, METHODOLOGY_LITE_V2, buildLiteV2SystemPrompt, PSQ_DIM_VARIANTS } from './methodology-content.js';

/**
 * Output schema for the full prompt variant (includes aggregates).
 * Used by evaluate.ts (trigger endpoint) for backward compatibility.
 */
const OUTPUT_SCHEMA_FULL = `## OUTPUT FORMAT

You MUST output a single JSON object (no markdown fences, no explanation before or after). Section names in the scores array MUST use the full word "Article" (e.g. "Article 1", "Article 19"), NOT abbreviated "Art." Do NOT include "combined", "context_modifier", or "final" in scores — these are computed externally. If a cached DCP was provided in the user message, output "domain_context_profile": "cached" instead of the full object. The JSON must follow this exact schema:

{
  "schema_version": "3.7",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": { "primary": "<CODE>", "secondary": [] },
    "channel_weights": { "editorial": <w_E>, "structural": <w_S> },
    "eval_depth": "STANDARD",
    "date": "<YYYY-MM-DD>",
    "methodology": "v3.7",
    "off_domain": false,
    "external_evidence": false,
    "operator": "claude-haiku-4-5-20251001"
  },
  "domain_context_profile": {
    "domain": "<domain>",
    "eval_date": "<YYYY-MM-DD>",
    "elements": {
      "privacy": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "tos": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "accessibility": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "mission": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "editorial_code": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "ownership": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "access_model": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "ad_tracking": { "modifier": <number|null>, "affects": [...], "note": "<text>" }
    }
  },
  "scores": [
    {
      "section": "Preamble",
      "editorial": <number|null>,
      "structural": <number|null>,
      "directionality": [...],
      "evidence": "<H|M|L|null>",
      "editorial_note": "<what the content says re: this provision>",
      "structural_note": "<what the site does re: this provision>",
      "witness_facts": ["<observable statement>", ...],
      "witness_inferences": ["<interpretive statement>", ...]
    }
    // ... 31 total rows (Preamble + Article 1-30)
  ],
  "theme_tag": "<concise theme label>",
  "sentiment_tag": "<Champions|Advocates|Acknowledges|Neutral|Neglects|Undermines|Hostile>",
  "executive_summary": "<2-3 sentence summary>",
  "epistemic_quality": {
    "source_quality": <0.0-1.0>,
    "evidence_reasoning": <0.0-1.0>,
    "uncertainty_handling": <0.0-1.0>,
    "purpose_transparency": <0.0-1.0>,
    "claim_density": "<low|medium|high>",
    "eq_score": <0.0-1.0>
  },
  "propaganda_flags": [
    { "technique": "<ptc18_name>", "evidence": "<text>" }
  ],
  "solution_orientation": {
    "framing": "<problem_only|mixed|solution_oriented>",
    "reader_agency": <0.0-1.0>,
    "so_score": <0.0-1.0>
  },
  "emotional_tone": {
    "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>",
    "valence": <-1.0 to +1.0>,
    "arousal": <0.0-1.0>,
    "dominance": <0.0-1.0>
  },
  "stakeholder_representation": {
    "perspective_count": <integer>,
    "voice_balance": <0.0-1.0>,
    "who_speaks": ["<category>", ...],
    "who_is_spoken_about": ["<category>", ...],
    "sr_score": <0.0-1.0>
  },
  "temporal_framing": {
    "primary_focus": "<retrospective|present|prospective|mixed>",
    "time_horizon": "<immediate|short_term|medium_term|long_term|historical|unspecified>"
  },
  "geographic_scope": {
    "scope": "<local|national|regional|global|unspecified>",
    "regions_mentioned": ["<region>", ...]
  },
  "complexity_level": {
    "reading_level": "<accessible|moderate|technical|expert>",
    "jargon_density": "<low|medium|high>",
    "assumed_knowledge": "<none|general|domain_specific|expert>"
  },
  "transparency_disclosure": {
    "author_identified": <boolean>,
    "conflicts_disclosed": <boolean|null>,
    "funding_disclosed": <boolean|null>,
    "td_score": <0.0-1.0>
  },
  "rights_tensions": [
    {
      "article_a": <int: UDHR article number of first right (0=Preamble, 1-30)>,
      "article_b": <int: UDHR article number of second right>,
      "label": "<one-sentence: what is in tension and how the content resolves it>"
    }
  ],
  "aggregates": {
    "weighted_mean": <number>,
    "unweighted_mean": <number>,
    "max": { "value": <number>, "section": "<section>" },
    "min": { "value": <number>, "section": "<section>" },
    "negative_count": <number>,
    "nd_count": <number>,
    "signal_sections": <number>,
    "evidence_profile": { "H": <n>, "M": <n>, "L": <n>, "ND": <n> },
    "channel_balance": { "E_only": <n>, "S_only": <n>, "both": <n> },
    "directionality_profile": { "A": <n>, "P": <n>, "F": <n>, "C": <n> },
    "volatility": { "value": <number>, "label": "<Low|Medium|High>" },
    "classification": "<classification>"
  }
}`;

/**
 * Output schema for the slim prompt variant (no aggregates — computed on CPU).
 * Used by queue-based consumer workers.
 */
const OUTPUT_SCHEMA_SLIM = `## OUTPUT FORMAT

You MUST output a single JSON object (no markdown fences, no explanation before or after). Section names in the scores array MUST use the full word "Article" (e.g. "Article 1", "Article 19"), NOT abbreviated "Art." Do NOT include an "aggregates" field — aggregates are computed externally. Do NOT include "combined", "context_modifier", or "final" in scores — these are computed externally. If a cached DCP was provided in the user message, output "domain_context_profile": "cached" instead of the full object. The JSON must follow this exact schema:

{
  "schema_version": "3.7",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": { "primary": "<CODE>", "secondary": [] },
    "channel_weights": { "editorial": <w_E>, "structural": <w_S> },
    "eval_depth": "STANDARD",
    "date": "<YYYY-MM-DD>",
    "methodology": "v3.7",
    "off_domain": false,
    "external_evidence": false,
    "operator": "claude-haiku-4-5-20251001"
  },
  "domain_context_profile": {
    "domain": "<domain>",
    "eval_date": "<YYYY-MM-DD>",
    "elements": {
      "privacy": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "tos": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "accessibility": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "mission": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "editorial_code": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "ownership": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "access_model": { "modifier": <number|null>, "affects": [...], "note": "<text>" },
      "ad_tracking": { "modifier": <number|null>, "affects": [...], "note": "<text>" }
    }
  },
  "scores": [
    {
      "section": "Preamble",
      "editorial": <number|null>,
      "structural": <number|null>,
      "directionality": [...],
      "evidence": "<H|M|L|null>",
      "editorial_note": "<what the content says re: this provision>",
      "structural_note": "<what the site does re: this provision>",
      "witness_facts": ["<observable statement>", ...],
      "witness_inferences": ["<interpretive statement>", ...]
    }
    // ... 31 total rows (Preamble + Article 1-30)
  ],
  "theme_tag": "<concise theme label>",
  "sentiment_tag": "<Champions|Advocates|Acknowledges|Neutral|Neglects|Undermines|Hostile>",
  "executive_summary": "<2-3 sentence summary>",
  "epistemic_quality": {
    "source_quality": <0.0-1.0>,
    "evidence_reasoning": <0.0-1.0>,
    "uncertainty_handling": <0.0-1.0>,
    "purpose_transparency": <0.0-1.0>,
    "claim_density": "<low|medium|high>",
    "eq_score": <0.0-1.0>
  },
  "propaganda_flags": [
    { "technique": "<ptc18_name>", "evidence": "<text>" }
  ],
  "solution_orientation": {
    "framing": "<problem_only|mixed|solution_oriented>",
    "reader_agency": <0.0-1.0>,
    "so_score": <0.0-1.0>
  },
  "emotional_tone": {
    "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>",
    "valence": <-1.0 to +1.0>,
    "arousal": <0.0-1.0>,
    "dominance": <0.0-1.0>
  },
  "stakeholder_representation": {
    "perspective_count": <integer>,
    "voice_balance": <0.0-1.0>,
    "who_speaks": ["<category>", ...],
    "who_is_spoken_about": ["<category>", ...],
    "sr_score": <0.0-1.0>
  },
  "temporal_framing": {
    "primary_focus": "<retrospective|present|prospective|mixed>",
    "time_horizon": "<immediate|short_term|medium_term|long_term|historical|unspecified>"
  },
  "geographic_scope": {
    "scope": "<local|national|regional|global|unspecified>",
    "regions_mentioned": ["<region>", ...]
  },
  "complexity_level": {
    "reading_level": "<accessible|moderate|technical|expert>",
    "jargon_density": "<low|medium|high>",
    "assumed_knowledge": "<none|general|domain_specific|expert>"
  },
  "transparency_disclosure": {
    "author_identified": <boolean>,
    "conflicts_disclosed": <boolean|null>,
    "funding_disclosed": <boolean|null>,
    "td_score": <0.0-1.0>
  },
  "rights_tensions": [
    {
      "article_a": <int: UDHR article number of first right (0=Preamble, 1-30)>,
      "article_b": <int: UDHR article number of second right>,
      "label": "<one-sentence: what is in tension and how the content resolves it>"
    }
  ]
}`;

/**
 * Output schema for the lite prompt variant.
 * lite-1.6: replaces structural (0-100 holistic) with 5 TQ binary indicators.
 * tq_score is computed from binaries by the validator; injected as structural proxy.
 */
const OUTPUT_SCHEMA_LITE = `Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-1.6",
  "reasoning": "<content type, editorial stance, and transparency indicators in max 15 words>",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": "<CODE>",
    "editorial": <0 to 100>,
    "tq_author": <0 or 1>,
    "tq_date": <0 or 1>,
    "tq_sources": <0 or 1>,
    "tq_corrections": <0 or 1>,
    "tq_conflicts": <0 or 1>,
    "evidence_strength": "<H|M|L>",
    "confidence": <0.0 to 1.0>
  },
  "theme_tag": "<2-4 word human rights theme>",
  "sentiment_tag": "<Champions|Advocates|Acknowledges|Neutral|Neglects|Undermines|Hostile>",
  "short_description": "<one sentence, max 20 words>",
  "eq_score": <0.0 to 1.0>,
  "so_score": <0.0 to 1.0>,
  "td_score": <0.0 to 1.0>,
  "valence": <-1.0 to +1.0>,
  "arousal": <0.0 to 1.0>,
  "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>"
}`;

/**
 * Full system prompt (original) — includes aggregates in output schema.
 * Used by evaluate.ts (trigger endpoint) for backward compatibility.
 */
export const METHODOLOGY_SYSTEM_PROMPT = `${METHODOLOGY_PREAMBLE}

${OUTPUT_SCHEMA_FULL}`;

/**
 * Slim system prompt for queue-based evaluation.
 * Same methodology but output schema omits "aggregates" — those are computed
 * deterministically on the Worker CPU via compute-aggregates.ts.
 */
export const METHODOLOGY_SYSTEM_PROMPT_SLIM = `${METHODOLOGY_PREAMBLE}

${OUTPUT_SCHEMA_SLIM}`;

/**
 * Lite system prompt for small/free models that can't produce full 31-section output.
 * lite-1.6: editorial (explicit discourse) + TQ binary indicators (structural proxy)
 * + basic metadata (~200-400 output tokens).
 * No per-article breakdown, no DCP, no Fair Witness evidence.
 */
export const METHODOLOGY_SYSTEM_PROMPT_LITE = `${METHODOLOGY_LITE}

${OUTPUT_SCHEMA_LITE}`;

/**
 * Build the output schema for lite v2 with the given PSQ dimensions.
 * Flexible dimensions record — scales from 1 to 10 dimensions without schema change.
 */
function buildOutputSchemaLiteV2(dims: string[]): string {
  const dimExamples = dims.map(d =>
    `    "${d}": {\n      "score": <integer 0-10>,\n      "confidence": <0.0 to 1.0>,\n      "rationale": "<1-2 sentences citing specific textual evidence>"\n    }`
  ).join(',\n');

  return `Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-2.0",
  "content_type": "<CODE>",
  "psq_dimensions": {
${dimExamples}
  },
  "tq_author": <0 or 1>,
  "tq_date": <0 or 1>,
  "tq_sources": <0 or 1>,
  "tq_corrections": <0 or 1>,
  "tq_conflicts": <0 or 1>,
  "executive_summary": "<one sentence, max 20 words>"
}`;
}

/**
 * Build a complete lite v2 system prompt with methodology + output schema for given dims.
 */
export function buildLiteV2Prompt(dims: string[]): string {
  return `${buildLiteV2SystemPrompt(dims)}\n\n${buildOutputSchemaLiteV2(dims)}`;
}

/**
 * Lite v2 system prompt — PSQ-based single-dimension (Phase A) + TQ.
 * Uses instrument-grounded scoring rubrics from PSQ project.
 */
export const METHODOLOGY_SYSTEM_PROMPT_LITE_V2 = buildLiteV2Prompt(['threat_exposure']);
