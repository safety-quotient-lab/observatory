#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * External AI Feedback — structured feedback exchange with external LLMs.
 *
 * Two modes:
 *   1. --prompt "..."   Non-interactive: send prompt, output JSON to stdout, exit.
 *                        Designed for Claude Code to invoke and parse.
 *   2. (no --prompt)    Interactive REPL for manual multi-turn exchanges.
 *
 * Usage:
 *   node scripts/external-feedback.mjs --prompt "Review our API design"
 *   node scripts/external-feedback.mjs --provider openrouter --model qwen/qwen3-235b-a22b-thinking-2507
 *   node scripts/external-feedback.mjs --prompt "..." --resume FILE --save name
 *   node scripts/external-feedback.mjs              # interactive REPL
 *
 * Options:
 *   --prompt TEXT       Send single prompt, output JSON, exit (non-interactive)
 *   --provider NAME     Provider: gemini | openrouter | kagi (default: openrouter)
 *   --model MODEL       Model ID (default per provider)
 *   --dry-run           Print system context and exit
 *   --resume FILE       Resume a saved conversation
 *   --save NAME         Auto-save with this name (non-interactive mode)
 *   --follow-up         When resuming, add prompt as follow-up (not fresh context)
 *
 * API keys in site/.dev.vars: GOOGLE_API_KEY (gemini), OPENROUTER_API_KEY (openrouter), KAGI_API_KEY (kagi)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- Env loading (two-stage: .env then .dev.vars) ---
