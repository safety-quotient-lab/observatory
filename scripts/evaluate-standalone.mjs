#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Standalone HRCB evaluator.
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

// Lite prompt — inlined from prompts.ts METHODOLOGY_SYSTEM_PROMPT_LITE (lite-1.5)
const LITE_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score content on TWO independent dimensions.

## DIMENSION 1: EDITORIAL (explicit rights discourse)
Does the content directly discuss, reference, or engage with human rights?
Score: integer 0-100 where 50 = neutral. Use the full range.
Tier anchors:
  90-100: Active rights advocacy — NGO missions, rights organization content, explicit UDHR promotion
  70-89: Implicitly supportive — investigative journalism exposing abuses, rights-aware policy advocacy
  55-69: Slight positive lean — acknowledges rights concerns, balanced reporting on abuses
  50: Neutral — ONLY for content with literally zero explicit rights discussion (pure math proofs, abstract algorithms, physics equations)
  31-49: Slight negative lean — dismisses relevant rights concerns, normalizes restrictions
  11-30: Implicitly hostile — justifies surveillance/censorship, dehumanizing framing
  0-10: Dehumanizing propaganda — active rights violations advocacy, hate content

CRITICAL: Reserve editorial 50 for content with zero explicit rights discussion. When uncertain between 48-52, pick 48 or 52 — never 50.

Key rules: Exposing abuses → above 50. Promoting/justifying abuses → below 50.

## DIMENSION 2: STRUCTURAL (implicit rights alignment)
Does the content embody UDHR provisions through its nature, without using rights vocabulary?
Score: integer 0-100 where 50 = neutral. Use the full range.

IMPLICIT RIGHTS SIGNALS — most tech content has these. Score structural 52-65, NOT 50:
  - Access/openness: open source, free tools, public datasets, APIs → Art. 27 (culture/science) → 55-60
  - Privacy/surveillance: data collection, tracking, encryption → Art. 12 (privacy) → direction depends on stance
  - Labor/work: hiring, remote work, layoffs, working conditions → Art. 23 (work) → 55-60
  - Transparency: open data, FOIA, disclosure, accountability → Art. 19 (expression/information) → 55-60
  - Education: tutorials making knowledge accessible, documentation → Art. 26 (education) → 53-58
  - Community: forums, shared governance, community standards → Art. 20 (assembly) → 53-55
  - Health: medical research, public health tools → Art. 25 (health) → 55-60

CRITICAL: Reserve structural 50 for content with literally zero UDHR connection. Most tech content touches access, labor, or transparency and deserves structural 52-60.

Example: An open-source tool README scores editorial 50 (no rights discourse) / structural 58 (embodies Art. 27 access).

## SCORING RULES
- Score BOTH dimensions independently. They measure different constructs.
- editorial = what the content SAYS about rights. structural = what the content IS relative to rights.
- Content can score high on one and low on the other. A surveillance company's blog about privacy law: editorial 65, structural 35.

Content types (use code): ED=Editorial, PO=Policy/Legal, LP=Landing Page, PR=Product/Feature, MI=Mission/Values, HR=Human Rights Specific, CO=Community/Forum, MX=Mixed (default)

