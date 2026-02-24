/**
 * Shared HRCB evaluation primitives.
 * Imported by both src/lib/evaluate.ts (trigger endpoint) and functions/cron.ts.
 */

import { errorSlugFromStatus, errorSlugFromException, ERROR_TYPES } from './types';

// --- Constants ---

export const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

export const EVAL_MODEL = 'claude-haiku-4-5-20251001';

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

## OUTPUT FORMAT

You MUST output a single JSON object (no markdown fences, no explanation before or after). Section names in the scores array MUST use the full word "Article" (e.g. "Article 1", "Article 19"), NOT abbreviated "Art." The JSON must follow this exact schema:

{
  "schema_version": "3.4",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": { "primary": "<CODE>", "secondary": [] },
    "channel_weights": { "editorial": <w_E>, "structural": <w_S> },
    "eval_depth": "STANDARD",
    "date": "<YYYY-MM-DD>",
    "methodology": "v3.4",
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
      "combined": <number|null>,
      "context_modifier": <number|null>,
      "final": <number|null>,
      "directionality": [...],
      "evidence": "<H|M|L|null>",
      "note": "<text>"
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
  },
  "l2_scores": [],
  "adversarial_gap": { "per_article": [], "mean_ag": null, "ag_coverage": 0, "ag_classification": null }
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
  l2_scores: unknown[];
  adversarial_gap: unknown;
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
      return `[error:${slug}] HTTP ${res.status} ${label} for ${url}\n\n${text}`.slice(0, 30000);
    }
    return text.slice(0, 30000);
  } catch (err) {
    const slug = errorSlugFromException(err);
    const label = ERROR_TYPES[slug].label;
    return `[error:${slug}] ${label} for ${url}: ${err}. The page could not be reached. This may indicate access restrictions, geo-blocking, or the site being unavailable.`;
  } finally {
    clearTimeout(timeout);
  }
}

export async function writeEvalResult(
  db: D1Database,
  hnId: number,
  result: EvalResult,
  model: string = EVAL_MODEL,
  promptHash: string | null = null
): Promise<void> {
  const agg = result.aggregates;

  await db
    .prepare(
      `UPDATE stories SET
        content_type = ?,
        hcb_weighted_mean = ?,
        hcb_classification = ?,
        hcb_signal_sections = ?,
        hcb_nd_count = ?,
        hcb_json = ?,
        eval_model = ?,
        eval_prompt_hash = ?,
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
      JSON.stringify(result),
      model,
      promptHash,
      hnId
    )
    .run();

  const stmts = result.scores.map((score) => {
    const sortOrder = ALL_SECTIONS.indexOf(score.section);
    return db
      .prepare(
        `INSERT OR REPLACE INTO scores (hn_id, section, sort_order, final, editorial, structural, evidence, directionality, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        score.note || ''
      );
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
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