for (const envFile of ['site/.env', 'site/.dev.vars']) {
  const p = join(ROOT, envFile);
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const argVal = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const hasFlag = (flag) => process.argv.includes(flag);

const PROVIDER_DEFAULTS = {
  gemini: { model: 'gemini-2.0-flash', keyEnv: 'GOOGLE_API_KEY' },
  openrouter: { model: 'qwen/qwen3-235b-a22b-thinking-2507', keyEnv: 'OPENROUTER_API_KEY' },
  wolfram: { model: 'llm-api', keyEnv: 'WOLFRAMALPHA_APP_ID' },
  kagi: { model: 'fastgpt', keyEnv: 'KAGI_API_KEY' },
};

let PROVIDER = argVal('--provider') || 'openrouter';
if (!PROVIDER_DEFAULTS[PROVIDER]) {
  console.error(`Unknown provider: ${PROVIDER}. Use: gemini, openrouter, wolfram, kagi`);
  process.exit(1);
}

const API_KEY = process.env[PROVIDER_DEFAULTS[PROVIDER].keyEnv];
let MODEL = argVal('--model') || PROVIDER_DEFAULTS[PROVIDER].model;
const DRY_RUN = hasFlag('--dry-run');
const RESUME_FILE = argVal('--resume');
const PROMPT = argVal('--prompt');
const SAVE_NAME = argVal('--save');
const FOLLOW_UP = hasFlag('--follow-up');
const EXCHANGES_DIR = join(ROOT, '.claude/plans/memorized/gemini-exchanges');

if (!API_KEY && !DRY_RUN) {
  const keyName = PROVIDER_DEFAULTS[PROVIDER].keyEnv;
  console.error(`{"error": "${keyName} not found in site/.dev.vars"}`);
  process.exit(1);
}

mkdirSync(EXCHANGES_DIR, { recursive: true });

// --- Load agent card + manifest ---
const agentCardPath = join(ROOT, 'site/public/.well-known/agent-card.json');
const agentManifestPath = join(ROOT, 'site/public/.well-known/agent-manifest.json');

let agentCard = null;
let agentManifest = null;
try { agentCard = JSON.parse(readFileSync(agentCardPath, 'utf8')); } catch { /* ok */ }
try { agentManifest = JSON.parse(readFileSync(agentManifestPath, 'utf8')); } catch { /* ok */ }

// --- Compact site summary (baked, not fetched) ---
const SITE_SUMMARY = `
## Human Rights Observatory — Site Context

**URL:** https://observatory.unratified.org
**Canonical domain:** observatory.unratified.org
**Blog:** blog.unratified.org (separate CF Pages project)

### Tech Stack
- **Framework:** Astro 5 SSR on Cloudflare Pages
- **Backend:** Cloudflare Workers (cron, 3 consumer workers, DLQ, browser audit)
- **Storage:** D1 (SQLite), KV (cache), R2 (content snapshots), Queues
- **NOT:** Svelte, WordPress, Python, LiteLLM, Next.js, React
- **CSS:** Custom CSS + Tailwind utilities, OkSolar color palette, light/dark theme

### Evaluation Pipeline
- **Primary model:** Claude Haiku 4.5 (Anthropic API)
- **Free tier models:** Llama 4 Scout + Llama 3.3 70B (Workers AI) — lite prompt
- **No Gemini models in our pipeline**
- **Queue architecture:** 1 Anthropic queue + 8 OpenRouter model queues + 1 Workers AI queue + 1 browser audit queue
- **Dead letter queue** with auto-replay

### Methodology (v3.4)
- **HRCB** (Human Rights Compatibility Bias): [-1.0, +1.0] scale
- **Dual channel:** Editorial (E) = what content says; Structural (S) = what site does
- **SETL** (Structural-Editorial Tension Level): measures E/S divergence ("says one thing, does another")
- **Fair Witness:** Each scored section has witness_facts (observable) + witness_inferences (interpretive) — inspired by Heinlein's "Stranger in a Strange Land"
- **DCP** (Domain Context Profile): inherited modifiers from domain-level policies
- **Content types:** ED (editorial), PO (policy), LP (landing page), PR (press release), AC (academic), MI (mixed)
- **10 supplementary signals:** epistemic quality, propaganda (PTC-18), solution orientation, emotional tone, stakeholder representation, temporal framing, geographic scope, complexity level, transparency/disclosure, rights tensions (RTS)

### .well-known Files
- agent-card.json (A2A — 6 skills)
- agent-inbox.json (inter-agent proposals)
- agent-manifest.json (construction provenance)
- security.txt
- webfinger (RFC 7033)

### Public API
- REST: /api/v1/ (stories, domains, users, signals, badges)
- OpenAPI 3.1 spec at /api/v1/openapi.json
- Atom feeds with UDHR article filters at /feed.xml
- Rate limit: 200 req/hr per IP

### Key Pages
- / (observatory dashboard — UDHR heatmap, rights under pressure, evidence transparency)
- /stories (filterable feed with HRCB scores)
- /signals (findings-first: transparency, accessibility, persuasion, temporal framing)
- /sources (domain intelligence dashboard)
- /rights (UDHR provision rankings + network analysis)
- /about (3-tier progressive disclosure, persona toggle)
- /methodology (renders exact LLM prompt)
- /search (Algolia-powered FTS)

### Construct Validity
- Known-groups discrimination: Editorial-Positive > Editorial-Negative > Editorial-Contested (H=23.4, p<0.0001)
- Discriminant validity: r=0.08 vs sentiment (measures rights alignment, not positivity)
- RTS (Rights Tension Signature) validated and deployed
- REM (Rights Entanglement Map) validated and deployed
`.trim();

// --- System context message ---
function buildSystemContext() {
  const parts = [
    '# System Context for Structured Feedback',
    '',
    'You are reviewing the Human Rights Observatory (observatory.unratified.org).',
    'Below is our identity, architecture, and capabilities. Use this to ground your feedback.',
    '',
    '## Agent Card',
    '```json',
    JSON.stringify(agentCard, null, 2),
    '```',
    '',
    '## Agent Manifest',
    '```json',
    JSON.stringify(agentManifest, null, 2),
    '```',
    '',
    SITE_SUMMARY,
    '',
    '## Requested Response Format',
    '',
    'Please respond in JSON (no markdown fences) with this structure:',
    '```json',
    JSON.stringify({
      findings: [{
        category: 'architecture | methodology | api | ux | security | data | pedagogy',
        claim: 'What you observed or concluded',
        severity: 'high | medium | low | info',
        actionable: true,
        suggestion: 'Concrete next step (if actionable)'
      }],
      summary: 'Brief overall assessment'
    }, null, 2),
    '```',
    '',
    'Ground all claims in the context provided above. If you lack information to verify a claim, say so explicitly rather than confabulating.',
  ];
  return parts.join('\n');
}

// --- Known facts for .eval ---
const KNOWN_FACTS = [
  { key: 'tech_stack', check: (t) => /svelte/i.test(t), msg: 'CONFABULATION: We do NOT use Svelte (1 mention in tailwind.config.mjs only — it\'s Astro 5 SSR)' },
  { key: 'tech_stack', check: (t) => /wordpress/i.test(t), msg: 'CONFABULATION: We do NOT use WordPress' },
  { key: 'tech_stack', check: (t) => /python/i.test(t), msg: 'CONFABULATION: We do NOT use Python — pure JS/TS stack' },
  { key: 'tech_stack', check: (t) => /litellm/i.test(t), msg: 'CONFABULATION: We do NOT use LiteLLM' },
  { key: 'tech_stack', check: (t) => /next\.?js/i.test(t), msg: 'CONFABULATION: We do NOT use Next.js — it\'s Astro 5' },
  { key: 'tech_stack', check: (t) => /react/i.test(t) && !/react/i.test('non-reactive'), msg: 'WARNING: We do NOT use React — Astro with zero client-side framework' },
  { key: 'models', check: (t) => /gemini/i.test(t) && /pipeline|evaluat|model/i.test(t), msg: 'CONFABULATION: No Gemini models in our evaluation pipeline' },
  { key: 'skills', check: (t) => /(\d+)\s*skills/.test(t) && parseInt(t.match(/(\d+)\s*skills/)?.[1] || '6') !== 6, msg: 'CONFABULATION: Agent card has exactly 6 skills' },
  { key: 'scale', check: (t) => /\b(0|1)\s*to\s*(1|10|100)\b/i.test(t) && /hrcb/i.test(t), msg: 'CONFABULATION: HRCB scale is [-1.0, +1.0], not 0-1 or 0-100' },
  { key: 'well_known', check: (t) => /robots\.txt/i.test(t) && /\.well-known/i.test(t), msg: 'WARNING: robots.txt is not in .well-known/ — it\'s at site root' },
  { key: 'fair_witness', check: (t) => /asimov/i.test(t) && /fair\s*witness/i.test(t), msg: 'CONFABULATION: Fair Witness is from Heinlein (Stranger in a Strange Land), not Asimov' },
  { key: 'e_prime', check: (t) => /e[- ]prime/i.test(t) && /methodolog/i.test(t), msg: 'NOTE: E-Prime constraint exists but only in Fair Witness rule 6 for witness_facts' },
];

function evalResponse(text) {
  const flags = [];
  for (const fact of KNOWN_FACTS) {
    if (fact.check(text)) {
      flags.push(fact.msg);
    }
  }
  return flags;
}

// --- Extract JSON from response (handles markdown fences or raw JSON) ---
function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Try to find JSON object in the text
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// --- LLM API (Gemini + OpenRouter) ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Convert our internal contents format to OpenAI-style messages
function toOpenAIMessages(contents) {
  return contents.map(c => ({
    role: c.role === 'model' ? 'assistant' : c.role,
    content: c.parts.map(p => p.text).join('\n'),
  }));
}

async function callLLM(contents, retryCount = 0) {
  if (PROVIDER === 'wolfram') {
    return callWolfram(contents);
  }
  if (PROVIDER === 'kagi') {
    return callKagi(contents);
  }
  if (PROVIDER === 'openrouter') {
    return callOpenRouter(contents, retryCount);
  }
  return callGemini(contents, retryCount);
}

async function callGemini(contents, retryCount = 0) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (res.status === 429 && retryCount < 1) {
    const body = await res.text();
    const delayMatch = body.match(/"retryDelay":\s*"(\d+)(?:\.\d+)?s"/);
    const waitSec = delayMatch ? parseInt(delayMatch[1]) + 2 : 30;
    if (!PROMPT) { console.log(`  Rate limited — waiting ${waitSec}s...`); }
    else { process.stderr.write(`Rate limited — waiting ${waitSec}s...\n`); }
    await sleep(waitSec * 1000);
    return callGemini(contents, retryCount + 1);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.[0]?.text) {
    throw new Error(`Gemini returned no content: ${JSON.stringify(data)}`);
  }
  return candidate.content.parts[0].text;
}

