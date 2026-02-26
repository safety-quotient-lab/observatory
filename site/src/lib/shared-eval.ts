/**
 * Shared HRCB evaluation primitives.
 * Imported by src/lib/evaluate.ts (trigger endpoint), functions/cron.ts, and functions/consumer.ts.
 */

import { errorSlugFromStatus, errorSlugFromException, ERROR_TYPES, CLASSIFICATIONS } from './types';
import { computeSetl } from './compute-aggregates';

// --- Constants ---

export const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

export const EVAL_MODEL = 'claude-haiku-4-5-20251001';

// --- Multi-Model Registry ---

export type ModelProvider = 'anthropic' | 'openrouter' | 'workers-ai';

export type PromptMode = 'full' | 'light';

export interface ModelDefinition {
  id: string;                    // DB identifier (eval_model column)
  display_name: string;          // UI label
  short_name: string;            // 3-char badge label
  provider: ModelProvider;
  api_model_id: string;          // sent to API
  is_free: boolean;              // free → auto-eval alongside primary
  enabled: boolean;
  max_tokens: number;
  supports_cache_control: boolean;
  supports_json_mode: boolean;
  prompt_mode: PromptMode;       // 'full' = 31-section eval, 'light' = aggregate-only
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    display_name: 'Haiku 4.5',
    short_name: 'Hku',
    provider: 'anthropic',
    api_model_id: 'claude-haiku-4-5-20251001',
    is_free: false,
    enabled: true,
    max_tokens: 10240,
    supports_cache_control: true,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  {
    id: 'deepseek-v3.2',
    display_name: 'DeepSeek V3.2',
    short_name: 'DS',
    provider: 'openrouter',
    api_model_id: 'deepseek/deepseek-v3.2-20251201',
    is_free: true,
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'trinity-large',
    display_name: 'Trinity Large',
    short_name: 'Tri',
    provider: 'openrouter',
    api_model_id: 'arcee-ai/trinity-large-preview:free',
    is_free: true,
    enabled: false, // disabled: 77% failure rate
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'nemotron-nano-30b',
    display_name: 'Nemotron Nano 30B',
    short_name: 'Nem',
    provider: 'openrouter',
    api_model_id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    is_free: true,
    enabled: true,   // re-enabled with light prompt mode (97% fail on full)
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'light',
  },
  {
    id: 'step-3.5-flash',
    display_name: 'Step 3.5 Flash',
    short_name: 'Stp',
    provider: 'openrouter',
    api_model_id: 'stepfun/step-3.5-flash:free',
    is_free: true,
    enabled: false,  // disabled: returns empty responses, 100% failure rate
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  {
    id: 'qwen3-next-80b',
    display_name: 'Qwen3 Next 80B',
    short_name: 'Qwn',
    provider: 'openrouter',
    api_model_id: 'qwen/qwen3-next-80b-a3b-instruct:free',
    is_free: true,
    enabled: false, // disabled: conserving free tier quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'llama-3.3-70b',
    display_name: 'Llama 3.3 70B',
    short_name: 'Lla',
    provider: 'openrouter',
    api_model_id: 'meta-llama/llama-3.3-70b-instruct:free',
    is_free: true,
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'mistral-small-3.1',
    display_name: 'Mistral Small 3.1',
    short_name: 'Mis',
    provider: 'openrouter',
    api_model_id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    is_free: true,
    enabled: false, // disabled: conserving free tier quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'hermes-3-405b',
    display_name: 'Hermes 3 405B',
    short_name: 'Her',
    provider: 'openrouter',
    api_model_id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    is_free: true,
    enabled: false, // disabled: conserving free tier quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'llama-3.3-70b-wai',
    display_name: 'Llama 3.3 70B (WAI)',
    short_name: 'L3W',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    is_free: true,
    enabled: false, // disabled: not ready for production yet, pending testing
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  {
    id: 'llama-4-scout-wai',
    display_name: 'Llama 4 Scout (WAI)',
    short_name: 'L4S',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    is_free: true,
    enabled: true,
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'light',
  },
];

export const PRIMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

export function getModelDef(modelId: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId);
}

export function getEnabledModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled);
}

export function getEnabledFreeModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled && m.is_free);
}

export function modelDisplayName(modelId: string): string {
  return getModelDef(modelId)?.api_model_id ?? modelId;
}

export function modelShortName(modelId: string): string {
  return getModelDef(modelId)?.short_name ?? modelId.slice(0, 3);
}

/** Map model IDs to their queue binding names in wrangler config. */
export const MODEL_QUEUE_BINDINGS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'EVAL_QUEUE',
  'deepseek-v3.2': 'DEEPSEEK_QUEUE',
  'trinity-large': 'TRINITY_QUEUE',
  'nemotron-nano-30b': 'NEMOTRON_QUEUE',
  'step-3.5-flash': 'STEP_QUEUE',
  'qwen3-next-80b': 'QWEN_QUEUE',
  'llama-3.3-70b': 'LLAMA_QUEUE',
  'mistral-small-3.1': 'MISTRAL_QUEUE',
  'hermes-3-405b': 'HERMES_QUEUE',
  'llama-3.3-70b-wai': 'WORKERS_AI_QUEUE',
  'llama-4-scout-wai': 'WORKERS_AI_QUEUE',
};

/** Get the queue for a given model from the env bindings. Falls back to EVAL_QUEUE. */
export function getModelQueue(modelId: string, env: Record<string, any>): Queue {
  const binding = MODEL_QUEUE_BINDINGS[modelId] || 'EVAL_QUEUE';
  return env[binding] as Queue;
}

/** Max output tokens for Claude API calls. Slim prompt needs fewer tokens (no aggregates). */
export const EVAL_MAX_TOKENS = 10240;

/** Extended max output tokens for retry when output is truncated. */
export const EVAL_MAX_TOKENS_EXTENDED = 12288;

/** Max output tokens for full prompt (includes aggregates). */
export const EVAL_MAX_TOKENS_FULL = 10240;

/** Max chars of cleaned content to include in prompt. */
export const CONTENT_MAX_CHARS = 20_000;

