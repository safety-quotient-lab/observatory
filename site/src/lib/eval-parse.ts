// SPDX-License-Identifier: Apache-2.0
/**
 * Evaluation response parsing, validation, and content fetching.
 */

import { errorSlugFromStatus, errorSlugFromException, ERROR_TYPES } from './types';
import {
  ALL_SECTIONS,
  CLASSIFICATIONS,
  CONTENT_TYPE_WEIGHTS,
  type EvalResult,
  type SlimEvalResponse,
  type LiteEvalResponse,
  type ValidationResult,
} from './eval-types';
import { computeSetl } from './compute-aggregates';
import { RAW_HTML_MAX_CHARS } from './shared-eval';

/** Valid content type codes for lite evals. */
const LITE_CONTENT_TYPES = new Set(['ED', 'PO', 'LP', 'PR', 'AC', 'MI', 'AD', 'HR', 'CO', 'ME', 'MX']);

const VALID_SENTIMENT_TAGS = ['Champions', 'Advocates', 'Acknowledges', 'Neutral', 'Neglects', 'Undermines', 'Hostile'];
const VALID_EVIDENCE_STRENGTHS = ['H', 'M', 'L'];
const VALID_CONTENT_TYPES = LITE_CONTENT_TYPES;

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

export function buildLiteUserMessage(url: string, title: string, content: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Evaluate this URL: ${url}
Title: ${title}

Content:
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

// --- Robust JSON Extraction ---

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
  let json = text.slice(firstBrace, lastBrace + 1);
  // Strip leading '+' on numeric values (e.g. "+0.5" → "0.5") — Llama models emit this
  json = json.replace(/:\s*\+(\d)/g, ': $1');
  return json;
}

// --- Section Name Normalization ---

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

// --- Schema Validation ---

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
          repairs.push(`Normalized section "${score.section}" \u2192 "${normalized}"`);
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
  } else {
    // Content type validation (parity with lite eval validation)
    const ct = parsed.evaluation.content_type;
    if (ct && typeof ct === 'object' && ct.primary) {
      const upper = String(ct.primary).toUpperCase();
      if (!VALID_CONTENT_TYPES.has(upper)) {
        warnings.push(`Invalid content_type.primary "${ct.primary}", defaulting to MX`);
        ct.primary = 'MX';
        repairs.push('Set content_type.primary to MX (was invalid)');
      } else if (ct.primary !== upper) {
        ct.primary = upper;
        repairs.push(`Normalized content_type.primary to "${upper}"`);
      }
    }
  }

  // Schema version warning
  if (parsed.schema_version !== undefined) {
    if (!/^\d+\.\d+$/.test(parsed.schema_version)) {
      warnings.push(`Unrecognized schema_version "${parsed.schema_version}"`);
    }
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
            repairs.push(`Clamped ${score.section}.${channel}: ${original} \u2192 ${score[channel]}`);
          }
        }
      }
      // Evidence-level cap enforcement: H = max 1.0, M = max 0.7, L = max 0.4
      const ev = score.evidence ? String(score.evidence).toUpperCase() : null;
      const evidenceCap: Record<string, number> = { M: 0.7, L: 0.4 };
      if (ev && ev in evidenceCap) {
        const cap = evidenceCap[ev];
        for (const channel of ['editorial', 'structural'] as const) {
          if (score[channel] !== null && score[channel] !== undefined && typeof score[channel] === 'number') {
            if (Math.abs(score[channel]) > cap) {
              const original = score[channel];
              score[channel] = Math.max(-cap, Math.min(cap, score[channel]));
              repairs.push(`Evidence-capped ${score.section}.${channel}: ${original} \u2192 ${score[channel]} (evidence=${ev}, max=${cap})`);
            }
          }
        }
      }
      // Editorial is the primary channel — if missing, final and structural are meaningless
      if (score.editorial == null && score.structural != null) {
        repairs.push(`Nulled ${score.section}.structural (editorial was null — primary channel required)`);
        score.structural = null;
        score.final = null;
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

  // Range-clamp supplementary signal sub-fields (parity with lite eval validation)
  const clamp01 = (obj: any, field: string, label: string) => {
    if (obj?.[field] != null && typeof obj[field] === 'number') {
      if (obj[field] < 0.0 || obj[field] > 1.0) {
        const orig = obj[field];
        obj[field] = Math.max(0.0, Math.min(1.0, obj[field]));
        repairs.push(`Clamped ${label}: ${orig} → ${obj[field]}`);
      }
    }
  };
  const clampPM1 = (obj: any, field: string, label: string) => {
    if (obj?.[field] != null && typeof obj[field] === 'number') {
      if (obj[field] < -1.0 || obj[field] > 1.0) {
        const orig = obj[field];
        obj[field] = Math.max(-1.0, Math.min(1.0, obj[field]));
        repairs.push(`Clamped ${label}: ${orig} → ${obj[field]}`);
      }
    }
  };
  clamp01(parsed.epistemic_quality, 'eq_score', 'epistemic_quality.eq_score');
  clamp01(parsed.solution_orientation, 'so_score', 'solution_orientation.so_score');
  clamp01(parsed.transparency_disclosure, 'td_score', 'transparency_disclosure.td_score');
  clamp01(parsed.stakeholder_representation, 'sr_score', 'stakeholder_representation.sr_score');
  clampPM1(parsed.emotional_tone, 'valence', 'emotional_tone.valence');
  clamp01(parsed.emotional_tone, 'arousal', 'emotional_tone.arousal');
  clamp01(parsed.emotional_tone, 'dominance', 'emotional_tone.dominance');

  return { valid: errors.length === 0, errors, warnings, repairs };
}

