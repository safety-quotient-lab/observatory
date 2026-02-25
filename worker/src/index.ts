/**
 * Cron Worker: Fetches HN top stories, evaluates pending ones via Claude Haiku,
 * and writes results to D1.
 *
 * Triggered by Cloudflare cron every 10 minutes.
 * Can also be invoked manually via /trigger endpoint.
 *
 * Design: stays well within Workers' 30s CPU time limit by:
 * - Batch-checking existing IDs with a single D1 query
 * - Fetching only new HN items (in parallel batches of 10)
 * - Evaluating only 2 stories per cycle
 * - Resetting stuck "evaluating" stories older than 5 minutes
 */

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
}

interface HNItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  by?: string;
  time?: number;
}

interface EvalScore {
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

interface EvalResult {
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

const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

const METHODOLOGY_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Your task is to assess the content of any URL provided by the user against the Universal Declaration of Human Rights (UDHR), following the methodology below exactly. As a Fair Witness, you report only what you directly observe — no inference beyond the evidence, no assumptions, no editorializing.

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
      "note": "<text>",
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
  },
  "l2_scores": [],
  "adversarial_gap": { "per_article": [], "mean_ag": null, "ag_coverage": 0, "ag_classification": null }
}`;

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchHNTopStories(): Promise<number[]> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!res.ok) throw new Error(`HN API error: ${res.status}`);
  return (await res.json()) as number[];
}

async function fetchHNItem(id: number): Promise<HNItem | null> {
  const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
  if (!res.ok) return null;
  return (await res.json()) as HNItem;
}

async function fetchUrlContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'HN-HRCB-Bot/1.0 (UDHR evaluation research)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const text = await res.text();
    // Truncate to ~30k chars to stay within token limits
    return text.slice(0, 30000);
  } finally {
    clearTimeout(timeout);
  }
}

const EVAL_MODEL = 'claude-haiku-4-5-20251001';

interface EvalCallResult {
  result: EvalResult;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  promptHash: string;
}

async function hashPrompt(system: string, user: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(system + '\n---\n' + user);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function evaluateUrl(apiKey: string, url: string, pageContent: string): Promise<EvalCallResult> {
  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `Evaluate this URL: ${url}

Here is the page content (truncated):

${pageContent}

Today's date: ${today}

Output ONLY the JSON evaluation object, no other text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      max_tokens: 10240,
      system: METHODOLOGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text in API response');

  // Try to parse the JSON response (may have markdown fences)
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const promptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT, userPrompt);

  return {
    result: JSON.parse(jsonText) as EvalResult,
    model: EVAL_MODEL,
    systemPrompt: METHODOLOGY_SYSTEM_PROMPT,
    userPrompt,
    promptHash,
  };
}

