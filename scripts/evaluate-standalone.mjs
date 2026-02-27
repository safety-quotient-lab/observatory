#!/usr/bin/env node
/**
 * Standalone HRCB evaluator for gray-box.
 *
 * Fetches pending stories from the production queue, evaluates them via Claude,
 * and POSTs results back to the production ingest endpoint.
 *
 * Usage:
 *   node evaluate-standalone.mjs [options]
 *
 * Options:
 *   --limit N         Max stories to evaluate per run (default: 10)
 *   --url <url>       Evaluate a single URL (requires --hn-id)
 *   --hn-id <id>      HN item ID for single URL mode
 *   --dry-run         Evaluate but don't POST results
 *
 * Environment variables (set in .env or export):
 *   INGEST_URL           Base URL of the production site, e.g. https://hn-hrcb.pages.dev
 *   INGEST_SECRET        Value of TRIGGER_SECRET (used for /api/queue and /api/ingest)
 *
 * Uses: claude -p (Claude Code CLI) — no API key needed, uses your subscription.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { dirname, join } from 'path';

// --- Load .env if present ---
const envPath = new URL('../site/.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

// Also try .dev.vars (wrangler local secrets)
const devVarsPath = new URL('../site/.dev.vars', import.meta.url).pathname;
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

const INGEST_URL = (process.env.INGEST_URL ?? '').replace(/\/$/, '');
const INGEST_SECRET = process.env.INGEST_SECRET ?? process.env.TRIGGER_SECRET;
const MODEL_ID = 'claude-haiku-4-5';
const PROVIDER = 'claude-code-standalone';

// Resolve claude binary — prefer sibling of current node binary (nvm layout)
const CLAUDE_BIN = join(dirname(process.execPath), 'claude');
const RAW_HTML_MAX_CHARS = 30_000;

// Light prompt — inlined from prompts.ts METHODOLOGY_SYSTEM_PROMPT_LIGHT
const LIGHT_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score the AUTHOR'S EDITORIAL STANCE toward human rights, not the subject matter.

Score scale: [-1.0, +1.0]. Key rules:
- Exposing abuses → positive; promoting/justifying abuses → negative
- 0.0 ONLY for content with zero UDHR relevance (pure tech tutorial, math paper, product changelog)
- Use the full range; most content scores non-zero

Anchors: −1.0 dehumanizing propaganda | 0.0 zero rights relevance | +1.0 NGO rights advocacy

Content types (use code): ED=Editorial, PO=Policy/Legal, LP=Landing Page, PR=Product/Feature, MI=Mission/Values, HR=Human Rights Specific, CO=Community/Forum, MX=Mixed (default)

Evidence strength: H=explicit rights discussion | M=implicit | L=tangential

Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "light-1.2",
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
  "short_description": "<one sentence, max 20 words>",
  "eq_score": <0.0 to 1.0>,
  "so_score": <0.0 to 1.0>,
  "td_score": <0.0 to 1.0>,
  "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>"
}`;

if (!INGEST_URL) { console.error('Missing INGEST_URL'); process.exit(1); }
if (!INGEST_SECRET) { console.error('Missing INGEST_SECRET (or TRIGGER_SECRET)'); process.exit(1); }
if (!existsSync(CLAUDE_BIN)) { console.error(`claude binary not found at ${CLAUDE_BIN}`); process.exit(1); }

// --- CLI args ---
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}
const limit = parseInt(argVal('--limit') ?? '10');
const singleUrl = argVal('--url');
const singleHnId = parseInt(argVal('--hn-id') ?? '0');
const dryRun = args.includes('--dry-run');
const mode = argVal('--mode') ?? 'full'; // 'full' | 'light'
const concurrency = parseInt(argVal('--concurrency') ?? '3');
if (mode !== 'full' && mode !== 'light') {
  console.error(`Invalid --mode "${mode}". Must be "full" or "light".`);
  process.exit(1);
}

// --- Load full system prompt from methodology file ---
const methodologyPath = new URL('../methodology-v3.4.txt', import.meta.url).pathname;
let FULL_SYSTEM_PROMPT;
if (existsSync(methodologyPath)) {
  const raw = readFileSync(methodologyPath, 'utf8');
  FULL_SYSTEM_PROMPT = raw.startsWith('You are') ? raw : buildFallbackPrompt();
} else {
  FULL_SYSTEM_PROMPT = buildFallbackPrompt();
}

function buildFallbackPrompt() {
  return `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Evaluate the URL provided against the UDHR. Output ONLY a JSON object matching the HRCB evaluation schema (schema_version, evaluation, domain_context_profile, scores array with 31 entries for Preamble + Articles 1-30, supplementary signals, theme_tag, sentiment_tag, executive_summary).`;
}

const SYSTEM_PROMPT = mode === 'light' ? LIGHT_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT;
const METHODOLOGY_HASH = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 32);

// --- Helpers ---

async function fetchContent(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'HN-HRCB-Bot/1.0 (UDHR evaluation research)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
    });
    const text = await res.text();
    return text.slice(0, RAW_HTML_MAX_CHARS);
  } catch (err) {
    return `[error:fetch_error] Could not fetch ${url}: ${err.message}`;
  }
}

function buildUserMessage(url, content) {
  const today = new Date().toISOString().slice(0, 10);
  return `Evaluate this URL: ${url}

Here is the page content (truncated):

${content}

Today's date: ${today}

Output ONLY the JSON evaluation object, no other text.`;
}

function extractJson(raw) {
  let text = raw.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON object found in response');
  return text.slice(first, last + 1);
}

function callClaudeCode(userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '-p',
      '--model', MODEL_ID,
      '--system-prompt', SYSTEM_PROMPT,
      '--no-session-persistence',
      '--output-format', 'text',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.stdin.write(userMessage);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude -p timed out after 120s'));
    }, 120_000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve({ text: stdout, inputTokens: 0, outputTokens: 0 });
      }
    });
  });
}

function hashPrompt(systemPrompt, userMessage) {
  return createHash('sha256')
    .update(systemPrompt + '\n---\n' + userMessage)
    .digest('hex')
    .slice(0, 32);
}

async function fetchQueue(limit) {
  const res = await fetch(`${INGEST_URL}/api/queue?limit=${limit}&provider=${encodeURIComponent(PROVIDER)}`, {
    headers: { 'Authorization': `Bearer ${INGEST_SECRET}` },
  });
  if (!res.ok) throw new Error(`Queue fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.stories ?? [];
}

async function postIngest(hnId, result, modelId, provider, promptHash, inputTokens, outputTokens) {
  const res = await fetch(`${INGEST_URL}/api/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${INGEST_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hn_id: hnId,
      model_id: modelId,
      provider,
      prompt_mode: mode,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      prompt_hash: promptHash,
      methodology_hash: METHODOLOGY_HASH,
      result,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Ingest failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// --- Main evaluation loop ---

async function evaluateOne(hnId, url) {
  console.log(`  Fetching content from ${url}`);
  const content = await fetchContent(url);

  const userMessage = buildUserMessage(url, content);
  const promptHash = hashPrompt(SYSTEM_PROMPT, userMessage);

  console.log(`  Calling claude -p (${MODEL_ID})...`);
  const { text, inputTokens, outputTokens } = await callClaudeCode(userMessage);

  const jsonText = extractJson(text);
  const slim = JSON.parse(jsonText);

  if (dryRun) {
    console.log(`  [dry-run] Would POST result for hn_id=${hnId}`);
    console.log(`  weighted_mean preview: ${slim.evaluation?.hcb_weighted_mean ?? '(computed server-side)'}`);
    return;
  }

  const result = await postIngest(hnId, slim, MODEL_ID, PROVIDER, promptHash, inputTokens, outputTokens);
  console.log(`  ✓ Ingested: weighted_mean=${result.weighted_mean?.toFixed(3)}, classification=${result.classification}`);
  if (result.repairs?.length > 0) {
    console.log(`  Repairs: ${result.repairs.join('; ')}`);
  }
}

async function main() {
  console.log(`HRCB Standalone Evaluator — model: ${MODEL_ID} — mode: ${mode} — concurrency: ${concurrency}`);
  console.log(`Target: ${INGEST_URL}${dryRun ? ' [DRY RUN]' : ''}\n`);

  if (singleUrl && singleHnId) {
    console.log(`Single URL mode: hn_id=${singleHnId} url=${singleUrl}`);
    await evaluateOne(singleHnId, singleUrl);
    return;
  }

  console.log(`Fetching up to ${limit} pending stories from queue...`);
  const stories = await fetchQueue(limit);
  console.log(`Got ${stories.length} stories to evaluate.\n`);

  if (stories.length === 0) {
    console.log('Queue is empty — nothing to do.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let total = 0;

  // Process in parallel chunks of `concurrency`
  for (let i = 0; i < stories.length; i += concurrency) {
    const chunk = stories.slice(i, i + concurrency);
    console.log(`--- Chunk ${Math.floor(i / concurrency) + 1}: ${chunk.length} stories in parallel ---`);

    const results = await Promise.allSettled(
      chunk.map(story => {
        console.log(`  → hn_id=${story.hn_id} — ${story.title?.slice(0, 50)}`);
        return evaluateOne(story.hn_id, story.url);
      })
    );

    for (let j = 0; j < results.length; j++) {
      total++;
      if (results[j].status === 'fulfilled') {
        succeeded++;
      } else {
        failed++;
        console.error(`  ✗ hn_id=${chunk[j].hn_id} failed: ${results[j].reason?.message}`);
      }
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed out of ${total}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