/** Convert a lite integer score (0-100 or float [-1,+1]) to normalized [-1,+1]. */
function convertLiteScore(
  value: any,
  fieldName: string,
  isIntegerFormat: boolean,
  repairs: string[],
): number | null {
  if (value == null) return null;
  if (isIntegerFormat || (typeof value === 'number' && value > 1.0)) {
    // Integer 0-100 format: normalize to [-1, +1] via (score - 50) / 50
    if (typeof value !== 'number') {
      const num = parseFloat(value);
      value = (!isNaN(num) && isFinite(num)) ? num : null;
      if (value !== null) repairs.push(`Coerced ${fieldName} to number: ${value}`);
    }
    if (value !== null) {
      const raw = value;
      const clamped = Math.max(0, Math.min(100, raw));
      value = Math.round(((clamped - 50) / 50) * 1000) / 1000;
      if (clamped !== raw) {
        repairs.push(`Clamped+normalized ${fieldName} integer ${raw} \u2192 ${clamped} \u2192 ${value}`);
      }
    }
    return value;
  } else {
    // Float format: clamp to [-1, +1]
    if (typeof value !== 'number') {
      const num = parseFloat(value);
      if (!isNaN(num) && isFinite(num)) {
        value = Math.max(-1.0, Math.min(1.0, num));
        repairs.push(`Coerced ${fieldName} to number: ${value}`);
      } else {
        repairs.push(`Set ${fieldName} to null (was non-numeric)`);
        return null;
      }
    } else if (value < -1.0 || value > 1.0) {
      const original = value;
      value = Math.max(-1.0, Math.min(1.0, value));
      repairs.push(`Clamped ${fieldName}: ${original} \u2192 ${value}`);
    }
    return value;
  }
}

export function validateLiteEvalResponse(parsed: any): ValidationResult {
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

  // Detect integer format: lite-1.4+ uses 0-100 scale
  // Accept 'lite-1.4', 'light-1.4', 'lite-1.5', 'lite-1.6' as integer format
  const isV14Plus = ['lite-1.4', 'light-1.4', 'lite-1.5', 'lite-1.6'].includes(parsed.schema_version);
  const isV15 = parsed.schema_version === 'lite-1.5';
  const isV16 = parsed.schema_version === 'lite-1.6';
  const couldBeInteger = typeof ev.editorial === 'number' && ev.editorial > 1.0;
  const integerFormat = isV14Plus || couldBeInteger;

  // Editorial score
  ev.editorial = convertLiteScore(ev.editorial, 'editorial', integerFormat, repairs);

  // Structural score (lite-1.5 and earlier)
  if (ev.structural != null && !isV16) {
    ev.structural = convertLiteScore(ev.structural, 'structural', integerFormat, repairs);
  } else if (isV15 && ev.structural == null) {
    // lite-1.5 response missing structural — warn, degrade to editorial-only
    warnings.push('lite-1.5 response missing structural score — falling back to editorial-only');
    ev.structural = null;
  }
  // If structural appears in a lite-1.4 response, accept it (free data)

  // TQ binary indicators (lite-1.6+): replace structural with countable transparency checks
  parsed.tq_score = null;
  if (isV16) {
    const TQ_FIELDS = ['tq_author', 'tq_date', 'tq_sources', 'tq_corrections', 'tq_conflicts'] as const;
    let tqSum = 0;
    for (const field of TQ_FIELDS) {
      const raw = ev[field];
      let val = 0;
      if (raw === 1 || raw === true) val = 1;
      else if (raw === 0 || raw === false) val = 0;
      else {
        repairs.push(`${field} missing/invalid — defaulting to 0`);
      }
      ev[field] = val;
      tqSum += val;
    }
    const tqScore = tqSum / 5;
    parsed.tq_score = Math.round(tqScore * 1000) / 1000;
    // Inject as structural proxy: maps [0,1] → [-1,+1] so computeLiteAggregates() works unchanged
    // 0/5 → -1.0 (opaque), 2-3/5 → ≈0 (neutral), 5/5 → +1.0 (fully transparent)
    ev.structural = tqScore * 2 - 1;
  }

  // Validate reasoning field (lite-1.4+): optional, discard if malformed
  if (parsed.reasoning !== null && parsed.reasoning !== undefined) {
    if (typeof parsed.reasoning !== 'string') {
      parsed.reasoning = null;
    } else if (parsed.reasoning.length > 120) {
      parsed.reasoning = parsed.reasoning.slice(0, 120);
      repairs.push('Truncated reasoning to 120 chars');
    }
  }

  // Editorial is required for lite evals
  if (ev.editorial == null) {
    errors.push('Editorial score is null \u2014 no data to score');
  }

  // Flag suspect lazy neutral: editorial=50 (converts to 0.0) with high confidence
  // This pattern indicates model defaulting to safe center rather than evaluating UDHR signals
  if (ev.editorial === 0 && typeof ev.confidence === 'number' && ev.confidence >= 0.7) {
    warnings.push(`Suspect lazy neutral: editorial=0.0 with confidence=${ev.confidence} \u2014 model may be defaulting to center`);
  }

  // Flag suspect lazy neutral on structural dimension (lite-1.5 and earlier only — TQ can't be lazy-neutral)
  if (!isV16 && ev.structural === 0 && typeof ev.confidence === 'number' && ev.confidence >= 0.7) {
    warnings.push(`Suspect lazy neutral: structural=0.0 with confidence=${ev.confidence} \u2014 model may be defaulting to center`);
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
  if (ev.confidence == null || typeof ev.confidence !== 'number') {
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
        parsed[field] = (!isNaN(num) && isFinite(num)) ? Math.max(0.0, Math.min(1.0, num)) : null;
        repairs.push(`Coerced ${field} to ${parsed[field]}`);
      } else {
        parsed[field] = Math.max(0.0, Math.min(1.0, parsed[field]));
      }
    }
  }

  // Emotional tone scalars (lite-1.3+) — clamp ranges if present
  if (parsed.valence !== null && parsed.valence !== undefined) {
    if (typeof parsed.valence !== 'number') {
      const num = parseFloat(parsed.valence);
      parsed.valence = (!isNaN(num) && isFinite(num)) ? Math.max(-1.0, Math.min(1.0, num)) : null;
      repairs.push(`Coerced valence to ${parsed.valence}`);
    } else {
      parsed.valence = Math.max(-1.0, Math.min(1.0, parsed.valence));
    }
  }
  if (parsed.arousal !== null && parsed.arousal !== undefined) {
    if (typeof parsed.arousal !== 'number') {
      const num = parseFloat(parsed.arousal);
      parsed.arousal = (!isNaN(num) && isFinite(num)) ? Math.max(0.0, Math.min(1.0, num)) : null;
      repairs.push(`Coerced arousal to ${parsed.arousal}`);
    } else {
      parsed.arousal = Math.max(0.0, Math.min(1.0, parsed.arousal));
    }
  }

  return { valid: errors.length === 0, errors, warnings, repairs };
}