async function insertStory(db: D1Database, item: HNItem): Promise<void> {
  const domain = item.url ? extractDomain(item.url) : null;
  await db
    .prepare(
      `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, eval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .bind(
      item.id,
      item.url || null,
      item.title || 'Untitled',
      domain,
      item.score || null,
      item.descendants || null,
      item.by || null,
      item.time || Math.floor(Date.now() / 1000)
    )
    .run();
}

async function writeEvalResult(db: D1Database, hnId: number, evalCall: EvalCallResult): Promise<void> {
  const { result, model, systemPrompt, userPrompt, promptHash } = evalCall;
  const agg = result.aggregates;

  // Update story with evaluation results + provenance
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
        eval_system_prompt = ?,
        eval_user_prompt = ?,
        eval_status = 'done',
        evaluated_at = datetime('now')
       WHERE hn_id = ?`
    )
    .bind(
      result.evaluation.content_type.primary,
      agg.weighted_mean,
      agg.classification,
      agg.signal_sections,
      agg.nd_count,
      JSON.stringify(result),
      model,
      promptHash,
      systemPrompt,
      userPrompt,
      hnId
    )
    .run();

  // Insert score rows
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

  // Batch execute score inserts
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

async function markFailed(db: D1Database, hnId: number, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`
    )
    .bind(error.slice(0, 500), hnId)
    .run();
}

async function markSkipped(db: D1Database, hnId: number, reason: string): Promise<void> {
  await db
    .prepare(
      `UPDATE stories SET eval_status = 'skipped', eval_error = ? WHERE hn_id = ?`
    )
    .bind(reason, hnId)
    .run();
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const db = env.DB;
    const apiKey = env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return;
    }

    // Step 0: Reset stuck "evaluating" stories (older than 5 min)
    await db
      .prepare(
        `UPDATE stories SET eval_status = 'pending'
         WHERE eval_status = 'evaluating'
         AND evaluated_at IS NULL
         AND created_at < datetime('now', '-5 minutes')`
      )
      .run();
    // Also catch ones that just got stuck without timestamp
    await db
      .prepare(
        `UPDATE stories SET eval_status = 'pending'
         WHERE eval_status = 'evaluating'`
      )
      .run();

    // Step 1: Fetch top story IDs from HN (single API call)
    console.log('Fetching HN top stories...');
    let topIds: number[];
    try {
      topIds = await fetchHNTopStories();
    } catch (err) {
      console.error('Failed to fetch HN top stories:', err);
      return;
    }

    // Step 2: Check which IDs already exist in D1 (chunk into batches of 50 for query limits)
    const existingIds = new Set<number>();
    for (let i = 0; i < topIds.length; i += 50) {
      const chunk = topIds.slice(i, i + 50);
      const { results: existing } = await db
        .prepare(
          `SELECT hn_id FROM stories WHERE hn_id IN (${chunk.map(() => '?').join(',')})`
        )
        .bind(...chunk)
        .all<{ hn_id: number }>();
      for (const r of existing) existingIds.add(r.hn_id);
    }

    const newIds = topIds.filter((id) => !existingIds.has(id));
    console.log(`${newIds.length} new stories to fetch from HN (${topIds.length} total)`);

    // Step 3: Fetch only NEW items from HN API (parallel batches of 10)
    for (let i = 0; i < newIds.length; i += 10) {
      const batch = newIds.slice(i, i + 10);
      const items = await Promise.all(batch.map((id) => fetchHNItem(id)));
      for (const item of items) {
        if (item && item.type === 'story' && item.title) {
          await insertStory(db, item);
        }
      }
    }

    // Update scores/comments for top 30 existing stories
    const existingTop = topIds.filter((id) => existingIds.has(id)).slice(0, 30);
    for (let i = 0; i < existingTop.length; i += 10) {
      const batch = existingTop.slice(i, i + 10);
      const items = await Promise.all(batch.map((id) => fetchHNItem(id)));
      for (const item of items) {
        if (item) {
          await db
            .prepare(
              `UPDATE stories SET hn_score = ?, hn_comments = ? WHERE hn_id = ?`
            )
            .bind(item.score || null, item.descendants || null, item.id)
            .run();
        }
      }
    }

    // Step 4: Pick 3 pending stories to evaluate
    const { results: pending } = await db
      .prepare(
        `SELECT hn_id, url, title FROM stories
         WHERE eval_status = 'pending'
         ORDER BY hn_time DESC LIMIT 3`
      )
      .all<{ hn_id: number; url: string | null; title: string }>();

    console.log(`${pending.length} stories to evaluate this cycle`);

    // Step 5: Evaluate each
    for (const story of pending) {
      const url = story.url || `https://news.ycombinator.com/item?id=${story.hn_id}`;
      console.log(`Evaluating: ${story.title} (${url})`);

      // Mark as evaluating
      await db
        .prepare(`UPDATE stories SET eval_status = 'evaluating' WHERE hn_id = ?`)
        .bind(story.hn_id)
        .run();

      try {
        // Skip binary/unsupported content types
        if (url.includes('.pdf') || url.includes('.zip') || url.includes('.tar')) {
          await markSkipped(db, story.hn_id, 'Binary/unsupported content type');
          continue;
        }

        // Fetch page content
        let pageContent: string;
        try {
          pageContent = await fetchUrlContent(url);
        } catch (err) {
          await markFailed(db, story.hn_id, `Fetch failed: ${err}`);
          continue;
        }

        if (pageContent.length < 100) {
          await markSkipped(db, story.hn_id, 'Page content too short');
          continue;
        }

        // Call Claude Haiku for evaluation
        const evalCall = await evaluateUrl(apiKey, url, pageContent);

        // Write results to D1
        await writeEvalResult(db, story.hn_id, evalCall);
        console.log(`Done: ${story.title} → ${evalCall.result.aggregates.classification} (${evalCall.result.aggregates.weighted_mean})`);
      } catch (err) {
        const errStr = `${err}`;
        console.error(`Failed to evaluate ${story.title}:`, err);
        // Rate limit errors: reset to pending so they retry next cycle
        if (errStr.includes('429') || errStr.includes('rate_limit')) {
          console.log('Rate limited — resetting to pending for retry');
          await db
            .prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ?`)
            .bind(story.hn_id)
            .run();
          break; // Stop evaluating this cycle, we're rate limited
        }
        await markFailed(db, story.hn_id, errStr);
      }
    }

    console.log('Cron cycle complete');
  },

  // HTTP handler for manual triggering
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/trigger') {
      ctx.waitUntil(
        this.scheduled({ scheduledTime: Date.now(), cron: '*/10 * * * *' } as ScheduledEvent, env, ctx)
      );
      return new Response('Cron triggered', { status: 200 });
    }
    return new Response('HN HRCB Cron Worker', { status: 200 });
  },
};
