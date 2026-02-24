/**
 * Cron Worker v2: Smart diff-based HN fetching + HRCB evaluation.
 *
 * Changes from v1:
 * - Fetches topstories + askstories + showstories (3 list calls)
 * - Diffs against DB — only fetches details for genuinely new items
 * - Tags stories with hn_type (story/ask/show) from API source
 * - Stores hn_text for self-posts, evaluates them directly
 * - Refreshes hn_score/hn_comments via /updates endpoint
 * - Uses prompt caching (system prompt as cached block)
 * - Daily budget cap on evaluations
 *
 * Net: ~5 HTTP calls/cycle instead of ~200. Self-posts no longer skipped.
 */

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  DAILY_EVAL_BUDGET?: string;
}

interface HNItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  text?: string;
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

const EVAL_MODEL = 'claude-haiku-4-5-20251001';

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

// --- Helpers ---

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

async function fetchUrlContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
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
    return text.slice(0, 30000);
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateContent(
  apiKey: string,
  url: string,
  content: string,
  isSelfPost: boolean
): Promise<EvalResult> {
  const today = new Date().toISOString().slice(0, 10);
  const contentLabel = isSelfPost
    ? 'Here is the self-post text from Hacker News:'
    : 'Here is the page content (truncated):';

  const userMessage = `Evaluate this URL: ${url}

${contentLabel}

${content}

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
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: METHODOLOGY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
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

  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonText) as EvalResult;
}

async function writeEvalResult(db: D1Database, hnId: number, result: EvalResult): Promise<void> {
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
        eval_status = 'done',
        eval_error = NULL,
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
      EVAL_MODEL,
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

async function markFailed(db: D1Database, hnId: number, error: string): Promise<void> {
  await db
    .prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`)
    .bind(error.slice(0, 500), hnId)
    .run();
}

