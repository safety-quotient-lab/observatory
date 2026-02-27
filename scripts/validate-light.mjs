#!/usr/bin/env node
/**
 * Validates the light prompt against the 15-URL calibration set.
 *
 * Runs each URL through the standalone evaluator (same claude -p path),
 * compares the editorial score to the expected range, and prints a report.
 *
 * Usage:
 *   node validate-light.mjs [--concurrency N]
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { dirname, join } from 'path';

// --- Load .env ---
const devVarsPath = new URL('../site/.dev.vars', import.meta.url).pathname;
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

const MODEL_ID = 'claude-haiku-4-5';
const CLAUDE_BIN = join(dirname(process.execPath), 'claude');

// --- Calibration set (light-1.x / editorial-channel-only ranges) ---
//
// These ranges are calibrated for a PURELY EDITORIAL model. They differ from the
// full-model calibration set (v3.1) in two systematic ways:
//
// 1. EP sites score higher: no structural channel (cookies, trackers, A/B tests)
//    pulling rights-advocacy orgs below their editorial signal.
//
// 2. EX commercial sites (Shopify, Booking) score near 0: their negatives
//    come from dark patterns and labor supply chains — invisible to editorial scoring.
//    Jacobin (jacobin.com) scores POSITIVE editorially: labor/economic rights advocacy.
//    State media (presstv.ir, globaltimes.cn) remain negative.
//
// URL selection: sites were chosen for accessible non-JS text content:
//   EX-2 → presstv.ir (Iranian state media, 22K readable, stable government framing)
//   EX-4 → jacobin.com (socialist magazine, clear editorial voice, stable)
//   EX-5 → globaltimes.cn (English Chinese state media vs inaccessible xinhuanet.com)
const CALIBRATION = [
  // EP: positive — rights advocacy / investigative journalism
  { slot: 'EP-1', url: 'https://www.amnesty.org/en/what-we-do/', lo: 0.75, hi: 1.00 },
  { slot: 'EP-2', url: 'https://www.eff.org/deeplinks',          lo: 0.70, hi: 0.95 },
  { slot: 'EP-3', url: 'https://www.hrw.org',                    lo: 0.70, hi: 0.95 },
  { slot: 'EP-4', url: 'https://www.propublica.org',             lo: 0.45, hi: 0.75 },
  { slot: 'EP-5', url: 'https://archive.org',                    lo: 0.30, hi: 0.90 },
  // EN: neutral — zero or near-zero editorial rights content
  { slot: 'EN-1', url: 'https://www.weather.gov',                lo: -0.05, hi: 0.10 },
  { slot: 'EN-2', url: 'https://www.timeanddate.com',            lo: -0.08, hi: 0.15 },
  { slot: 'EN-3', url: 'https://www.xe.com',                     lo: -0.05, hi: 0.20 },
  { slot: 'EN-4', url: 'https://en.wikipedia.org/wiki/Oxygen',   lo:  0.00, hi: 0.10 },
  { slot: 'EN-5', url: 'https://www.merriam-webster.com',        lo: -0.05, hi: 0.10 },
  // EX: negative editorially (state media) or neutral (commercial)
  { slot: 'EX-1', url: 'https://www.shopify.com',                lo: -0.10, hi: 0.25 },  // e-commerce platform, commercial SaaS, no editorial voice
  { slot: 'EX-2', url: 'https://www.presstv.ir',                 lo: -0.80, hi: -0.20 }, // Iranian state media: government-aligned framing
  { slot: 'EX-3', url: 'https://www.booking.com',                lo: -0.10, hi: 0.15 },  // neutral editorial; dark patterns invisible
  { slot: 'EX-4', url: 'https://jacobin.com',                    lo:  0.35, hi: 0.90 },  // Socialist magazine: labor/economic rights = moderate-to-high positive
  { slot: 'EX-5', url: 'https://www.globaltimes.cn',             lo: -0.80, hi: -0.10 }, // Chinese state media, English — CPC editorial framing
];

// --- Prompt (must match evaluate-standalone.mjs exactly) ---
const SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score the AUTHOR'S EDITORIAL STANCE toward human rights, not the subject matter.

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

const RAW_HTML_MAX_CHARS = 30_000;

async function fetchContent(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'HN-HRCB-Bot/1.0', 'Accept': 'text/html,text/plain' },
    });
    return (await res.text()).slice(0, RAW_HTML_MAX_CHARS);
  } catch (err) {
    return `[fetch_error] ${err.message}`;
  }
}

function buildUserMessage(url, content) {
  return `Evaluate this URL: ${url}\n\nHere is the page content (truncated):\n\n${content}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}\n\nOutput ONLY the JSON evaluation object, no other text.`;
}

function callClaude(userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', '--model', MODEL_ID,
      '--system-prompt', SYSTEM_PROMPT,
      '--no-session-persistence',
      '--output-format', 'text',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.stdin.write(userMessage);
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 120_000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      else resolve(stdout);
    });
  });
}

function extractJson(raw) {
  let text = raw.trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON found');
  return JSON.parse(text.slice(first, last + 1));
}

async function evaluateOne(cal) {
  const start = Date.now();
  const content = await fetchContent(cal.url);
  const raw = await callClaude(buildUserMessage(cal.url, content));
  const result = extractJson(raw);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const score = result.evaluation?.editorial ?? null;
  const pass = score !== null && score >= cal.lo && score <= cal.hi;
  return { ...cal, score, pass, elapsed, sentiment: result.sentiment_tag, desc: result.short_description };
}

// --- Main ---
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i !== -1 ? args[i+1] : undefined; }
const concurrency = parseInt(argVal('--concurrency') ?? '3');

console.log(`\nHRCB Light-1.2 Calibration Validation — model: ${MODEL_ID}`);
console.log(`Concurrency: ${concurrency} | URLs: ${CALIBRATION.length}\n`);

const results = [];
for (let i = 0; i < CALIBRATION.length; i += concurrency) {
  const chunk = CALIBRATION.slice(i, i + concurrency);
  process.stdout.write(`Running ${chunk.map(c => c.slot).join(', ')}...`);
  const settled = await Promise.allSettled(chunk.map(evaluateOne));
  console.log(' done');
  for (let j = 0; j < settled.length; j++) {
    if (settled[j].status === 'fulfilled') {
      results.push(settled[j].value);
    } else {
      results.push({ ...chunk[j], score: null, pass: false, elapsed: '?', error: settled[j].reason?.message });
    }
  }
}

// --- Report ---
const passed = results.filter(r => r.pass).length;
const total = results.length;
const passRate = ((passed / total) * 100).toFixed(0);

console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
console.log(`│  HRCB light-1.2 calibration  —  ${passed}/${total} passed (${passRate}%)`.padEnd(77) + '│');
console.log('├──────┬────────────────────────────────┬───────────────┬───────┬───────┬──────┤');
console.log('│ Slot │ URL                            │ Expected      │ Score │  Time │ Pass │');
console.log('├──────┼────────────────────────────────┼───────────────┼───────┼───────┼──────┤');

for (const r of results) {
  const slot   = r.slot.padEnd(4);
  const url    = r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30).padEnd(30);
  const range  = `${r.lo >= 0 ? '+' : ''}${r.lo.toFixed(2)} to ${r.hi >= 0 ? '+' : ''}${r.hi.toFixed(2)}`.padEnd(13);
  const score  = r.score !== null ? (r.score >= 0 ? '+' : '') + r.score.toFixed(3) : ' error';
  const time   = `${r.elapsed}s`.padStart(5);
  const status = r.pass ? ' ✓  ' : r.error ? ' ERR' : ' ✗  ';
  console.log(`│ ${slot} │ ${url} │ ${range} │ ${score} │ ${time} │ ${status} │`);
}

console.log('└──────┴────────────────────────────────┴───────────────┴───────┴───────┴──────┘');

if (passed < total) {
  console.log('\nFailed / errored:');
  for (const r of results.filter(r => !r.pass)) {
    if (r.error) {
      console.log(`  ${r.slot}: ERROR — ${r.error}`);
    } else {
      const dir = r.score > r.hi ? 'too high' : 'too low';
      console.log(`  ${r.slot} (${r.url.replace(/^https?:\/\/(www\.)?/,'')}): scored ${r.score >= 0 ? '+' : ''}${r.score?.toFixed(3)}, expected [${r.lo >= 0?'+':''}${r.lo.toFixed(2)}, ${r.hi >= 0?'+':''}${r.hi.toFixed(2)}] — ${dir}`);
    }
  }
}

console.log(`\nAvg time per URL: ${(results.filter(r=>r.elapsed!=='?').reduce((s,r)=>s+parseFloat(r.elapsed),0)/results.length).toFixed(1)}s`);