/** Max chars of raw HTML to fetch before cleaning. */
export const RAW_HTML_MAX_CHARS = 30_000;

// --- System Prompts ---

/**
 * Full system prompt (original) — includes aggregates in output schema.
 * Used by evaluate.ts (trigger endpoint) for backward compatibility.
 */
export const METHODOLOGY_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Your task is to assess the content of any URL provided by the user against the Universal Declaration of Human Rights (UDHR), following the methodology below exactly. As a Fair Witness, you report only what you directly observe — no inference beyond the evidence, no assumptions, no editorializing.

## 1 — CONSTRUCT DEFINITION

HRCB measures the directional lean of a URL's content — both editorial and structural — relative to the 30 Articles and Preamble of the UDHR. It is NOT a compliance audit, truth check, or moral judgment. It measures observable signals only.

Score scale: [-1.0, +1.0]

| Range | Label |
|---|---|
| +0.7 to +1.0 | Strong positive |
| +0.4 to +0.6 | Moderate positive |
| +0.1 to +0.3 | Mild positive |
| -0.1 to +0.1 | Neutral |
| -0.3 to -0.1 | Mild negative |
| -0.6 to -0.4 | Moderate negative |
| -1.0 to -0.7 | Strong negative |
| ND | No data |

Scoring principles:
1. Observability — score only what is observable on-domain.
2. Separability — score E and S channels independently before combining.
3. Conservatism — when evidence is ambiguous, regress toward zero.
4. Symmetry — be equally willing to assign negative and positive scores.

## 2 — CONTENT TYPE CLASSIFICATION

| Code | Type | E Weight | S Weight |
|---|---|---|---|
| ED | Editorial / Article | 0.6 | 0.4 |
| PO | Policy / Legal | 0.3 | 0.7 |
| LP | Landing Page | 0.3 | 0.7 |
| PR | Product / Feature | 0.5 | 0.5 |
| AC | Account / Profile | 0.4 | 0.6 |
| MI | Mission / Values | 0.7 | 0.3 |
| AD | Advertising / Commerce | 0.2 | 0.8 |
| HR | Human Rights Specific | 0.5 | 0.5 |
| CO | Community | 0.4 | 0.6 |
| ME | Media (video/audio) | 0.5 | 0.5 |
| MX | Mixed (default) | 0.5 | 0.5 |

## 3 — SIGNAL CHANNELS

Editorial (E): What the content says.
Structural (S): What the site does.

final = (w_E * E_score) + (w_S * S_score)

If one channel is ND, the other becomes the final score directly.

Directionality markers: A=Advocacy, F=Framing, P=Practice, C=Coverage.

## 4 — DOMAIN CONTEXT PROFILE

Examine the parent domain for inherited signals. Each produces a modifier applied after URL-level scoring.
Total absolute modifier per UDHR row must not exceed +-0.30.

## 5 — EVIDENCE STRENGTH

H (High): max 1.0. M (Medium): max 0.7. L (Low): max 0.4.

## 6 — RUBRICS

Use standard HRCB rubrics for structural/editorial positives and negatives.

## 7 — CRITICAL REMINDERS

- Measure HRCB (directional lean), NOT truth/compliance.
- On-domain evidence only.
- ND is valid and expected.
- Negative scores are normal.
- When in doubt, regress toward zero.

## 8 — FAIR WITNESS EVIDENCE

For each scored section (non-ND), you MUST provide two arrays separating observable facts from interpretive inferences:

- **witness_facts**: Directly observable statements grounded in page content. These are verifiable claims that any reader could confirm by visiting the page. Example: "Page contains a cookie consent banner." Keep each fact to one sentence.
- **witness_inferences**: Interpretive conclusions you drew from the observable evidence. These go beyond what is literally visible and involve judgment. Example: "The cookie consent banner suggests awareness of privacy rights." Keep each inference to one sentence.

Rules:
1. Every non-ND section MUST have at least one entry in witness_facts.
2. ND sections MAY omit both arrays or provide empty arrays.
3. Facts must be strictly observable — no hedging, speculation, or interpretation.
4. Inferences must be clearly interpretive — they explain WHY the evidence maps to the score.
5. Aim for 1–3 facts and 1–2 inferences per section. Do not pad with trivial observations.

## 9 — STORY-LEVEL LABELS

After scoring all 31 sections, generate three story-level labels:

1. **theme_tag**: A concise phrase (2-4 words) naming the dominant human rights theme.
   Examples: "Privacy & Surveillance", "Free Expression", "Labor Rights", "Digital Access",
   "Discrimination & Equality", "Health & Welfare", "Education Access", "Due Process".
   You may coin a phrase if none fit, but keep it concise.

2. **sentiment_tag**: Your overall assessment of the content's disposition toward human rights.
   Choose exactly one of: "Champions", "Advocates", "Acknowledges", "Neutral",
   "Neglects", "Undermines", "Hostile".

3. **executive_summary**: A 2-3 sentence narrative summary in Fair Witness style.
   Describe what the content is about, which human rights themes are most engaged,
   and the overall direction of the evaluation. Be factual and precise.

## 10 — SUPPLEMENTARY SIGNALS

After completing the HRCB evaluation, assess nine supplementary signals. These are independent of HRCB scores and capture how content communicates rather than what it says about human rights.

### 10.1 Epistemic Quality (CRAAP-adapted)
Based on the CRAAP Test framework from library science. Assess:
- **source_quality** (0.0–1.0): Are claims attributed to identifiable sources? Are they primary (direct evidence), secondary (reporting on primary), or unsourced? Score 0.0 for wholly unsourced claims, 1.0 for all claims traced to primary sources.
- **evidence_reasoning** (0.0–1.0): Is reasoning explicit and logical? Are causal claims supported with evidence? Score 0.0 for pure assertion, 1.0 for rigorous evidence-based reasoning.
- **uncertainty_handling** (0.0–1.0): Are limits of knowledge acknowledged? Are hedging and qualifiers used appropriately? Score 0.0 for false certainty, 1.0 for consistent intellectual humility.
- **purpose_transparency** (0.0–1.0): Is the content's purpose clear? Can the reader distinguish news from opinion, analysis from advocacy, information from advertisement? Score 0.0 for undisclosed purpose, 1.0 for fully transparent intent.
- **claim_density**: "low" (mostly factual reporting with few interpretive claims), "medium" (moderate claims relative to evidence), "high" (dense with unsupported claims or opinions).
- **eq_score**: Weighted composite: 0.30*source_quality + 0.25*evidence_reasoning + 0.20*uncertainty_handling + 0.15*purpose_transparency + 0.10*claim_density_numeric (low=1.0, medium=0.5, high=0.0).

