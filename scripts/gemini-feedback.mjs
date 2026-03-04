#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Gemini Feedback REPL — multi-turn structured feedback exchange with Gemini.
 *
 * Sends site context (agent-card, methodology summary, architecture) and
 * receives structured JSON feedback. Saves exchanges to disk for evaluation.
 *
 * Usage:
 *   node scripts/gemini-feedback.mjs [options]
 *
 * Options:
 *   --model MODEL     Gemini model (default: gemini-2.0-flash)
 *   --dry-run         Print system context and exit
 *   --resume FILE     Resume a saved conversation
 *
 * Requires GOOGLE_API_KEY in site/.dev.vars
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

const API_KEY = process.env.GOOGLE_API_KEY;
let MODEL = argVal('--model') || 'gemini-2.0-flash';
const DRY_RUN = hasFlag('--dry-run');
const RESUME_FILE = argVal('--resume');
const EXCHANGES_DIR = join(ROOT, '.claude/plans/memorized/gemini-exchanges');

if (!API_KEY && !DRY_RUN) {
  console.error('  GOOGLE_API_KEY not found in site/.dev.vars');
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
    'Please respond in JSON with this structure:',
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

// --- Gemini API ---
async function callGemini(contents) {
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
  // Try to parse as JSON for pretty printing
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = jsonMatch ? jsonMatch[1].trim() : text;
  try {
    const parsed = JSON.parse(raw);
    console.log('\n\x1b[36mgemini>\x1b[0m');
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
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
    console.error(`  File not found: ${resumePath}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(resumePath, 'utf8'));
  contents = data.contents || [];
  MODEL = data.model || MODEL;
  console.log(`  Resumed ${contents.length} turns from ${resumePath}`);
  console.log(`  Model: ${MODEL}`);
}

// --- Banner ---
console.log();
console.log('\x1b[1m  Gemini Feedback REPL\x1b[0m');
console.log(`  Model: ${MODEL}`);
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
    const response = await callGemini(contents);
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
          const response = await callGemini(contents);
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
    const response = await callGemini(contents);
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
