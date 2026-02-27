#!/usr/bin/env node
/**
 * Validates light-1.2 + DCP-assisted evaluation against the 15-URL calibration set.
 * Two-step per domain:
 *   1. Fetch root page → generate lightweight domain context profile (DCP)
 *   2. Fetch article page → editorial evaluation WITH DCP as context
 *
 * Compares results side-by-side with the baseline (no-DCP) scores from 3 prior runs.
 *
 * Usage:
 *   node validate-light-dcp.mjs [--concurrency N]
 */

import { readFileSync, existsSync } from 'fs';
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
const RAW_HTML_MAX_CHARS = 30_000;

// --- Calibration set (editorial-only ranges) — matches validate-light.mjs ---
const CALIBRATION = [
  { slot: 'EP-1', url: 'https://www.amnesty.org/en/what-we-do/', lo: 0.75, hi: 1.00 },
  { slot: 'EP-2', url: 'https://www.eff.org/deeplinks',          lo: 0.70, hi: 0.95 },
  { slot: 'EP-3', url: 'https://www.hrw.org',                    lo: 0.70, hi: 0.95 },
  { slot: 'EP-4', url: 'https://www.propublica.org',             lo: 0.45, hi: 0.75 },
  { slot: 'EP-5', url: 'https://archive.org',                    lo: 0.30, hi: 0.90 },
  { slot: 'EN-1', url: 'https://www.weather.gov',                lo: -0.05, hi: 0.10 },
  { slot: 'EN-2', url: 'https://www.timeanddate.com',            lo: -0.08, hi: 0.15 },
  { slot: 'EN-3', url: 'https://www.xe.com',                     lo: -0.05, hi: 0.20 },
  { slot: 'EN-4', url: 'https://en.wikipedia.org/wiki/Oxygen',   lo:  0.00, hi: 0.10 },
  { slot: 'EN-5', url: 'https://www.merriam-webster.com',        lo: -0.05, hi: 0.10 },
  { slot: 'EX-1', url: 'https://www.shopify.com',                lo: -0.10, hi: 0.25 },
  { slot: 'EX-2', url: 'https://www.presstv.ir',                 lo: -0.80, hi: -0.20 },
  { slot: 'EX-3', url: 'https://www.booking.com',                lo: -0.10, hi: 0.15 },
  { slot: 'EX-4', url: 'https://jacobin.com',                    lo:  0.35, hi: 0.90 },
  { slot: 'EX-5', url: 'https://www.globaltimes.cn',             lo: -0.80, hi: -0.10 },
];

// Baseline no-DCP scores from 2 prior runs (passes 12 & 13 of validate-light.mjs, mean, σ)
// Note: σ is sample std dev from 2 runs = |x1-x2|/sqrt(2)
const BASELINE = {
  'EP-1': { mean: 0.890, sigma: 0.014 }, 'EP-2': { mean: 0.830, sigma: 0.042 },
  'EP-3': { mean: 0.905, sigma: 0.021 }, 'EP-4': { mean: 0.700, sigma: 0.000 },
  'EP-5': { mean: 0.610, sigma: 0.156 }, 'EN-1': { mean: 0.000, sigma: 0.000 },
  'EN-2': { mean: 0.060, sigma: 0.085 }, 'EN-3': { mean: 0.000, sigma: 0.000 },
  'EN-4': { mean: 0.000, sigma: 0.000 }, 'EN-5': { mean: 0.000, sigma: 0.000 },
  'EX-1': { mean: 0.000, sigma: 0.000 }, 'EX-2': { mean: -0.685, sigma: 0.049 },
  'EX-3': { mean: 0.000, sigma: 0.000 }, 'EX-4': { mean: 0.765, sigma: 0.021 },
  'EX-5': { mean: -0.390, sigma: 0.297 },
};

// --- DCP system prompt (editorial author identity only — no structural signals) ---
const DCP_SYSTEM_PROMPT = `You are an editorial author profiler. Given a website's root page, identify who is speaking and what their editorial voice is. Focus only on editorial identity — ignore tracking, ads, data practices, and technical infrastructure.

Output ONLY a JSON object. No markdown, no explanation.

{
  "author_type": "<state-media|nonprofit-advocacy|independent-journalism|commercial|social-platform|utility|other>",
  "editorial_voice": "<one sentence: what is this author's known editorial stance on human rights, or 'no editorial voice' if it is a utility/tool>",
  "editorial_relevance": "<high|medium|low|none>"
}`;

// --- Editorial system prompt (light-1.2, same as validate-light.mjs) ---
const EDITORIAL_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score the AUTHOR'S EDITORIAL STANCE toward human rights, not the subject matter.

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

// --- Helpers ---

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

function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', '--model', MODEL_ID,
      '--system-prompt', systemPrompt,
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

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// --- Step 1: Generate DCP for a domain ---
async function generateDcp(domain, rootUrl) {
  const content = await fetchContent(rootUrl);
  const userMsg = `Domain: ${domain}\n\nRoot page content (truncated):\n\n${content}`;
  const raw = await callClaude(DCP_SYSTEM_PROMPT, userMsg);
  return extractJson(raw);
}