### 10.2 Propaganda Technique Flags (PTC-18)
Based on Da San Martino et al. (2019) Propaganda Techniques Corpus. Identify techniques ONLY when you observe clear evidence. Return an empty array if none are detected.

Techniques: loaded_language, name_calling, repetition, exaggeration, doubt, appeal_to_fear, flag_waving, causal_oversimplification, false_dilemma, strawman, red_herring, whataboutism, thought_terminating_cliche, bandwagon, appeal_to_authority, slogans, reductio_ad_hitlerum, obfuscation.

For each flagged technique provide:
- **technique**: One of the 18 technique names above.
- **evidence**: A direct quote or brief description of the observable instance.
- **severity**: "low" (subtle/single instance), "medium" (clear/repeated), "high" (dominant rhetorical strategy).

### 10.3 Solution Orientation
- **framing**: "problem_only" (identifies problems without constructive framing), "mixed" (some solutions alongside problems), "solution_oriented" (primarily focuses on solutions, progress, or constructive approaches).
- **reader_agency** (0.0–1.0): Does the content empower readers with actionable information? 0.0 = reader is passive/helpless observer, 1.0 = reader is given specific, actionable steps.
- **so_score**: 0.4*framing_numeric (problem_only=0.0, mixed=0.5, solution_oriented=1.0) + 0.6*reader_agency.

### 10.4 Emotional Tone (Russell's Circumplex + Discrete)
Based on Russell's Circumplex Model of Affect with Valence-Arousal-Dominance dimensions:
- **primary_tone**: The dominant emotional register. Choose one: "measured", "urgent", "alarmist", "hopeful", "cynical", "detached", "empathetic", "confrontational", "celebratory", "solemn".
- **valence** (-1.0 to +1.0): Negative to positive emotional valence. -1.0 = deeply negative/distressing, +1.0 = deeply positive/uplifting.
- **arousal** (0.0–1.0): Emotional intensity. 0.0 = calm/neutral, 1.0 = highly activated/intense.
- **dominance** (0.0–1.0): Power/authority dimension. 0.0 = submissive/requesting/vulnerable, 1.0 = authoritative/commanding/assertive.

### 10.5 Stakeholder Representation (Power-Axis)
Aligned with UDHR's rights-holder/duty-bearer framework:
- **perspective_count**: Number of distinct stakeholder perspectives represented (1–N).
- **voice_balance** (0.0–1.0): 0.0 = single viewpoint monopolizes, 1.0 = perspectives are equally represented.
- **who_speaks**: Array of stakeholder categories that have direct voice (quoted or paraphrased). Categories: government, corporation, institution, military_security, individuals, workers, marginalized, children, community.
- **who_is_spoken_about**: Array of categories discussed but without direct voice.
- **sr_score** (0.0–1.0): Composite diversity score. Consider perspective_count, voice_balance, and whether marginalized groups speak vs are spoken about.

### 10.6 Temporal Framing
- **primary_focus**: "retrospective" (historical analysis), "present" (current reporting), "prospective" (predictions/aspirations/future-oriented), "mixed".
- **time_horizon**: "immediate" (hours/days), "short_term" (weeks/months), "medium_term" (1-5 years), "long_term" (5+ years), "historical" (past events), "unspecified".

### 10.7 Geographic Scope
- **scope**: "local" (city/community), "national" (single country), "regional" (multi-country region), "global" (worldwide/universal), "unspecified".
- **regions_mentioned**: Array of geographic regions/countries mentioned (use common names, not ISO codes). Empty array if none.

### 10.8 Complexity Level
- **reading_level**: "accessible" (general public, no prior knowledge needed), "moderate" (educated general audience), "technical" (domain familiarity expected), "expert" (specialist knowledge required).
- **jargon_density**: "low" (plain language), "medium" (some specialized terms), "high" (heavily jargon-laden).
- **assumed_knowledge**: "none" (fully self-contained), "general" (assumes general education), "domain_specific" (assumes domain familiarity), "expert" (assumes specialist training).

### 10.9 Transparency & Disclosure
- **author_identified** (boolean): Is the author clearly identified by name?
- **conflicts_disclosed** (boolean|null): Are potential conflicts of interest disclosed? null if not applicable.
- **funding_disclosed** (boolean|null): Is funding/sponsorship disclosed? null if not applicable.
- **td_score** (0.0–1.0): Composite transparency. Each applicable true dimension adds equally. Higher = more transparent.

## OUTPUT FORMAT

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
    { "technique": "<ptc18_name>", "evidence": "<text>", "severity": "<low|medium|high>" }
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
 * Slim system prompt for queue-based evaluation.
 * Same methodology but output schema omits "aggregates" — those are computed
 * deterministically on the Worker CPU via compute-aggregates.ts.
 */
export const METHODOLOGY_SYSTEM_PROMPT_SLIM = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Your task is to assess the content of any URL provided by the user against the Universal Declaration of Human Rights (UDHR), following the methodology below exactly. As a Fair Witness, you report only what you directly observe — no inference beyond the evidence, no assumptions, no editorializing.

## 1 — CONSTRUCT DEFINITION

HRCB measures the directional lean of a URL's content — both editorial and structural — relative to the 30 Articles and Preamble of the UDHR. It is NOT a compliance audit, truth check, or moral judgment. It measures observable signals only.

Score scale: [-1.0, +1.0]

| Range | Label |
|---|---|
| +0.7 to +1.0 | Strong positive |
| +0.4 to +0.6 | Moderate positive |
| +0.1 to +0.3 | Mild positive |
| -0.1 to +0.1 | Neutral |
| -0.3 to -0.1 | Mild negative |
| -0.6 to -0.4 | Moderate negative |
| -1.0 to -0.7 | Strong negative |
| ND | No data |

