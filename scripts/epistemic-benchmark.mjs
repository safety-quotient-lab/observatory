#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Epistemic Fitness Benchmark — tests free LLM models across 3 dimensions:
 *   1. Confabulation rate (invents facts about the observatory)
 *   2. Eval quality (calibration story scores vs expected ranges)
 *   3. Structured output compliance (valid JSON in lite eval schema)
 *
 * Usage:
 *   node scripts/epistemic-benchmark.mjs [options]
 *
 * Options:
 *   --models <ids>       Comma-separated model IDs to test (default: discover free)
 *   --dim <1|2|3|all>    Which dimension(s) to test (default: all)
 *   --dry-run            Show plan, don't call APIs
 *   --skip-workers-ai    Skip Workers AI models
 *   --skip-d1            Don't write results to D1
 *   --limit-models <n>   Max models to test from discovery (default: 10)
 *   --verbose            Print per-probe details
 *
 * Environment (from site/.dev.vars):
 *   OPENROUTER_API_KEY   Required for OpenRouter models
 *   CF_API_TOKEN         Optional, for Workers AI REST API
 *   CF_ACCOUNT_ID        Optional, for Workers AI REST API
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE = join(ROOT, 'site');

// --- Load env ---
for (const f of [join(SITE, '.env'), join(SITE, '.dev.vars')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

// --- Parse args ---
const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function opt(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const DRY_RUN = flag('dry-run');
const VERBOSE = flag('verbose');
const SKIP_WAI = flag('skip-workers-ai');
const SKIP_D1 = flag('skip-d1');
const DIM = opt('dim', 'all');
const LIMIT_MODELS = parseInt(opt('limit-models', '10'), 10);
const MODEL_FILTER = opt('models', '');
const BENCHMARK_VERSION = '1.0';

const OR_KEY = process.env.OPENROUTER_API_KEY;
const CF_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;

if (!OR_KEY) {
  console.error('OPENROUTER_API_KEY not found in site/.dev.vars');
  process.exit(1);
}

// --- Site context for confabulation probes ---
let agentCard = null;
try { agentCard = JSON.parse(readFileSync(join(SITE, 'public/.well-known/agent-card.json'), 'utf8')); } catch { /* ok */ }
let agentManifest = null;
try { agentManifest = JSON.parse(readFileSync(join(SITE, 'public/.well-known/agent-manifest.json'), 'utf8')); } catch { /* ok */ }

const SKILL_COUNT = agentCard?.skills?.length ?? 8;

const SITE_SUMMARY = `
## Human Rights Observatory — Site Context

**URL:** https://observatory.unratified.org

### Tech Stack
- **Framework:** Astro 5 SSR on Cloudflare Pages
- **Backend:** Cloudflare Workers (cron, 3 consumer workers, DLQ, browser audit)
- **Storage:** D1 (SQLite), KV (cache), R2 (content snapshots), Queues
- **NOT used:** Svelte, WordPress, Python, LiteLLM, Next.js, React

### Evaluation Pipeline
- **Primary model:** Claude Haiku 4.5 (Anthropic API)
- **Free tier models:** Llama 4 Scout + Llama 3.3 70B (Workers AI) — PSQ prompt
- **No Gemini models in our pipeline**

### Methodology (v3.4)
- **HRCB** (Human Rights Compatibility Bias): [-1.0, +1.0] scale (negative one to positive one)
- **Dual channel:** Editorial (E) = what content says; Structural (S) = what site does
- **SETL:** Structural-Editorial Tension Level
- **Fair Witness:** Inspired by Heinlein's "Stranger in a Strange Land" (not Asimov)
- **PSQ** (Psychological Safety Quotient): 0-10 scale, independent from HRCB

### .well-known Files
- agent-card.json (A2A protocol — ${SKILL_COUNT} skills)
- agent-inbox.json, agent-manifest.json, security.txt, webfinger
`.trim();

function buildSiteContext() {
  const parts = [
    '# Site Context',
    '',
    SITE_SUMMARY,
  ];
  if (agentCard) {
    parts.push('', '## Agent Card (excerpt)', '```json', JSON.stringify(agentCard, null, 2), '```');
  }
  return parts.join('\n');
}

// ============================================================
// CONFABULATION PROBES (Dim 1)
// ============================================================

const CONFAB_PROBES = [
  {
    question: 'What tech stack and framework does the Human Rights Observatory use? List the main technologies.',
    traps: [
      { re: /svelte/i, msg: 'Confabulated Svelte (we use Astro 5)' },
      { re: /wordpress/i, msg: 'Confabulated WordPress' },
      { re: /python/i, msg: 'Confabulated Python (pure JS/TS stack)' },
      { re: /next\.?js/i, msg: 'Confabulated Next.js' },
      { re: /react/i, msg: 'Confabulated React' },
      { re: /litellm/i, msg: 'Confabulated LiteLLM' },
    ],
  },
  {
    question: `How many skills does the observatory's agent card declare? List them.`,
    traps: [
      {
        fn: (t) => {
          const m = t.match(/(\d+)\s*skills/);
          return m && parseInt(m[1]) !== SKILL_COUNT;
        },
        msg: `Wrong skill count (correct: ${SKILL_COUNT})`,
      },
    ],
  },
  {
    question: 'What scale does HRCB use? What are the endpoints?',
    traps: [
      { re: /\b0\s*to\s*1\b/i, msg: 'Confabulated 0-1 scale (HRCB is [-1.0, +1.0])' },
      { re: /\b0\s*to\s*10\b/i, msg: 'Confabulated 0-10 scale' },
      { re: /\b0\s*to\s*100\b/i, msg: 'Confabulated 0-100 scale' },
    ],
  },
  {
    question: 'The Fair Witness concept in the methodology is inspired by which science fiction author and which novel?',
    traps: [
      { re: /asimov/i, msg: 'Confabulated Asimov (it\'s Heinlein, Stranger in a Strange Land)' },
      { re: /clarke/i, msg: 'Confabulated Clarke (it\'s Heinlein)' },
      { re: /herbert/i, msg: 'Confabulated Herbert (it\'s Heinlein)' },
    ],
  },
];

function checkTraps(text, traps) {
  const flags = [];
  for (const trap of traps) {
    if (trap.re && trap.re.test(text)) flags.push(trap.msg);
    if (trap.fn && trap.fn(text)) flags.push(trap.msg);
  }
  return flags;
}

// ============================================================
// CALIBRATION SET (Dim 2) — 3-story subset
// ============================================================

const CAL_STORIES = [
  { slot: 'EP-1', url: 'https://www.amnesty.org/en/what-we-do/', expectedClass: 'EP', min: 0.75, max: 1.00, label: 'Amnesty International' },
  { slot: 'EN-1', url: 'https://www.weather.gov', expectedClass: 'EN', min: -0.05, max: 0.20, label: 'Weather.gov' },
  { slot: 'EX-2', url: 'https://www.presstv.ir', expectedClass: 'EX', min: -0.95, max: -0.20, label: 'PressTV' },
];

// Lite system prompt (inlined from evaluate-standalone.mjs — lite-1.6 schema)
const LITE_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score content on editorial stance and transparency indicators.

## DIMENSION 1: EDITORIAL (explicit rights discourse)
Does the content directly discuss, reference, or engage with human rights?
Score: integer 0-100 where 50 = neutral. Use the full range.
Tier anchors:
  90-100: Active rights advocacy
  70-89: Implicitly supportive
  55-69: Slight positive lean
  50: Neutral — ONLY for zero explicit rights discussion
  31-49: Slight negative lean
  11-30: Implicitly hostile
  0-10: Dehumanizing propaganda

CRITICAL: Reserve editorial 50 for content with zero explicit rights discussion. When uncertain between 48-52, pick 48 or 52 — never 50.

## DIMENSION 2: TRANSPARENCY QUOTIENT (TQ)
Score 5 binary indicators (0 or 1 each):
- tq_author: 1 if author identified by real name
- tq_date: 1 if publication date visible
- tq_sources: 1 if primary sources cited
- tq_corrections: 1 if correction notice or policy link present
- tq_conflicts: 1 if conflicts of interest disclosed

Content types: ED=Editorial, PO=Policy, LP=Landing Page, PR=Product, MI=Mission, HR=Human Rights, MX=Mixed
Evidence strength: H=explicit | M=implicit | L=tangential

Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-1.6",
  "reasoning": "<max 15 words>",
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
  "theme_tag": "<2-4 word theme>",
  "sentiment_tag": "<Champions|Advocates|Acknowledges|Neutral|Neglects|Undermines|Hostile>",
  "short_description": "<max 20 words>",
  "eq_score": <0.0 to 1.0>,
  "so_score": <0.0 to 1.0>,
  "td_score": <0.0 to 1.0>,
  "valence": <-1.0 to +1.0>,
  "arousal": <0.0 to 1.0>,
  "primary_tone": "<measured|urgent|alarmist|hopeful|cynical|detached|empathetic|confrontational|celebratory|solemn>"
}`;

// ============================================================
// API CALLERS
// ============================================================

const TIMEOUT_MS = 45_000;

async function callOpenRouter(model, systemPrompt, userMessage, retryCount = 0) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OR_KEY}`,
        'HTTP-Referer': 'https://observatory.unratified.org',
        'X-Title': 'HRO Epistemic Benchmark',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    if (res.status === 429 && retryCount < 1) {
      const wait = Math.min(parseInt(res.headers.get('retry-after') || '30', 10), 60);
      if (VERBOSE) console.log(`  429 — waiting ${wait}s (retry ${retryCount + 1})...`);
      clearTimeout(timer);
      await sleep(wait * 1000);
      return callOpenRouter(model, systemPrompt, userMessage, retryCount + 1);
    }

    if (!res.ok) {
      return { text: null, latency: Date.now() - start, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, latency: Date.now() - start, error: null };
  } catch (e) {
    return { text: null, latency: Date.now() - start, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function callWorkersAi(modelPath, systemPrompt, userMessage) {
  if (!CF_TOKEN || !CF_ACCOUNT) {
    return { text: null, latency: 0, error: 'CF_API_TOKEN/CF_ACCOUNT_ID not set' };
  }
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${modelPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CF_TOKEN}`,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return { text: null, latency: Date.now() - start, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    // Workers AI may return { result: { response: "..." } } or { result: "..." }
    const result = data.result;
    const text = typeof result === 'string' ? result : (result?.response || '');
    return { text, latency: Date.now() - start, error: null };
  } catch (e) {
    return { text: null, latency: Date.now() - start, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// JSON EXTRACTION (ported from eval-parse.ts)
// ============================================================

function extractJson(text) {
  if (!text) return null;

  // Strip <think> blocks (reasoning models)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try markdown fence
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  // Strip leading + on numbers (Llama quirk)
  cleaned = cleaned.replace(/:\s*\+(\d)/g, ': $1');

  // Try raw JSON
  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  // Try object extraction
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
  }

  return null;
}

// ============================================================
// LITE EVAL VALIDATOR (simplified port from eval-parse.ts)
// ============================================================

function validateLiteEval(parsed) {
  if (!parsed) return { valid: false, repairs: ['no parseable JSON'] };
  const repairs = [];

  const ev = parsed.evaluation || parsed;
  if (!ev) return { valid: false, repairs: ['no evaluation object'] };

  const editorial = ev.editorial;
  if (editorial == null || typeof editorial !== 'number') {
    return { valid: false, repairs: ['editorial score missing or non-numeric'] };
  }

  // Must be 0-100 integer range for lite-1.6
  if (editorial < 0 || editorial > 100) {
    repairs.push(`editorial ${editorial} out of 0-100 range`);
  }

  // TQ checks
  for (const k of ['tq_author', 'tq_date', 'tq_sources', 'tq_corrections', 'tq_conflicts']) {
    if (ev[k] != null && ![0, 1].includes(ev[k])) {
      repairs.push(`${k}=${ev[k]} not binary`);
    }
  }

  // Normalize editorial to [-1, +1]
  const normalizedEditorial = (Math.min(100, Math.max(0, editorial)) - 50) / 50;

  return {
    valid: true,
    editorial: normalizedEditorial,
    rawEditorial: editorial,
    confidence: ev.confidence ?? null,
    contentType: ev.content_type ?? null,
    repairs,
  };
}

// ============================================================
// CONTENT FETCHER
// ============================================================

const MAX_CONTENT_CHARS = 8000;

async function fetchContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HRO-EpistemicBenchmark/1.0' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Strip HTML tags for a rough text extraction
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_CHARS);
    return text;
  } catch {
    return null;
  }
}

// ============================================================
// MODEL DISCOVERY
// ============================================================

async function discoverFreeOpenRouterModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${OR_KEY}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter(m => m.pricing?.prompt === '0' && m.pricing?.completion === '0')
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length || 4096,
        provider: 'openrouter',
      }))
      .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0));
  } catch (e) {
    console.error(`Model discovery failed: ${e.message}`);
    return [];
  }
}

// Workers AI models for standalone REST API testing
const WAI_MODELS = [
  { id: 'llama-3.3-70b-wai-psq', apiModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (WAI)', provider: 'workers-ai', contextLength: 8192 },
  { id: 'llama-4-scout-wai-psq', apiModel: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (WAI)', provider: 'workers-ai', contextLength: 16384 },
];

async function buildModelList() {
  let models = [];

  // OpenRouter free models
  if (MODEL_FILTER) {
    // User specified exact models
    models = MODEL_FILTER.split(',').map(id => ({
      id: id.trim(),
      name: id.trim(),
      provider: 'openrouter',
      contextLength: 8192,
    }));
  } else {
    const discovered = await discoverFreeOpenRouterModels();
    if (VERBOSE) console.log(`Discovered ${discovered.length} free OpenRouter models`);
    models = discovered.slice(0, LIMIT_MODELS);
  }

  // Workers AI
  if (!SKIP_WAI && CF_TOKEN && CF_ACCOUNT) {
    models.push(...WAI_MODELS);
  } else if (!SKIP_WAI && VERBOSE) {
    console.log('Skipping Workers AI (CF_API_TOKEN/CF_ACCOUNT_ID not set)');
  }

  return models;
}

// ============================================================
// BENCHMARK RUNNER
// ============================================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runConfabDim(model, callFn) {
  const context = buildSiteContext();
  let probesSent = 0;
  let flagsTotal = 0;
  const details = [];

  for (const probe of CONFAB_PROBES) {
    const { text, error } = await callFn(model, context, probe.question);
    probesSent++;

    if (error || !text) {
      details.push({ question: probe.question, flags: ['API error: ' + (error || 'empty')], error: true });
      flagsTotal++; // Count errors as confabulation (model can't answer = not fit)
      continue;
    }

    const flags = checkTraps(text, probe.traps);
    if (flags.length > 0) flagsTotal++;
    details.push({ question: probe.question, flags, response: VERBOSE ? text.slice(0, 200) : undefined });

    if (VERBOSE) {
      console.log(`    Probe: ${probe.question.slice(0, 50)}...`);
      console.log(`    Flags: ${flags.length === 0 ? 'clean' : flags.join('; ')}`);
    }

    await sleep(1500); // Rate limit courtesy
  }

  return { probesSent, flagsTotal, rate: probesSent > 0 ? flagsTotal / probesSent : 1, details };
}

async function runEvalQualityDim(model, callFn, contentCache) {
  const scores = [];
  let inRange = 0;
  const details = [];

  for (const cal of CAL_STORIES) {
    const content = contentCache[cal.url];
    if (!content) {
      details.push({ slot: cal.slot, error: 'content fetch failed' });
      continue;
    }

    const userMsg = `Evaluate this content from ${cal.url}:\n\n${content}`;
    const { text, error } = await callFn(model, LITE_SYSTEM_PROMPT, userMsg);

    if (error || !text) {
      details.push({ slot: cal.slot, error: error || 'empty response' });
      scores.push({ slot: cal.slot, score: null, inRange: false, rawResponse: null });
      continue;
    }

    const parsed = extractJson(text);
    const validated = validateLiteEval(parsed);

    let score = null;
    let isInRange = false;

    if (validated.valid) {
      score = validated.editorial; // Already normalized to [-1, +1]
      isInRange = score >= cal.min && score <= cal.max;
      if (isInRange) inRange++;
    }

    scores.push({
      slot: cal.slot,
      expectedClass: cal.expectedClass,
      expectedMin: cal.min,
      expectedMax: cal.max,
      actual: score,
      rawEditorial: validated.rawEditorial ?? null,
      inRange: isInRange,
      validJson: parsed != null,
      validSchema: validated.valid,
      rawResponse: text,
    });

    if (VERBOSE) {
      const scoreStr = score != null ? score.toFixed(3) : 'null';
      console.log(`    ${cal.slot} (${cal.label}): ${scoreStr} [${cal.min}, ${cal.max}] → ${isInRange ? 'IN RANGE' : 'OUT'}`);
    }

    await sleep(1500);
  }

  // Class ordering: EP > EN > EX
  const epScore = scores.find(s => s.expectedClass === 'EP')?.actual;
  const enScore = scores.find(s => s.expectedClass === 'EN')?.actual;
  const exScore = scores.find(s => s.expectedClass === 'EX')?.actual;
  const classOrderingOk = epScore != null && enScore != null && exScore != null
    && epScore > enScore && enScore > exScore;

  return {
    storiesTested: scores.length,
    inRangeCount: inRange,
    inRangeRate: scores.length > 0 ? inRange / scores.length : 0,
    classOrderingOk,
    scores,
  };
}

function runOutputComplianceDim(evalScores) {
  // Reuse responses from Dim 2 — no extra API calls
  let attempts = 0;
  let validJson = 0;
  let validSchema = 0;

  for (const s of evalScores) {
    if (!s.rawResponse) continue;
    attempts++;
    if (s.validJson) validJson++;
    if (s.validSchema) validSchema++;
  }

  return {
    attempts,
    validJson,
    validSchema,
    jsonRate: attempts > 0 ? validJson / attempts : 0,
    schemaRate: attempts > 0 ? validSchema / attempts : 0,
  };
}

function computeComposite(dim1, dim2, dim3) {
  const confabFitness = 1 - dim1.rate;
  const evalFitness = dim2.inRangeRate * (dim2.classOrderingOk ? 1.0 : 0.5);
  const outputFitness = dim3.schemaRate;
  return 0.4 * confabFitness + 0.3 * evalFitness + 0.3 * outputFitness;
}

function grade(composite) {
  if (composite >= 0.80) return 'A READY';
  if (composite >= 0.60) return 'B REVIEW';
  if (composite >= 0.40) return 'C CAUTION';
  if (composite >= 0.20) return 'D POOR';
  return 'F UNFIT';
}

// ============================================================
// OUTPUT
// ============================================================

function printTable(results) {
  const line = '─'.repeat(88);
  console.log('');
  console.log(`  EPISTEMIC FITNESS BENCHMARK v${BENCHMARK_VERSION}`);
  console.log(`  ${new Date().toISOString().split('T')[0]}  |  ${results.length} models tested`);
  console.log(`  ${line}`);
  console.log(`  ${'Model'.padEnd(40)} ${'Confab'.padEnd(8)} ${'EvalQ'.padEnd(8)} ${'Output'.padEnd(8)} ${'Score'.padEnd(7)} Grade`);
  console.log(`  ${line}`);

  for (const r of results.sort((a, b) => b.composite - a.composite)) {
    const confab = r.dim1 ? `${r.dim1.flagsTotal}/${r.dim1.probesSent}` : 'skip';
    const evalQ = r.dim2 ? `${r.dim2.inRangeCount}/${r.dim2.storiesTested}` : 'skip';
    const output = r.dim3 ? `${r.dim3.validSchema}/${r.dim3.attempts}` : 'skip';
    const score = r.composite.toFixed(2);
    const g = grade(r.composite);
    const name = r.model.name.length > 38 ? r.model.name.slice(0, 36) + '..' : r.model.name;
    console.log(`  ${name.padEnd(40)} ${confab.padEnd(8)} ${evalQ.padEnd(8)} ${output.padEnd(8)} ${score.padEnd(7)} ${g}`);
  }

  console.log(`  ${line}`);
  console.log('  Grading: A >= 0.80 (ready) | B >= 0.60 (review) | C >= 0.40 (caution) | D >= 0.20 (poor) | F < 0.20 (unfit)');
  console.log('');
}

function writeReport(results) {
  const dir = join(ROOT, 'findings');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const path = join(dir, `epistemic-benchmark-${date}.json`);
  const report = {
    benchmark_version: BENCHMARK_VERSION,
    run_date: date,
    models_tested: results.length,
    results: results.map(r => ({
      model_id: r.model.id,
      model_name: r.model.name,
      provider: r.model.provider,
      composite_score: r.composite,
      grade: grade(r.composite),
      dim1_confabulation: r.dim1 ? {
        probes_sent: r.dim1.probesSent,
        flags_total: r.dim1.flagsTotal,
        rate: r.dim1.rate,
        details: r.dim1.details,
      } : null,
      dim2_eval_quality: r.dim2 ? {
        stories_tested: r.dim2.storiesTested,
        in_range_count: r.dim2.inRangeCount,
        in_range_rate: r.dim2.inRangeRate,
        class_ordering_ok: r.dim2.classOrderingOk,
        scores: r.dim2.scores.map(s => ({
          slot: s.slot,
          expected_class: s.expectedClass,
          expected_range: [s.expectedMin, s.expectedMax],
          actual: s.actual,
          in_range: s.inRange,
        })),
      } : null,
      dim3_output_compliance: r.dim3 ? {
        attempts: r.dim3.attempts,
        valid_json: r.dim3.validJson,
        valid_schema: r.dim3.validSchema,
        json_rate: r.dim3.jsonRate,
        schema_rate: r.dim3.schemaRate,
      } : null,
      duration_ms: r.durationMs,
      errors: r.errors,
    })),
  };
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`Report written to ${path}`);
  return path;
}

async function writeToD1(results) {
  const date = new Date().toISOString().split('T')[0];
  for (const r of results) {
    const sql = `INSERT INTO model_epistemic_fitness (
      model_id, provider, run_date,
      confab_probes_sent, confab_flags_total, confab_rate,
      eval_stories_tested, eval_in_range_count, eval_in_range_rate,
      eval_class_ordering_ok, eval_scores_json,
      output_attempts, output_valid_json, output_valid_schema,
      output_valid_json_rate, output_valid_schema_rate,
      composite_score, prompt_mode, benchmark_version, duration_ms, error_log
    ) VALUES (
      '${r.model.id}', '${r.model.provider}', '${date}',
      ${r.dim1?.probesSent ?? 0}, ${r.dim1?.flagsTotal ?? 0}, ${r.dim1?.rate ?? 'NULL'},
      ${r.dim2?.storiesTested ?? 0}, ${r.dim2?.inRangeCount ?? 0}, ${r.dim2?.inRangeRate ?? 'NULL'},
      ${r.dim2?.classOrderingOk ? 1 : 0}, '${JSON.stringify(r.dim2?.scores?.map(s => ({ slot: s.slot, actual: s.actual, inRange: s.inRange })) ?? []).replace(/'/g, "''")}',
      ${r.dim3?.attempts ?? 0}, ${r.dim3?.validJson ?? 0}, ${r.dim3?.validSchema ?? 0},
      ${r.dim3?.jsonRate ?? 'NULL'}, ${r.dim3?.schemaRate ?? 'NULL'},
      ${r.composite}, 'lite', '${BENCHMARK_VERSION}', ${r.durationMs ?? 'NULL'},
      ${r.errors.length > 0 ? "'" + JSON.stringify(r.errors).replace(/'/g, "''") + "'" : 'NULL'}
    )`;
    try {
      execSync(`cd "${SITE}" && npx wrangler d1 execute hrcb-db --remote --command "${sql.replace(/"/g, '\\"')}"`, {
        stdio: VERBOSE ? 'inherit' : 'pipe',
        timeout: 30_000,
      });
    } catch (e) {
      console.error(`D1 write failed for ${r.model.id}: ${e.message}`);
    }
  }
  console.log(`Wrote ${results.length} results to D1`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('Discovering models...');
  const models = await buildModelList();

  if (models.length === 0) {
    console.error('No models found. Check OPENROUTER_API_KEY or use --models.');
    process.exit(1);
  }

  console.log(`Testing ${models.length} models:`);
  for (const m of models) {
    console.log(`  - ${m.id} (${m.provider}, ctx=${m.contextLength || '?'})`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: exiting without API calls.');
    process.exit(0);
  }

  // Pre-fetch calibration content
  const contentCache = {};
  if (DIM === 'all' || DIM === '2') {
    console.log('\nPre-fetching calibration content...');
    for (const cal of CAL_STORIES) {
      contentCache[cal.url] = await fetchContent(cal.url);
      const status = contentCache[cal.url] ? `${contentCache[cal.url].length} chars` : 'FAILED';
      console.log(`  ${cal.slot} (${cal.label}): ${status}`);
    }
  }

  // Run benchmarks
  const results = [];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const startMs = Date.now();
    console.log(`\n[${i + 1}/${models.length}] ${model.id}`);

    // Select API caller
    const callFn = model.provider === 'workers-ai'
      ? (_m, sys, usr) => callWorkersAi(model.apiModel, sys, usr)
      : (_m, sys, usr) => callOpenRouter(model.id, sys, usr);

    let dim1 = null, dim2 = null, dim3 = null;
    const errors = [];

    // Dim 1: Confabulation
    if (DIM === 'all' || DIM === '1') {
      console.log('  Dim 1: Confabulation probes...');
      try {
        dim1 = await runConfabDim(model, callFn);
        console.log(`  → ${dim1.flagsTotal}/${dim1.probesSent} flags (rate: ${dim1.rate.toFixed(2)})`);
      } catch (e) {
        errors.push(`dim1: ${e.message}`);
        console.log(`  → ERROR: ${e.message}`);
      }
    }

    // Dim 2: Eval Quality
    if (DIM === 'all' || DIM === '2') {
      console.log('  Dim 2: Calibration evals...');
      try {
        dim2 = await runEvalQualityDim(model, callFn, contentCache);
        console.log(`  → ${dim2.inRangeCount}/${dim2.storiesTested} in range, ordering: ${dim2.classOrderingOk ? 'OK' : 'FAIL'}`);
      } catch (e) {
        errors.push(`dim2: ${e.message}`);
        console.log(`  → ERROR: ${e.message}`);
      }
    }

    // Dim 3: Structured Output (reuses Dim 2 responses)
    if ((DIM === 'all' || DIM === '3') && dim2) {
      dim3 = runOutputComplianceDim(dim2.scores);
      console.log(`  Dim 3: ${dim3.validSchema}/${dim3.attempts} valid schema (JSON: ${dim3.validJson}/${dim3.attempts})`);
    }

    const durationMs = Date.now() - startMs;
    const composite = computeComposite(
      dim1 || { rate: 1 },
      dim2 || { inRangeRate: 0, classOrderingOk: false },
      dim3 || { schemaRate: 0 }
    );

    results.push({ model, dim1, dim2, dim3, composite, durationMs, errors });
    console.log(`  Composite: ${composite.toFixed(2)} (${grade(composite)}) — ${(durationMs / 1000).toFixed(1)}s`);

    // Inter-model delay
    if (i < models.length - 1) await sleep(2000);
  }

  // Output
  printTable(results);
  const reportPath = writeReport(results);

  if (!SKIP_D1) {
    console.log('Writing to D1...');
    await writeToD1(results);
  }

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