// --- Step 2: Editorial evaluation WITH DCP context ---
async function evaluateWithDcp(url, dcp) {
  const content = await fetchContent(url);
  const dcpLine = `Author context: ${dcp.editorial_voice} (author type: ${dcp.author_type}, editorial relevance: ${dcp.editorial_relevance})`;
  const userMsg = `${dcpLine}

Evaluate this URL: ${url}

Here is the page content (truncated):

${content}

Today's date: ${new Date().toISOString().slice(0, 10)}

Output ONLY the JSON evaluation object, no other text.`;
  const raw = await callClaude(EDITORIAL_SYSTEM_PROMPT, userMsg);
  return extractJson(raw);
}

// --- Evaluate one calibration entry ---
async function evaluateOne(cal) {
  const start = Date.now();
  const domain = domainOf(cal.url);
  const rootUrl = `https://${domain}`;

  // Step 1: DCP
  const dcpStart = Date.now();
  const dcp = await generateDcp(domain, rootUrl);
  const dcpMs = Date.now() - dcpStart;

  // Step 2: Editorial with DCP
  const result = await evaluateWithDcp(cal.url, dcp);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const score = result.evaluation?.editorial ?? null;
  const pass = score !== null && score >= cal.lo && score <= cal.hi;

  return { ...cal, score, pass, elapsed, dcpMs, dcp, sentiment: result.sentiment_tag };
}

// --- Main ---
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i !== -1 ? args[i+1] : undefined; }
const concurrency = parseInt(argVal('--concurrency') ?? '3');

console.log(`\nHRCB Light-1.2 + DCP Calibration Validation — model: ${MODEL_ID}`);
console.log(`Concurrency: ${concurrency} | URLs: ${CALIBRATION.length}`);
console.log(`Two-step: domain DCP → editorial evaluation\n`);

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

// --- Side-by-side report ---
const passed = results.filter(r => r.pass).length;
const total = results.length;

console.log('\n┌──────┬───────────────┬─────────────────────────────────┬─────────────────────────────────┐');
console.log('│      │               │  No DCP (3-run baseline)        │  With DCP (this run)            │');
console.log('│ Slot │ Expected      │  Mean   σ      Reliable?        │  Score  Δmean  Pass?            │');
console.log('├──────┼───────────────┼─────────────────────────────────┼─────────────────────────────────┤');

for (const r of results) {
  const b = BASELINE[r.slot];
  const slot  = r.slot.padEnd(4);
  const range = `${r.lo >= 0 ? '+' : ''}${r.lo.toFixed(2)} to ${r.hi >= 0 ? '+' : ''}${r.hi.toFixed(2)}`.padEnd(13);

  // Baseline column
  const bMean  = (b.mean >= 0 ? '+' : '') + b.mean.toFixed(3);
  const bSigma = b.sigma.toFixed(3);
  const bReliable = b.sigma < 0.10 ? '✓ stable' : b.sigma < 0.20 ? '~ noisy ' : '✗ noisy ';

  // DCP column
  const dScore = r.score !== null ? (r.score >= 0 ? '+' : '') + r.score.toFixed(3) : ' error ';
  const dDelta = r.score !== null ? (r.score - b.mean >= 0 ? '+' : '') + (r.score - b.mean).toFixed(3) : '  n/a  ';
  const dPass  = r.pass ? '✓' : r.error ? 'ERR' : '✗';

  console.log(`│ ${slot} │ ${range} │ ${bMean}  ${bSigma}  ${bReliable} │ ${dScore}  ${dDelta}  ${dPass.padEnd(4)}            │`);
}

console.log('└──────┴───────────────┴─────────────────────────────────┴─────────────────────────────────┘');
console.log(`\nDCP pass rate: ${passed}/${total} (${((passed/total)*100).toFixed(0)}%)`);

// DCP context summary for noisy slots
console.log('\n── DCP context for noisy slots ──');
for (const r of results.filter(r => BASELINE[r.slot].sigma >= 0.15)) {
  if (r.dcp) {
    console.log(`\n${r.slot} (${domainOf(r.url)})`);
    console.log(`  Voice: ${r.dcp.editorial_voice}`);
    console.log(`  author_type=${r.dcp.author_type}, relevance=${r.dcp.editorial_relevance}`);
    console.log(`  Baseline: mean=${BASELINE[r.slot].mean >= 0 ? '+' : ''}${BASELINE[r.slot].mean.toFixed(3)}, σ=${BASELINE[r.slot].sigma.toFixed(3)}`);
    console.log(`  With DCP: ${r.score !== null ? (r.score >= 0 ? '+' : '') + r.score.toFixed(3) : 'error'} (${r.pass ? 'PASS' : 'FAIL'})`);
  }
}

const avgTime = results.filter(r => r.elapsed !== '?').reduce((s,r) => s + parseFloat(r.elapsed), 0) / results.length;
console.log(`\nAvg time per URL (both steps): ${avgTime.toFixed(1)}s`);