Scoring principles:
1. Observability — score only what is observable on-domain.
2. Separability — score E and S channels independently before combining.
3. Conservatism — when evidence is ambiguous, regress toward zero.
4. Symmetry — be equally willing to assign negative and positive scores.

## 2 — CONTENT TYPE CLASSIFICATION

| Code | Type | E Weight | S Weight |
|---|---|---|---|
| ED | Editorial / Article | 0.6 | 0.4 |
| PO | Policy / Legal | 0.3 | 0.7 |
| LP | Landing Page | 0.3 | 0.7 |
| PR | Product / Feature | 0.5 | 0.5 |
| AC | Account / Profile | 0.4 | 0.6 |
| MI | Mission / Values | 0.7 | 0.3 |
| AD | Advertising / Commerce | 0.2 | 0.8 |
| HR | Human Rights Specific | 0.5 | 0.5 |
| CO | Community | 0.4 | 0.6 |
| ME | Media (video/audio) | 0.5 | 0.5 |
| MX | Mixed (default) | 0.5 | 0.5 |

## 3 — SIGNAL CHANNELS

Editorial (E): What the content says.
Structural (S): What the site does.

final = (w_E * E_score) + (w_S * S_score)

If one channel is ND, the other becomes the final score directly.

Directionality markers: A=Advocacy, F=Framing, P=Practice, C=Coverage.

## 4 — DOMAIN CONTEXT PROFILE

Examine the parent domain for inherited signals. Each produces a modifier applied after URL-level scoring.
Total absolute modifier per UDHR row must not exceed +-0.30.

## 5 — EVIDENCE STRENGTH

H (High): max 1.0. M (Medium): max 0.7. L (Low): max 0.4.

## 6 — RUBRICS

Use standard HRCB rubrics for structural/editorial positives and negatives.

## 7 — CRITICAL REMINDERS

- Measure HRCB (directional lean), NOT truth/compliance.
- On-domain evidence only.
- ND is valid and expected.
- Negative scores are normal.
- When in doubt, regress toward zero.

## 8 — FAIR WITNESS EVIDENCE

For each scored section (non-ND), you MUST provide two arrays separating observable facts from interpretive inferences:

- **witness_facts**: Directly observable statements grounded in page content. These are verifiable claims that any reader could confirm by visiting the page. Example: "Page contains a cookie consent banner." Keep each fact to one sentence.
- **witness_inferences**: Interpretive conclusions you drew from the observable evidence. These go beyond what is literally visible and involve judgment. Example: "The cookie consent banner suggests awareness of privacy rights." Keep each inference to one sentence.

Rules:
1. Every non-ND section MUST have at least one entry in witness_facts.
2. ND sections MAY omit both arrays or provide empty arrays.
3. Facts must be strictly observable — no hedging, speculation, or interpretation.
4. Inferences must be clearly interpretive — they explain WHY the evidence maps to the score.
5. Aim for 1–3 facts and 1–2 inferences per section. Do not pad with trivial observations.

## 9 — STORY-LEVEL LABELS

After scoring all 31 sections, generate three story-level labels:

1. **theme_tag**: A concise phrase (2-4 words) naming the dominant human rights theme.
   Examples: "Privacy & Surveillance", "Free Expression", "Labor Rights", "Digital Access",
   "Discrimination & Equality", "Health & Welfare", "Education Access", "Due Process".
   You may coin a phrase if none fit, but keep it concise.

2. **sentiment_tag**: Your overall assessment of the content's disposition toward human rights.
   Choose exactly one of: "Champions", "Advocates", "Acknowledges", "Neutral",
   "Neglects", "Undermines", "Hostile".

3. **executive_summary**: A 2-3 sentence narrative summary in Fair Witness style.
   Describe what the content is about, which human rights themes are most engaged,
   and the overall direction of the evaluation. Be factual and precise.

## 10 — SUPPLEMENTARY SIGNALS

After completing the HRCB evaluation, assess nine supplementary signals. These are independent of HRCB scores and capture how content communicates rather than what it says about human rights.

### 10.1 Epistemic Quality (CRAAP-adapted)
Based on the CRAAP Test framework from library science. Assess:
- **source_quality** (0.0–1.0): Are claims attributed to identifiable sources? Are they primary (direct evidence), secondary (reporting on primary), or unsourced? Score 0.0 for wholly unsourced claims, 1.0 for all claims traced to primary sources.
- **evidence_reasoning** (0.0–1.0): Is reasoning explicit and logical? Are causal claims supported with evidence? Score 0.0 for pure assertion, 1.0 for rigorous evidence-based reasoning.
- **uncertainty_handling** (0.0–1.0): Are limits of knowledge acknowledged? Are hedging and qualifiers used appropriately? Score 0.0 for false certainty, 1.0 for consistent intellectual humility.
- **purpose_transparency** (0.0–1.0): Is the content's purpose clear? Can the reader distinguish news from opinion, analysis from advocacy, information from advertisement? Score 0.0 for undisclosed purpose, 1.0 for fully transparent intent.
- **claim_density**: "low" (mostly factual reporting with few interpretive claims), "medium" (moderate claims relative to evidence), "high" (dense with unsupported claims or opinions).
- **eq_score**: Weighted composite: 0.30*source_quality + 0.25*evidence_reasoning + 0.20*uncertainty_handling + 0.15*purpose_transparency + 0.10*claim_density_numeric (low=1.0, medium=0.5, high=0.0).

### 10.2 Propaganda Technique Flags (PTC-18)
Based on Da San Martino et al. (2019) Propaganda Techniques Corpus. Identify techniques ONLY when you observe clear evidence. Return an empty array if none are detected.

Techniques: loaded_language, name_calling, repetition, exaggeration, doubt, appeal_to_fear, flag_waving, causal_oversimplification, false_dilemma, strawman, red_herring, whataboutism, thought_terminating_cliche, bandwagon, appeal_to_authority, slogans, reductio_ad_hitlerum, obfuscation.