async function callOpenRouter(contents, retryCount = 0) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer': 'https://observatory.unratified.org',
      'X-Title': 'Human Rights Observatory Feedback',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: toOpenAIMessages(contents),
      temperature: 0.7,
      max_tokens: 8192,
    }),
  });

  if (res.status === 429 && retryCount < 1) {
    const retryAfter = res.headers.get('retry-after');
    const waitSec = retryAfter ? parseInt(retryAfter) + 2 : 30;
    if (!PROMPT) { console.log(`  Rate limited — waiting ${waitSec}s...`); }
    else { process.stderr.write(`Rate limited — waiting ${waitSec}s...\n`); }
    await sleep(waitSec * 1000);
    return callOpenRouter(contents, retryCount + 1);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`OpenRouter returned no content: ${JSON.stringify(data)}`);
  }
  return text;
}

async function callWolfram(contents) {
  // Wolfram is not a chat model — extract the last user message as a query
  const lastUser = [...contents].reverse().find(c => c.role === 'user');
  if (!lastUser) throw new Error('No user message to query Wolfram with');
  const query = lastUser.parts.map(p => p.text).join('\n');

  // Use LLM API for structured text output, Short Answers for one-liners
  const endpoint = MODEL === 'short' ? 'v1/result' : 'api/v1/llm-api';
  const baseUrl = MODEL === 'short'
    ? `http://api.wolframalpha.com/${endpoint}`
    : `https://www.wolframalpha.com/${endpoint}`;
  const url = `${baseUrl}?input=${encodeURIComponent(query)}&appid=${API_KEY}`;

  const res = await fetch(url);

  if (res.status === 501) {
    return JSON.stringify({
      findings: [{ category: 'data', claim: 'Wolfram Alpha could not interpret this query', severity: 'info', actionable: false, suggestion: 'Rephrase as a computational or factual question' }],
      summary: 'Query not understood by Wolfram Alpha'
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wolfram API ${res.status}: ${err}`);
  }

  const text = await res.text();
  // Wrap raw Wolfram output in our findings format
  return JSON.stringify({
    findings: [{ category: 'data', claim: text, severity: 'info', actionable: false, suggestion: null }],
    summary: `Wolfram Alpha result for: ${query.slice(0, 100)}`,
    _raw_wolfram: text
  });
}

async function callKagi(contents) {
  // Extract the last user message as query (like Wolfram — Kagi is not a chat model)
  const lastUser = [...contents].reverse().find(c => c.role === 'user');
  if (!lastUser) throw new Error('No user message to query Kagi with');
  const query = lastUser.parts.map(p => p.text).join('\n');

  if (MODEL === 'summarize') {
    // Summarizer mode: expects a URL in the query
    const urlMatch = query.match(/https?:\/\/\S+/);
    const endpoint = urlMatch
      ? `https://kagi.com/api/v0/summarize?url=${encodeURIComponent(urlMatch[0])}&summary_type=takeaway`
      : 'https://kagi.com/api/v0/summarize';
    const opts = { headers: { 'Authorization': `Bot ${API_KEY}` } };
    if (!urlMatch) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ text: query, summary_type: 'takeaway' });
    }
    const res = await fetch(endpoint, opts);
    if (!res.ok) throw new Error(`Kagi Summarizer ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.data?.output || JSON.stringify(data);
  }

  // Default: FastGPT (AI search with citations)
  const res = await fetch('https://kagi.com/api/v0/fastgpt', {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`Kagi FastGPT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const output = data.data?.output;
  const refs = data.data?.references || [];

  if (!output) throw new Error(`Kagi returned no output: ${JSON.stringify(data)}`);

  // Format with citations for downstream consumption
  const citationBlock = refs.length > 0
    ? '\n\n---\nSources:\n' + refs.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`).join('\n')
    : '';
  return output + citationBlock;
}

// --- Conversation state ---
let contents = []; // Gemini format: [{ role: 'user'|'model', parts: [{ text }] }]
let saved = false;
let lastGeminiResponse = '';

function addUser(text) {
  contents.push({ role: 'user', parts: [{ text }] });
}

function addModel(text) {
  contents.push({ role: 'model', parts: [{ text }] });
}

// --- Save conversation ---
function saveConversation(filename) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = filename || `exchange-${ts}`;
  const outPath = join(EXCHANGES_DIR, `${name}.json`);
  const payload = {
    provider: PROVIDER,
    model: MODEL,
    saved_at: new Date().toISOString(),
    turn_count: contents.length,
    contents,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  saved = true;
  return outPath;
}

// --- Pretty print Gemini response ---
function printResponse(text) {
  const parsed = extractJson(text);
  if (parsed) {
    console.log('\n\x1b[36mgemini>\x1b[0m');
    console.log(JSON.stringify(parsed, null, 2));
  } else {
    console.log(`\n\x1b[36mgemini>\x1b[0m ${text}`);
  }
  console.log();
}

// --- Resume ---
if (RESUME_FILE) {
  const resumePath = RESUME_FILE.startsWith('/')
    ? RESUME_FILE
    : join(EXCHANGES_DIR, RESUME_FILE.endsWith('.json') ? RESUME_FILE : `${RESUME_FILE}.json`);
  if (!existsSync(resumePath)) {
    const msg = `File not found: ${resumePath}`;
    if (PROMPT) { console.log(JSON.stringify({ error: msg })); }
    else { console.error(`  ${msg}`); }
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(resumePath, 'utf8'));
  contents = data.contents || [];
  if (!argVal('--model')) MODEL = data.model || MODEL;
  if (!argVal('--provider') && data.provider) PROVIDER = data.provider;
  if (!PROMPT) {
    console.log(`  Resumed ${contents.length} turns from ${resumePath}`);
    console.log(`  Provider: ${PROVIDER} | Model: ${MODEL}`);
  }
}

// ============================================================
// NON-INTERACTIVE MODE (--prompt)
// ============================================================
if (PROMPT) {
  // Build conversation: system context (if fresh) + user prompt
  // Wolfram is a computational engine — no system context, just the query
  if (PROVIDER === 'wolfram') {
    addUser(PROMPT);
  } else if (contents.length === 0 && !FOLLOW_UP) {
    addUser(buildSystemContext() + '\n\n---\n\n' + PROMPT);
  } else {
    addUser(PROMPT);
  }

  try {
    const response = await callLLM(contents);
    addModel(response);

    // Extract structured JSON
    const parsed = extractJson(response);
    const confabulations = evalResponse(response);

    // Build output object for Claude Code to consume
    const output = {
      provider: PROVIDER,
      model: MODEL,
      raw: response,
      parsed: parsed || null,
      findings: parsed?.findings || [],
      summary: parsed?.summary || null,
      confabulations,
      turn_count: contents.length,
    };

    // Save if requested
    if (SAVE_NAME) {
      output.saved_to = saveConversation(SAVE_NAME);
    }

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
  process.exit(0);
}

// ============================================================
// INTERACTIVE REPL MODE (no --prompt)
// ============================================================

// --- Banner ---
console.log();
console.log('\x1b[1m  External AI Feedback REPL\x1b[0m');
console.log(`  Provider: ${PROVIDER} | Model: ${MODEL}`);
console.log(`  Commands: .save [name] | .context | .eval | .model [name] | .quit`);
console.log();

// --- Dry run ---
if (DRY_RUN) {
  console.log('\x1b[33m--- System Context (would be sent as first message) ---\x1b[0m\n');
  console.log(buildSystemContext());
  console.log('\n\x1b[33m--- End ---\x1b[0m');
  process.exit(0);
}

// --- Send system context if fresh conversation ---
if (contents.length === 0) {
  addUser(buildSystemContext());
  console.log('  Sending system context...');
  try {
    const response = await callLLM(contents);
    addModel(response);
    lastGeminiResponse = response;
    printResponse(response);
    saved = false;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }
}

// --- REPL ---
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[32myou>\x1b[0m ',
});

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }

  // --- Commands ---
  if (input.startsWith('.')) {
    const [cmd, ...args] = input.split(/\s+/);

    switch (cmd) {
      case '.quit':
      case '.exit': {
        if (!saved && contents.length > 1) {
          const path = saveConversation();
          console.log(`  Auto-saved: ${path}`);
        }
        console.log('  Bye.');
        process.exit(0);
      }

      case '.save': {
        const path = saveConversation(args[0]);
        console.log(`  Saved: ${path}`);
        rl.prompt();
        return;
      }

      case '.context': {
        addUser(buildSystemContext() + '\n\n(Context re-sent as a reminder. Please acknowledge.)');
        try {
          const response = await callLLM(contents);
          addModel(response);
          lastGeminiResponse = response;
          printResponse(response);
          saved = false;
        } catch (err) {
          console.error(`  Error: ${err.message}`);
        }
        rl.prompt();
        return;
      }

      case '.eval': {
        if (!lastGeminiResponse) {
          console.log('  No Gemini response to evaluate.');
          rl.prompt();
          return;
        }
        const flags = evalResponse(lastGeminiResponse);
        if (flags.length === 0) {
          console.log('  No confabulations detected against known facts.');
        } else {
          console.log(`\n\x1b[31m  ${flags.length} issue(s) detected:\x1b[0m`);
          for (const f of flags) {
            console.log(`  - ${f}`);
          }
        }
        console.log();
        rl.prompt();
        return;
      }

      case '.model': {
        if (args[0]) {
          MODEL = args[0];
          console.log(`  Model switched to: ${MODEL}`);
        } else {
          console.log(`  Current model: ${MODEL}`);
        }
        rl.prompt();
        return;
      }

      default:
        console.log(`  Unknown command: ${cmd}`);
        rl.prompt();
        return;
    }
  }

  // --- Regular message ---
  addUser(input);
  try {
    const response = await callLLM(contents);
    addModel(response);
    lastGeminiResponse = response;
    printResponse(response);
    saved = false;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    // Remove the failed user message so conversation stays consistent
    contents.pop();
  }
  rl.prompt();
});

rl.on('close', () => {
  if (!saved && contents.length > 1) {
    const path = saveConversation();
    console.log(`\n  Auto-saved: ${path}`);
  }
  console.log('  Bye.');
  process.exit(0);
});