Evidence strength: H=explicit rights discussion | M=implicit | L=tangential

Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-1.5",
  "reasoning": "<content type, editorial stance, and structural alignment in max 15 words>",
  "evaluation": {
    "url": "<url>",
    "domain": "<domain>",
    "content_type": "<CODE>",
    "editorial": <0 to 100>,
    "structural": <0 to 100>,
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
const mode = argVal('--mode') ?? 'full'; // 'full' | 'lite'
const concurrency = parseInt(argVal('--concurrency') ?? '3');
if (mode !== 'full' && mode !== 'lite' && mode !== 'light') {
  console.error(`Invalid --mode "${mode}". Must be "full" or "lite".`);
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

const SYSTEM_PROMPT = (mode === 'lite' || mode === 'light') ? LITE_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT;
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
      env: { ...process.env, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined },
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

// --- Content Gate (inline, matches site/src/lib/content-gate.ts) ---

const PAYWALL_DOMAINS = new Set([
  'bloomberg.com', 'wsj.com', 'ft.com', 'nytimes.com', 'economist.com',
  'theathletic.com', 'telegraph.co.uk', 'thetimes.co.uk', 'barrons.com',
  'hbr.org', 'foreignaffairs.com', 'foreignpolicy.com', 'theatlantic.com',
  'newyorker.com', 'wired.com', 'vanityfair.com', 'bostonglobe.com',
  'washingtonpost.com', 'latimes.com', 'sfchronicle.com', 'seattletimes.com',
  'denverpost.com', 'inquirer.com', 'startribune.com', 'chicagotribune.com',
  'baltimoresun.com', 'journalnow.com', 'businessinsider.com', 'insider.com',
  'seekingalpha.com', 'statista.com',
]);

const GATE_TITLE_PATTERNS = [
  { re: /access denied/i, cat: 'bot_protection', conf: 0.8, sig: 'Title: Access Denied' },
  { re: /just a moment/i, cat: 'bot_protection', conf: 0.85, sig: 'Title: Just a moment (Cloudflare)' },
  { re: /verify you are human/i, cat: 'captcha', conf: 0.85, sig: 'Title: Verify you are human' },
  { re: /attention required/i, cat: 'bot_protection', conf: 0.8, sig: 'Title: Attention Required' },
  { re: /you have been blocked/i, cat: 'bot_protection', conf: 0.85, sig: 'Title: You have been blocked' },
  { re: /pardon our interruption/i, cat: 'bot_protection', conf: 0.8, sig: 'Title: Pardon Our Interruption' },
  { re: /robot or human/i, cat: 'captcha', conf: 0.85, sig: 'Title: Robot or human?' },
  { re: /service unavailable/i, cat: 'error_page', conf: 0.7, sig: 'Title: Service Unavailable' },
  { re: /page not found|404/i, cat: 'error_page', conf: 0.7, sig: 'Title: Page Not Found' },
  { re: /under maintenance/i, cat: 'error_page', conf: 0.75, sig: 'Title: Under Maintenance' },
  { re: /age verification/i, cat: 'age_gate', conf: 0.8, sig: 'Title: Age Verification' },
];

const GATE_BODY_PATTERNS = [
  // Paywall
  { re: /subscribe to (read|continue|access|unlock)/i, cat: 'paywall', w: 0.3, sig: 'subscribe to read/continue' },
  { re: /premium (content|article|member|subscriber)/i, cat: 'paywall', w: 0.3, sig: 'premium content/member' },
  { re: /(paid|premium) subscription/i, cat: 'paywall', w: 0.3, sig: 'paid/premium subscription' },
  { re: /become a (member|subscriber)/i, cat: 'paywall', w: 0.3, sig: 'become a member/subscriber' },
  { re: /already a subscriber\? ?(log|sign) ?in/i, cat: 'paywall', w: 0.3, sig: 'already a subscriber? log in' },
  { re: /free articles? remaining/i, cat: 'paywall', w: 0.3, sig: 'free articles remaining' },
  { re: /this (article|content|story) is (for|available to) (paid |premium )?subscribers/i, cat: 'paywall', w: 0.35, sig: 'content for subscribers' },
  // CAPTCHA
  { re: /class="g-recaptcha"/i, cat: 'captcha', w: 0.5, sig: 'reCAPTCHA widget' },
  { re: /class="h-captcha"/i, cat: 'captcha', w: 0.5, sig: 'hCaptcha widget' },
  { re: /data-sitekey=/i, cat: 'captcha', w: 0.45, sig: 'CAPTCHA sitekey' },
  { re: /challenges\.cloudflare\.com/i, cat: 'captcha', w: 0.5, sig: 'Cloudflare challenge script' },
  { re: /verify you are (a )?human/i, cat: 'captcha', w: 0.5, sig: 'verify you are human' },
  // Bot protection
  { re: /cf-browser-verification/i, cat: 'bot_protection', w: 0.4, sig: 'Cloudflare browser verification' },
  { re: /cf-challenge/i, cat: 'bot_protection', w: 0.4, sig: 'Cloudflare challenge' },
  { re: /__cf_chl/i, cat: 'bot_protection', w: 0.4, sig: 'Cloudflare challenge token' },
  { re: /perimeterx/i, cat: 'bot_protection', w: 0.4, sig: 'PerimeterX' },
  { re: /datadome/i, cat: 'bot_protection', w: 0.4, sig: 'DataDome' },
  { re: /imperva.*incapsula/i, cat: 'bot_protection', w: 0.4, sig: 'Imperva/Incapsula' },
  { re: /your (access|request) (to|has been) (this site|blocked|denied)/i, cat: 'bot_protection', w: 0.4, sig: 'access blocked' },
  { re: /ray id:/i, cat: 'bot_protection', w: 0.3, sig: 'Cloudflare Ray ID' },
  // Login wall
  { re: /(sign|log) ?in to (continue|read|access|view)/i, cat: 'login_wall', w: 0.35, sig: 'sign in to continue' },
  { re: /create (an |a free )?account to (continue|read|access)/i, cat: 'login_wall', w: 0.35, sig: 'create account to continue' },
  // Geo restriction
  { re: /not available in your (country|region|location)/i, cat: 'geo_restriction', w: 0.4, sig: 'not available in region' },
  // Rate limited
  { re: /too many requests/i, cat: 'rate_limited', w: 0.4, sig: 'too many requests' },
  { re: /rate limit/i, cat: 'rate_limited', w: 0.4, sig: 'rate limit' },
  // Age gate
  { re: /must be (18|21)\+?/i, cat: 'age_gate', w: 0.4, sig: 'must be 18/21+' },
  { re: /age (verification|gate|check)/i, cat: 'age_gate', w: 0.4, sig: 'age verification/gate' },
  // App gate
  { re: /download (our|the) app/i, cat: 'app_gate', w: 0.35, sig: 'download our app' },
  { re: /continue in (the )?app/i, cat: 'app_gate', w: 0.35, sig: 'continue in app' },
  // Error page
  { re: /500 internal server error/i, cat: 'error_page', w: 0.5, sig: '500 error' },
  { re: /503 service unavailable/i, cat: 'error_page', w: 0.5, sig: '503 error' },
  { re: /site (is )?(under |undergoing )?maintenance/i, cat: 'error_page', w: 0.4, sig: 'site maintenance' },
];

function classifyContent(html, url) {
  const scores = {};
  const signals = [];
  const addScore = (cat, w, sig) => { scores[cat] = (scores[cat] || 0) + w; signals.push(sig); };

  // Layer 1: Error prefix
  if (html.startsWith('[error:')) {
    const m = html.match(/^\[error:([^\]]+)\]/);
    const code = m ? m[1] : 'unknown';
    if (code === 'http-429') return { category: 'rate_limited', confidence: 0.9, signals: ['HTTP 429'], blocked: true };
    if (code === 'http-451') return { category: 'geo_restriction', confidence: 0.9, signals: ['HTTP 451'], blocked: true };
    if (code === 'http-403') return { category: 'bot_protection', confidence: 0.7, signals: ['HTTP 403'], blocked: true };
    if (code.startsWith('http-5')) return { category: 'error_page', confidence: 0.9, signals: [`HTTP ${code.replace('http-', '')}`], blocked: true };
    return { category: 'error_page', confidence: 0.8, signals: [`Fetch error: ${code}`], blocked: true };
  }

  // Layer 2: Known paywall domains
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const textLen = html.replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const parts = hostname.split('.');
  let isPaywall = PAYWALL_DOMAINS.has(hostname);
  if (!isPaywall) { for (let i = 1; i < parts.length - 1; i++) { if (PAYWALL_DOMAINS.has(parts.slice(i).join('.'))) { isPaywall = true; break; } } }
  if (isPaywall) {
    if (textLen < 1000) addScore('paywall', 0.6, `Known paywall (${hostname}) + short content`);
    else addScore('paywall', 0.2, `Known paywall (${hostname})`);
  }

  // Layer 3: Title patterns
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  for (const tp of GATE_TITLE_PATTERNS) { if (tp.re.test(title)) addScore(tp.cat, tp.conf, tp.sig); }

  // Layer 4: Body patterns
  for (const bp of GATE_BODY_PATTERNS) { if (bp.re.test(html)) addScore(bp.cat, bp.w, bp.sig); }

  // Layer 5: Short content amplifier
  if (textLen < 500 && signals.length > 0) {
    const topCat = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topCat) addScore(topCat, 0.2, `Short content (${textLen} chars) amplifier`);
  }

  // Decision
  const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!topEntry) return { category: 'content', confidence: 1.0, signals: [], blocked: false };
  const [cat, raw] = topEntry;
  const caps = { paywall: 0.95, captcha: 0.95, bot_protection: 0.95, cookie_wall: 0.85, login_wall: 0.90, geo_restriction: 0.95, rate_limited: 0.95, error_page: 0.95, age_gate: 0.90, app_gate: 0.90 };
  const confidence = Math.round(Math.min(raw, caps[cat] ?? 0.95) * 100) / 100;
  return { category: cat, confidence, signals, blocked: confidence >= 0.6 };
}

// --- Main evaluation loop ---

async function evaluateOne(hnId, url) {
  console.log(`  Fetching content from ${url}`);
  const content = await fetchContent(url);

  // Content gate: classify before spending tokens on eval
  const gate = classifyContent(content, url);
  if (gate.blocked) {
    console.log(`  \u229C Skipped: ${gate.category} (${(gate.confidence * 100).toFixed(0)}%) \u2014 ${gate.signals.join('; ')}`);
    return { skipped: true, category: gate.category };
  }

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