For each flagged technique provide:
- **technique**: One of the 18 technique names above.
- **evidence**: A direct quote or brief description of the observable instance.
- **severity**: "low" (subtle/single instance), "medium" (clear/repeated), "high" (dominant rhetorical strategy).

### 10.3 Solution Orientation
- **framing**: "problem_only" (identifies problems without constructive framing), "mixed" (some solutions alongside problems), "solution_oriented" (primarily focuses on solutions, progress, or constructive approaches).
- **reader_agency** (0.0–1.0): Does the content empower readers with actionable information? 0.0 = reader is passive/helpless observer, 1.0 = reader is given specific, actionable steps.
- **so_score**: 0.4*framing_numeric (problem_only=0.0, mixed=0.5, solution_oriented=1.0) + 0.6*reader_agency.

### 10.4 Emotional Tone (Russell's Circumplex + Discrete)
Based on Russell's Circumplex Model of Affect with Valence-Arousal-Dominance dimensions:
- **primary_tone**: The dominant emotional register. Choose one: "measured", "urgent", "alarmist", "hopeful", "cynical", "detached", "empathetic", "confrontational", "celebratory", "solemn".
- **valence** (-1.0 to +1.0): Negative to positive emotional valence. -1.0 = deeply negative/distressing, +1.0 = deeply positive/uplifting.
- **arousal** (0.0–1.0): Emotional intensity. 0.0 = calm/neutral, 1.0 = highly activated/intense.
- **dominance** (0.0–1.0): Power/authority dimension. 0.0 = submissive/requesting/vulnerable, 1.0 = authoritative/commanding/assertive.

### 10.5 Stakeholder Representation (Power-Axis)
Aligned with UDHR's rights-holder/duty-bearer framework:
- **perspective_count**: Number of distinct stakeholder perspectives represented (1–N).
- **voice_balance** (0.0–1.0): 0.0 = single viewpoint monopolizes, 1.0 = perspectives are equally represented.
- **who_speaks**: Array of stakeholder categories that have direct voice (quoted or paraphrased). Categories: government, corporation, institution, military_security, individuals, workers, marginalized, children, community.
- **who_is_spoken_about**: Array of categories discussed but without direct voice.
- **sr_score** (0.0–1.0): Composite diversity score. Consider perspective_count, voice_balance, and whether marginalized groups speak vs are spoken about.

### 10.6 Temporal Framing
- **primary_focus**: "retrospective" (historical analysis), "present" (current reporting), "prospective" (predictions/aspirations/future-oriented), "mixed".
- **time_horizon**: "immediate" (hours/days), "short_term" (weeks/months), "medium_term" (1-5 years), "long_term" (5+ years), "historical" (past events), "unspecified".

### 10.7 Geographic Scope
- **scope**: "local" (city/community), "national" (single country), "regional" (multi-country region), "global" (worldwide/universal), "unspecified".
- **regions_mentioned**: Array of geographic regions/countries mentioned (use common names, not ISO codes). Empty array if none.

### 10.8 Complexity Level
- **reading_level**: "accessible" (general public, no prior knowledge needed), "moderate" (educated general audience), "technical" (domain familiarity expected), "expert" (specialist knowledge required).
- **jargon_density**: "low" (plain language), "medium" (some specialized terms), "high" (heavily jargon-laden).
- **assumed_knowledge**: "none" (fully self-contained), "general" (assumes general education), "domain_specific" (assumes domain familiarity), "expert" (assumes specialist training).

### 10.9 Transparency & Disclosure
- **author_identified** (boolean): Is the author clearly identified by name?
- **conflicts_disclosed** (boolean|null): Are potential conflicts of interest disclosed? null if not applicable.
- **funding_disclosed** (boolean|null): Is funding/sponsorship disclosed? null if not applicable.
- **td_score** (0.0–1.0): Composite transparency. Each applicable true dimension adds equally. Higher = more transparent.

## OUTPUT FORMAT

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
    { "technique": "<ptc18_name>", "evidence": "<text>", "severity": "<low|medium|high>" }
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
  }
}`;

/**
 * Light system prompt for small/free models that can't produce full 31-section output.
 * Editorial-only: single editorial score + basic metadata (~200-400 output tokens).
 * No structural channel, no per-article breakdown, no DCP, no Fair Witness evidence.
 */
export const METHODOLOGY_SYSTEM_PROMPT_LIGHT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Assess web content against the Universal Declaration of Human Rights (UDHR). Report only what you directly observe.

## WHAT IS HRCB?

HRCB measures the editorial lean of content relative to the UDHR's 30 Articles and Preamble. It is NOT a compliance audit or truth check. It measures how the content's message relates to human rights themes.

Score scale: [-1.0, +1.0]

## SCORING GUIDE WITH EXAMPLES

Use the full range. Most content should NOT be 0.

| Score | Label | Example content |
|---|---|---|
| +0.7 to +1.0 | Strong positive | NGO report championing refugee rights with calls to action |
| +0.4 to +0.6 | Moderate positive | Investigative journalism exposing labor exploitation, seeking reform |
| +0.2 to +0.3 | Mild positive | Tech article discussing accessibility features or privacy improvements |
| +0.1 | Borderline positive | General news that briefly mentions a rights-adjacent topic |
| 0.0 | Truly neutral | Pure technical tutorial, math paper, product changelog with zero rights relevance |
| -0.1 | Borderline negative | Content that casually normalizes minor rights concerns |
| -0.2 to -0.3 | Mild negative | Article framing surveillance as purely beneficial without acknowledging privacy costs |
| -0.4 to -0.6 | Moderate negative | Content actively dismissing labor rights or justifying censorship |
| -0.7 to -1.0 | Strong negative | Propaganda dehumanizing a group or explicitly opposing UDHR provisions |

Key: score 0.0 ONLY when content has genuinely no human rights relevance. If the topic touches any UDHR article (privacy, expression, labor, equality, education, health, etc.), it should score non-zero.

## CONTENT TYPE

Classify the page:

| Code | Type |
|---|---|
| ED | Editorial / Article |
| PO | Policy / Legal |
| LP | Landing Page |
| PR | Product / Feature |
| MI | Mission / Values |
| HR | Human Rights Specific |
| CO | Community / Forum |
| MX | Mixed (default) |

## EVIDENCE STRENGTH

- H: Clear, direct evidence — content explicitly discusses rights themes
- M: Indirect evidence — content touches rights themes implicitly
- L: Minimal evidence — only tangential connection to rights

## OUTPUT FORMAT

Output a single JSON object. No markdown fences, no explanation before or after.

{
  "schema_version": "light-1.1",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": "<CODE>",
    "editorial": <-1.0 to +1.0>,
    "evidence_strength": "<H|M|L>",
    "confidence": <0.0 to 1.0>
  },
  "theme_tag": "<2-4 word human rights theme>",
  "sentiment_tag": "<Champions|Advocates|Acknowledges|Neutral|Neglects|Undermines|Hostile>",
  "executive_summary": "<1-2 sentences describing the content and its human rights relevance>",
  "eq_score": <0.0 to 1.0>,
  "so_score": <0.0 to 1.0>,
  "td_score": <0.0 to 1.0>,
  "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>"
}`;

