/**
 * Shared HRCB evaluation primitives.
 * Imported by src/lib/evaluate.ts (trigger endpoint), functions/cron.ts, and functions/consumer.ts.
 */

import { errorSlugFromStatus, errorSlugFromException, ERROR_TYPES } from './types';

// --- Constants ---

export const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

export const EVAL_MODEL = 'claude-haiku-4-5-20251001';

/** Max output tokens for Claude API calls. Slim prompt needs fewer tokens (no aggregates). */
export const EVAL_MAX_TOKENS = 8192;

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

## OUTPUT FORMAT

You MUST output a single JSON object (no markdown fences, no explanation before or after). Section names in the scores array MUST use the full word "Article" (e.g. "Article 1", "Article 19"), NOT abbreviated "Art." Do NOT include "combined", "context_modifier", or "final" in scores — these are computed externally. If a cached DCP was provided in the user message, output "domain_context_profile": "cached" instead of the full object. The JSON must follow this exact schema:

{
  "schema_version": "3.5",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": { "primary": "<CODE>", "secondary": [] },
    "channel_weights": { "editorial": <w_E>, "structural": <w_S> },
    "eval_depth": "STANDARD",
    "date": "<YYYY-MM-DD>",
    "methodology": "v3.5",
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

## OUTPUT FORMAT

You MUST output a single JSON object (no markdown fences, no explanation before or after). Section names in the scores array MUST use the full word "Article" (e.g. "Article 1", "Article 19"), NOT abbreviated "Art." Do NOT include an "aggregates" field — aggregates are computed externally. Do NOT include "combined", "context_modifier", or "final" in scores — these are computed externally. If a cached DCP was provided in the user message, output "domain_context_profile": "cached" instead of the full object. The JSON must follow this exact schema:

{
  "schema_version": "3.5",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": { "primary": "<CODE>", "secondary": [] },
    "channel_weights": { "editorial": <w_E>, "structural": <w_S> },
    "eval_depth": "STANDARD",
    "date": "<YYYY-MM-DD>",
    "methodology": "v3.5",
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
  ]
}`;

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
  const setlValues: number[] = [];
  for (const s of result.scores) {
    if (s.editorial !== null && s.structural !== null && (Math.abs(s.editorial) > 0 || Math.abs(s.structural) > 0)) {
      const diff = Math.abs(s.editorial - s.structural);
      const maxAbs = Math.max(Math.abs(s.editorial), Math.abs(s.structural));
      const mag = Math.sqrt(diff * maxAbs);
      setlValues.push(s.editorial >= s.structural ? mag : -mag);
    }
  }
  const hcbSetl = setlValues.length > 0 ? setlValues.reduce((a, b) => a + b, 0) / setlValues.length : null;

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

export async function ensureDcpTable(db: D1Database): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS domain_dcp (
      domain    TEXT PRIMARY KEY,
      dcp_json  TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
}

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