// --- Lite Aggregates ---

export interface LiteAggregates {
  weighted_mean: number;
  editorial_mean: number | null;
  structural_mean: number | null;
  setl: number | null;
  classification: string;
}

export function computeLiteAggregates(lite: LiteEvalResponse): LiteAggregates {
  const e = lite.evaluation.editorial;
  const s = lite.evaluation.structural;
  const editorialMean = (e != null) ? Math.max(-1.0, Math.min(1.0, e)) : null;
  const structuralMean = (s != null) ? Math.max(-1.0, Math.min(1.0, s)) : null;

  let weightedMean: number;
  let setl: number | null = null;

  if (editorialMean != null && structuralMean != null) {
    // Two-dimension: blend using content-type weights
    const ct = lite.evaluation.content_type?.toUpperCase() || 'MX';
    const [wE, wS] = CONTENT_TYPE_WEIGHTS[ct] || CONTENT_TYPE_WEIGHTS['MX'];
    weightedMean = wE * editorialMean + wS * structuralMean;

    // Compute SETL using the same function as full evals
    setl = computeSetl([{ editorial: editorialMean, structural: structuralMean }]);
  } else {
    // Editorial-only (lite-1.4 behavior)
    weightedMean = editorialMean ?? 0;
  }

  // Clamp and round
  weightedMean = Math.max(-1.0, Math.min(1.0, weightedMean));
  weightedMean = Math.round(weightedMean * 1000) / 1000;

  // Classify using same buckets as full eval (exclusive upper bound, edge-case clamp)
  let classification = 'Neutral';
  if (weightedMean >= 1.0) {
    classification = 'Strong positive';
  } else if (weightedMean <= -1.0) {
    classification = 'Strong negative';
  } else {
    for (const c of CLASSIFICATIONS) {
      if (weightedMean >= c.min && weightedMean < c.max) {
        classification = c.label;
        break;
      }
    }
  }

  return {
    weighted_mean: weightedMean,
    editorial_mean: editorialMean,
    structural_mean: structuralMean,
    setl,
    classification,
  };
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
    // Reject binary content-types before consuming the body
    const contentType = res.headers.get('content-type') ?? '';
    const ct = contentType.split(';')[0].trim().toLowerCase();
    const BINARY_PREFIXES = ['application/pdf', 'application/zip', 'application/x-tar',
      'application/gzip', 'application/octet-stream', 'application/x-7z',
      'application/x-rar', 'video/', 'audio/'];
    if (BINARY_PREFIXES.some(p => ct.startsWith(p))) {
      return `[error:binary] Content-Type: ${ct} for ${url}`;
    }

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