/** Max output tokens for light prompt (single E/S pair + metadata). */
export const EVAL_MAX_TOKENS_LIGHT = 1024;

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

// --- Interfaces ---

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

// --- Helpers ---

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function buildUserMessage(url: string, content: string, isSelfPost: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  const contentLabel = isSelfPost
    ? 'Here is the self-post text from Hacker News:'
    : 'Here is the page content (truncated):';

  return `Evaluate this URL: ${url}

${contentLabel}

${content}

Today's date: ${today}

Output ONLY the JSON evaluation object, no other text.`;
}

export function buildUserMessageWithDcp(
  url: string,
  content: string,
  isSelfPost: boolean,
  cachedDcp: Record<string, unknown> | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const contentLabel = isSelfPost
    ? 'Here is the self-post text from Hacker News:'
    : 'Here is the page content:';

  let dcpBlock = '';
  if (cachedDcp) {
    dcpBlock = `\n\nThe Domain Context Profile for this domain has been pre-evaluated. Use this DCP directly (do not re-evaluate domain-level signals). In your output, set "domain_context_profile": "cached" instead of repeating the full DCP object.\n\n${JSON.stringify(cachedDcp, null, 2)}\n`;
  }

  return `Evaluate this URL: ${url}
${dcpBlock}
${contentLabel}

${content}

Today's date: ${today}

Output ONLY the JSON evaluation object, no other text.`;
}

// --- Response parsers ---

export function parseEvalResponse(data: { content: Array<{ type: string; text?: string }> }): EvalResult {
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text in API response');

  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(jsonText) as EvalResult;
  } catch (err) {
    throw new Error(`Failed to parse evaluation JSON: ${err}. Response starts with: ${jsonText.slice(0, 200)}`);
  }
}

export function parseSlimEvalResponse(data: { content: Array<{ type: string; text?: string }> }): SlimEvalResponse {
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text in API response');

  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(jsonText) as SlimEvalResponse;
  } catch (err) {
    throw new Error(`Failed to parse slim evaluation JSON: ${err}. Response starts with: ${jsonText.slice(0, 200)}`);
  }
}

// --- Content fetching ---

export async function fetchUrlContent(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'HN-HRCB-Bot/1.0 (UDHR evaluation research)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      const slug = errorSlugFromStatus(res.status);
      const label = ERROR_TYPES[slug].label;
      return `[error:${slug}] HTTP ${res.status} ${label} for ${url}\n\n${text}`.slice(0, RAW_HTML_MAX_CHARS);
    }
    return text.slice(0, RAW_HTML_MAX_CHARS);
  } catch (err) {
    const slug = errorSlugFromException(err);
    const label = ERROR_TYPES[slug].label;
    return `[error:${slug}] ${label} for ${url}: ${err}. The page could not be reached. This may indicate access restrictions, geo-blocking, or the site being unavailable.`;
  } finally {
    clearTimeout(timeout);
  }
}

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