async function markSkipped(db: D1Database, hnId: number, reason: string): Promise<void> {
  await db
    .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = ? WHERE hn_id = ?`)
    .bind(reason, hnId)
    .run();
}

// --- Main cron handler ---

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = env.DB;
    const apiKey = env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return;
    }

    // Budget check
    const dailyBudget = parseInt(env.DAILY_EVAL_BUDGET || '50', 10);
    const todayCount = await db
      .prepare(`SELECT COUNT(*) as cnt FROM stories WHERE eval_status = 'done' AND evaluated_at >= date('now')`)
      .first<{ cnt: number }>();
    const evalsToday = todayCount?.cnt ?? 0;

    if (evalsToday >= dailyBudget) {
      console.log(`Daily budget reached: ${evalsToday}/${dailyBudget}. Skipping.`);
      return;
    }

    const remainingBudget = dailyBudget - evalsToday;
    console.log(`Budget: ${evalsToday}/${dailyBudget}, ${remainingBudget} remaining`);

    // ─── STEP 1: Fetch story ID lists from HN API (3 calls) ───

    let topIds: number[] = [];
    let askIds: number[] = [];
    let showIds: number[] = [];

    try {
      [topIds, askIds, showIds] = await Promise.all([
        fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json'),
        fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/askstories.json'),
        fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/showstories.json'),
      ]);
    } catch (err) {
      console.error('Failed to fetch HN story lists:', err);
      return;
    }

    // Build type map: which list(s) each ID appeared in
    const typeMap = new Map<number, string>();
    for (const id of topIds) typeMap.set(id, 'story');
    for (const id of showIds) typeMap.set(id, 'show'); // override if in both
    for (const id of askIds) typeMap.set(id, 'ask');    // ask takes priority

    const allIds = [...new Set([...topIds.slice(0, 200), ...askIds, ...showIds])];
    console.log(`HN lists: ${topIds.length} top, ${askIds.length} ask, ${showIds.length} show → ${allIds.length} unique`);

    // ─── STEP 2: Diff against DB — find genuinely new IDs ───

    const { results: existingRows } = await db
      .prepare(
        `SELECT hn_id FROM stories WHERE hn_id IN (${allIds.map(() => '?').join(',')})`,
      )
      .bind(...allIds)
      .all<{ hn_id: number }>();

    const existingIds = new Set(existingRows.map((r) => r.hn_id));
    const newIds = allIds.filter((id) => !existingIds.has(id));
    console.log(`${newIds.length} new stories to fetch (${existingIds.size} already in DB)`);

    // ─── STEP 3: Fetch details only for new IDs ───

    let insertedCount = 0;
    // Fetch in parallel batches of 20
    for (let i = 0; i < newIds.length; i += 20) {
      const batch = newIds.slice(i, i + 20);
      const items = await Promise.all(
        batch.map(async (id): Promise<HNItem | null> => {
          try {
            return await fetchJson<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          } catch {
            return null;
          }
        })
      );

      const stmts = items
        .filter((item): item is HNItem => item !== null && item.type === 'story' && !!item.title)
        .map((item) => {
          const domain = item.url ? extractDomain(item.url) : null;
          const hnType = typeMap.get(item.id) || 'story';
          return db
            .prepare(
              `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
            )
            .bind(
              item.id,
              item.url || null,
              item.title || 'Untitled',
              domain,
              item.score || null,
              item.descendants || null,
              item.by || null,
              item.time || Math.floor(Date.now() / 1000),
              hnType,
              item.text || null
            );
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        insertedCount += stmts.length;
      }
    }
    console.log(`Inserted ${insertedCount} new stories`);

    // ─── STEP 4: Refresh scores/comments via /updates ───

    try {
      const updates = await fetchJson<{ items: number[]; profiles: string[] }>(
        'https://hacker-news.firebaseio.com/v0/updates.json'
      );

      // Only refresh items we have in our DB
      const updateIds = updates.items.filter((id) => existingIds.has(id));
      if (updateIds.length > 0) {
        // Fetch updated items in parallel (max 20)
        const toRefresh = updateIds.slice(0, 20);
        const refreshed = await Promise.all(
          toRefresh.map(async (id): Promise<HNItem | null> => {
            try {
              return await fetchJson<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            } catch {
              return null;
            }
          })
        );

        const refreshStmts = refreshed
          .filter((item): item is HNItem => item !== null)
          .map((item) =>
            db
              .prepare(`UPDATE stories SET hn_score = ?, hn_comments = ? WHERE hn_id = ?`)
              .bind(item.score || null, item.descendants || null, item.id)
          );

        if (refreshStmts.length > 0) {
          await db.batch(refreshStmts);
          console.log(`Refreshed scores for ${refreshStmts.length} stories`);
        }
      }
    } catch (err) {
      console.error('Score refresh failed (non-fatal):', err);
    }

    // ─── STEP 5: Evaluate pending stories ───

    const batchSize = Math.min(5, remainingBudget);
    // Fetch pending stories — now includes self-posts (url IS NULL but hn_text IS NOT NULL)
    const { results: pending } = await db
      .prepare(
        `SELECT * FROM stories
         WHERE eval_status = 'pending'
           AND (url IS NOT NULL OR hn_text IS NOT NULL)
         ORDER BY hn_time DESC LIMIT ?`
      )
      .bind(batchSize)
      .all<{
        hn_id: number;
        url: string | null;
        title: string;
        hn_text: string | null;
      }>();

    console.log(`${pending.length} pending stories to evaluate`);

    for (const story of pending) {
      console.log(`Evaluating: ${story.title}`);

      await db
        .prepare(`UPDATE stories SET eval_status = 'evaluating' WHERE hn_id = ?`)
        .bind(story.hn_id)
        .run();

      try {
        const isSelfPost = !story.url && !!story.hn_text;
        const evalUrl = story.url || `https://news.ycombinator.com/item?id=${story.hn_id}`;

        // Skip binary content
        if (story.url && (story.url.includes('.pdf') || story.url.includes('.zip') || story.url.includes('.tar'))) {
          await markSkipped(db, story.hn_id, 'Binary/unsupported content type');
          continue;
        }

        let content: string;

        if (isSelfPost) {
          // Use HN text directly — no HTTP fetch needed
          content = story.hn_text!;
        } else {
          // Fetch page content
          try {
            content = await fetchUrlContent(story.url!);
          } catch (err) {
            await markFailed(db, story.hn_id, `Fetch failed: ${err}`);
            continue;
          }
        }

        if (content.length < 50) {
          await markSkipped(db, story.hn_id, 'Content too short');
          continue;
        }

        const result = await evaluateContent(apiKey, evalUrl, content, isSelfPost);
        await writeEvalResult(db, story.hn_id, result);

        console.log(`Done: ${story.title} → ${result.aggregates.classification} (${result.aggregates.weighted_mean})`);
      } catch (err) {
        console.error(`Failed: ${story.title}:`, err);
        await markFailed(db, story.hn_id, `${err}`);
      }
    }

    // Skip self-posts with no text AND no URL (truly empty)
    await db
      .prepare(
        `UPDATE stories SET eval_status = 'skipped', eval_error = 'No URL and no text'
         WHERE eval_status = 'pending' AND url IS NULL AND (hn_text IS NULL OR LENGTH(hn_text) < 50)`
      )
      .run();

    console.log('Cron cycle complete');
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/trigger') {
      ctx.waitUntil(
        this.scheduled({ scheduledTime: Date.now(), cron: '*/10 * * * *' } as ScheduledEvent, env, ctx)
      );
      return new Response('Cron triggered', { status: 200 });
    }
    return new Response('HN HRCB Cron Worker v2', { status: 200 });
  },
};