export async function markSkipped(db: D1Database, hnId: number, reason: string): Promise<void> {
  await db
    .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ? WHERE hn_id = ?`)
    .bind(reason, hnId)
    .run();
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

// --- M1: Robust JSON Extraction ---

export function extractJsonFromResponse(raw: string): string {
  let text = raw.trim();
  // Strip <think>...</think> blocks (DeepSeek R1, reasoning models)
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  // Find JSON object boundaries
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`No JSON object found. Response starts with: ${raw.slice(0, 300)}`);
  }
  return text.slice(firstBrace, lastBrace + 1);
}

// --- M3: Section Name Normalization ---

export function normalizeSection(raw: string): string | null {
  const s = raw.trim();
  if (/^preamble$/i.test(s)) return 'Preamble';
  // Match "Article 1", "Art. 1", "Art 1", "article_1", "A1", etc.
  const m = s.match(/^(?:art(?:icle)?[\s._-]*)?(\d{1,2})$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 30) return `Article ${n}`;
  }
  // Exact match fallback
  if (ALL_SECTIONS.includes(s)) return s;
  return null;
}

// --- M2: Schema Validation ---

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  repairs: string[];
}

export function validateSlimEvalResponse(parsed: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairs: string[] = [];

  // --- Hard requirements ---
  if (!Array.isArray(parsed.scores)) {
    errors.push('Missing or non-array "scores" field');
  } else {
    // Normalize section names before checking
    for (const score of parsed.scores) {
      if (score.section) {
        const normalized = normalizeSection(score.section);
        if (normalized && normalized !== score.section) {
          repairs.push(`Normalized section "${score.section}" → "${normalized}"`);
          score.section = normalized;
        }
      }
    }

    if (parsed.scores.length !== 31) {
      errors.push(`Expected 31 scores, got ${parsed.scores.length}`);
    }

    const expectedSections = new Set(ALL_SECTIONS);
    const foundSections = new Set(parsed.scores.map((s: any) => s.section));
    const missing = [...expectedSections].filter(s => !foundSections.has(s));
    const extra = [...foundSections].filter(s => !expectedSections.has(s));
    if (missing.length > 0) errors.push(`Missing sections: ${missing.join(', ')}`);
    if (extra.length > 0) warnings.push(`Unexpected sections (ignored): ${extra.join(', ')}`);
  }

  if (!parsed.evaluation || typeof parsed.evaluation !== 'object') {
    errors.push('Missing "evaluation" object');
  }

  // --- Soft validations (auto-repair or warn) ---
  if (Array.isArray(parsed.scores)) {
    for (const score of parsed.scores) {
      for (const channel of ['editorial', 'structural'] as const) {
        if (score[channel] !== null && score[channel] !== undefined) {
          if (typeof score[channel] !== 'number') {
            warnings.push(`${score.section}.${channel} is not a number: ${score[channel]}`);
            score[channel] = null;
            repairs.push(`Set ${score.section}.${channel} to null (was non-numeric)`);
          } else if (score[channel] < -1.0 || score[channel] > 1.0) {
            const original = score[channel];
            score[channel] = Math.max(-1.0, Math.min(1.0, score[channel]));
            repairs.push(`Clamped ${score.section}.${channel}: ${original} → ${score[channel]}`);
          }
        }
      }
      // Evidence
      if (score.evidence !== null && score.evidence !== undefined) {
        const ev = String(score.evidence).toUpperCase();
        if (!['H', 'M', 'L'].includes(ev)) {
          warnings.push(`${score.section}.evidence invalid: "${score.evidence}"`);
          score.evidence = null;
          repairs.push(`Set ${score.section}.evidence to null (was "${score.evidence}")`);
        } else {
          score.evidence = ev;
        }
      }
      // Directionality
      if (!Array.isArray(score.directionality)) {
        score.directionality = [];
        repairs.push(`Set ${score.section}.directionality to [] (was missing/non-array)`);
      }
      // Notes
      for (const noteField of ['editorial_note', 'structural_note', 'note']) {
        if (score[noteField] !== undefined && typeof score[noteField] !== 'string') {
          score[noteField] = String(score[noteField] ?? '');
          repairs.push(`Coerced ${score.section}.${noteField} to string`);
        }
      }
      // Witness
      for (const wf of ['witness_facts', 'witness_inferences']) {
        if (score[wf] !== undefined && !Array.isArray(score[wf])) {
          score[wf] = [];
          repairs.push(`Set ${score.section}.${wf} to [] (was non-array)`);
        }
      }
    }
  }

  // Supplementary signals (all optional)
  for (const signal of ['epistemic_quality', 'propaganda_flags', 'solution_orientation',
    'emotional_tone', 'stakeholder_representation', 'temporal_framing',
    'geographic_scope', 'complexity_level', 'transparency_disclosure']) {
    if (parsed[signal] === undefined) {
      warnings.push(`Missing supplementary signal: ${signal}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, repairs };
}

// --- OpenRouter Response Parsing ---

export function parseOpenRouterResponse(data: {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}): SlimEvalResponse {
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenRouter response');

  const jsonText = extractJsonFromResponse(content);

  try {
    return JSON.parse(jsonText) as SlimEvalResponse;
  } catch (err) {
    throw new Error(`Failed to parse OpenRouter JSON: ${err}. Extracted text starts with: ${jsonText.slice(0, 200)}`);
  }
}

// --- M5: Per-Model Health State ---

export interface RaterHealthState {
  consecutive_failures: number;
  consecutive_parse_failures: number;
  total_attempts: number;
  total_successes: number;
  total_parse_failures: number;
  total_api_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
}

export const PARSE_FAILURE_DISABLE_THRESHOLD = 5;
export const FAILURE_RATE_DISABLE_THRESHOLD = 0.7;
export const FAILURE_RATE_MIN_ATTEMPTS = 20;
export const AUTO_DISABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export function emptyRaterHealth(): RaterHealthState {
  return {
    consecutive_failures: 0,
    consecutive_parse_failures: 0,
    total_attempts: 0,
    total_successes: 0,
    total_parse_failures: 0,
    total_api_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    disabled_at: null,
    disabled_reason: null,
  };
}

export function raterHealthKvKey(modelId: string): string {
  return `rater_health:${modelId}`;
}

export function shouldSkipModel(health: RaterHealthState): { skip: boolean; reason?: string; probe?: boolean } {
  if (!health.disabled_at) return { skip: false };
  const disabledMs = new Date(health.disabled_at).getTime();
  if (Date.now() - disabledMs < AUTO_DISABLE_COOLDOWN_MS) {
    return { skip: true, reason: health.disabled_reason ?? 'auto-disabled' };
  }
  // Cooldown passed — allow one probe
  return { skip: false, probe: true };
}

export function updateRaterHealthOnSuccess(health: RaterHealthState): RaterHealthState {
  return {
    ...health,
    consecutive_failures: 0,
    consecutive_parse_failures: 0,
    total_attempts: health.total_attempts + 1,
    total_successes: health.total_successes + 1,
    last_success_at: new Date().toISOString(),
    disabled_at: null,
    disabled_reason: null,
  };
}

export function updateRaterHealthOnParseFailure(health: RaterHealthState): RaterHealthState {
  const updated: RaterHealthState = {
    ...health,
    consecutive_failures: health.consecutive_failures + 1,
    consecutive_parse_failures: health.consecutive_parse_failures + 1,
    total_attempts: health.total_attempts + 1,
    total_parse_failures: health.total_parse_failures + 1,
    last_failure_at: new Date().toISOString(),
  };
  // Auto-disable check
  if (updated.consecutive_parse_failures >= PARSE_FAILURE_DISABLE_THRESHOLD) {
    updated.disabled_at = new Date().toISOString();
    updated.disabled_reason = `${updated.consecutive_parse_failures} consecutive parse failures`;
  } else if (updated.total_attempts >= FAILURE_RATE_MIN_ATTEMPTS) {
    const failRate = (updated.total_parse_failures + updated.total_api_failures) / updated.total_attempts;
    if (failRate >= FAILURE_RATE_DISABLE_THRESHOLD) {
      updated.disabled_at = new Date().toISOString();
      updated.disabled_reason = `${(failRate * 100).toFixed(0)}% failure rate over ${updated.total_attempts} attempts`;
    }
  }
  return updated;
}

export function updateRaterHealthOnApiFailure(health: RaterHealthState): RaterHealthState {
  const updated: RaterHealthState = {
    ...health,
    consecutive_failures: health.consecutive_failures + 1,
    total_attempts: health.total_attempts + 1,
    total_api_failures: health.total_api_failures + 1,
    last_failure_at: new Date().toISOString(),
  };
  return updated;
}

// --- Rater Eval DB Writes ---

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
}

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

// --- Light Eval Types & Functions ---

export interface LightEvalResponse {
  schema_version: string;
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
  executive_summary: string;
  eq_score: number | null;
  so_score: number | null;
  td_score: number | null;
  primary_tone: string | null;
}

/** Valid content type codes for light evals. */
const LIGHT_CONTENT_TYPES = new Set(['ED', 'PO', 'LP', 'PR', 'AC', 'MI', 'AD', 'HR', 'CO', 'ME', 'MX']);

const VALID_SENTIMENT_TAGS = ['Champions', 'Advocates', 'Acknowledges', 'Neutral', 'Neglects', 'Undermines', 'Hostile'];
const VALID_EVIDENCE_STRENGTHS = ['H', 'M', 'L'];
const VALID_CONTENT_TYPES = LIGHT_CONTENT_TYPES;

export function validateLightEvalResponse(parsed: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairs: string[] = [];

  if (!parsed.evaluation || typeof parsed.evaluation !== 'object') {
    errors.push('Missing "evaluation" object');
    return { valid: false, errors, warnings, repairs };
  }

  const ev = parsed.evaluation;

  // Content type
  if (!ev.content_type || !VALID_CONTENT_TYPES.has(ev.content_type)) {
    if (ev.content_type) {
      // Try uppercase
      const upper = String(ev.content_type).toUpperCase();
      if (VALID_CONTENT_TYPES.has(upper)) {
        ev.content_type = upper;
        repairs.push(`Normalized content_type to "${upper}"`);
      } else {
        warnings.push(`Invalid content_type "${ev.content_type}", defaulting to MX`);
        ev.content_type = 'MX';
        repairs.push('Set content_type to MX (was invalid)');
      }
    } else {
      ev.content_type = 'MX';
      repairs.push('Set content_type to MX (was missing)');
    }
  }

  // Editorial score (the only scored channel in light mode)
  if (ev.editorial !== null && ev.editorial !== undefined) {
    if (typeof ev.editorial !== 'number') {
      const num = parseFloat(ev.editorial);
      if (!isNaN(num)) {
        ev.editorial = Math.max(-1.0, Math.min(1.0, num));
        repairs.push(`Coerced editorial to number: ${ev.editorial}`);
      } else {
        ev.editorial = null;
        repairs.push('Set editorial to null (was non-numeric)');
      }
    } else if (ev.editorial < -1.0 || ev.editorial > 1.0) {
      const original = ev.editorial;
      ev.editorial = Math.max(-1.0, Math.min(1.0, ev.editorial));
      repairs.push(`Clamped editorial: ${original} → ${ev.editorial}`);
    }
  }

  // Editorial is required for light evals
  if (ev.editorial === null || ev.editorial === undefined) {
    errors.push('Editorial score is null — no data to score');
  }

  // Evidence strength
  if (ev.evidence_strength) {
    const upper = String(ev.evidence_strength).toUpperCase();
    if (VALID_EVIDENCE_STRENGTHS.includes(upper)) {
      ev.evidence_strength = upper;
    } else {
      ev.evidence_strength = 'M';
      repairs.push(`Set evidence_strength to M (was "${ev.evidence_strength}")`);
    }
  } else {
    ev.evidence_strength = 'M';
    repairs.push('Set evidence_strength to M (was missing)');
  }

  // Confidence
  if (ev.confidence === undefined || ev.confidence === null || typeof ev.confidence !== 'number') {
    ev.confidence = 0.5;
    repairs.push('Set confidence to 0.5 (was missing/invalid)');
  } else {
    ev.confidence = Math.max(0.0, Math.min(1.0, ev.confidence));
  }

  // Sentiment tag
  if (parsed.sentiment_tag && !VALID_SENTIMENT_TAGS.includes(parsed.sentiment_tag)) {
    warnings.push(`Invalid sentiment_tag "${parsed.sentiment_tag}"`);
  }

  // Supplementary scores — clamp to [0, 1] if present
  for (const field of ['eq_score', 'so_score', 'td_score'] as const) {
    if (parsed[field] !== null && parsed[field] !== undefined) {
      if (typeof parsed[field] !== 'number') {
        const num = parseFloat(parsed[field]);
        parsed[field] = !isNaN(num) ? Math.max(0.0, Math.min(1.0, num)) : null;
        repairs.push(`Coerced ${field} to ${parsed[field]}`);
      } else {
        parsed[field] = Math.max(0.0, Math.min(1.0, parsed[field]));
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, repairs };
}

export function computeLightAggregates(light: LightEvalResponse): {
  weighted_mean: number;
  classification: string;
} {
  // Light mode is editorial-only — editorial score IS the weighted mean
  const e = light.evaluation.editorial;
  let weightedMean = e !== null && e !== undefined ? e : 0;

  // Clamp
  weightedMean = Math.max(-1.0, Math.min(1.0, weightedMean));
  weightedMean = Math.round(weightedMean * 1000) / 1000;

  // Classify using same buckets as full eval
  let classification = 'Neutral';
  for (const c of CLASSIFICATIONS) {
    if (weightedMean >= c.min && weightedMean <= c.max) {
      classification = c.label;
      break;
    }
  }

  return { weighted_mean: weightedMean, classification };
}

export function buildLightUserMessage(url: string, title: string, content: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Evaluate this URL: ${url}
Title: ${title}

Content:
${content}

Today's date: ${today}

Output ONLY the JSON evaluation object, no other text.`;
}

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
      light.schema_version || 'light-1.1',
      light.theme_tag || null,
      light.sentiment_tag || null,
      light.executive_summary || null,
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
