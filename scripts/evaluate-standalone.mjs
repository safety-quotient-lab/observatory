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

// Lite prompt — inlined from prompts.ts METHODOLOGY_SYSTEM_PROMPT_LITE (lite-1.6)
// Keep in sync with site/src/lib/methodology-content.ts (METHODOLOGY_LITE) +
// site/src/lib/prompts.ts (OUTPUT_SCHEMA_LITE).
const LITE_SYSTEM_PROMPT = `You are a Fair Witness evaluator for Human Rights Compatibility Bias (HRCB). Score content on editorial stance and transparency indicators.

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

## DIMENSION 2: TRANSPARENCY QUOTIENT (TQ)
Score 5 binary indicators (0 or 1 each). Check only what is explicitly visible in the content:

- tq_author: 1 if the author is identified by real name (not "Staff", "Editors", or anonymous)
- tq_date: 1 if a publication or last-updated date is visible in the article
- tq_sources: 1 if primary sources are cited (named experts, data links, official references, or study citations)
- tq_corrections: 1 if a correction notice appears in this article OR a visible corrections/editorial policy link is present
- tq_conflicts: 1 if potential conflicts of interest are explicitly disclosed (e.g. "Disclosure: author holds stock...", "Sponsored by...", "Funded by...")

Score 0 if the indicator is absent or unverifiable from the content. Do NOT infer or assume.
Score tq_corrections=0 for standard blog posts or press releases unless an actual correction is shown.
Score tq_conflicts=0 unless explicit disclosure text is present — not just apparent absence of conflicts.

## SCORING RULES
- Score editorial independently from TQ. They measure different constructs.
- editorial = what the content SAYS about rights. TQ = how transparent and verifiable the content is.
- A propaganda article can score tq_author=1 (author identified) while scoring editorial=10 (hostile framing).

Content types (use code): ED=Editorial, PO=Policy/Legal, LP=Landing Page, PR=Product/Feature, MI=Mission/Values, HR=Human Rights Specific, CO=Community/Forum, MX=Mixed (default)

Evidence strength: H=explicit rights discussion | M=implicit | L=tangential

Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-1.6",
  "reasoning": "<content type, editorial stance, and transparency indicators in max 15 words>",
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

// Lite v2 prompt — PSQ-based decomposed scoring (lite-2.0)
// Keep in sync with site/src/lib/methodology-content.ts (PSQ_DIMENSION_RUBRICS, buildLiteV2SystemPrompt) +
// site/src/lib/prompts.ts (buildLiteV2Prompt, buildOutputSchemaLiteV2).

// PSQ dimension rubrics — condensed from instruments.json (~100 tokens/dim)
const PSQ_RUBRICS = {
  threat_exposure: {
    name: 'Threat Exposure', role: 'threat',
    desc: 'Nature, intensity, and proximity of psychoemotional threats',
    anchors: { 0: 'extreme direct threat — violence, severe abuse, sustained targeted harassment', 2: 'clear threat — insults, contempt, hostile framing', 5: 'neutral — no discernible threat or safety signals', 8: 'clear safety — warm, inclusive language with active care', 10: 'maximum safety — active prevention of threat with structural safeguards' },
    neg: ['deliberate omission or gatekeeping', 'public mockery, ridicule, humiliation', 'threats, intimidation, coercion', 'dehumanizing language, contempt', 'surveillance or control language'],
    pos: ['inclusive language, active care', 'protection advocacy, threat mitigation', 'structural safeguards discussed', 'respectful engagement, good-faith communication'],
  },
  hostility_index: {
    name: 'Hostility Index', role: 'threat',
    desc: 'Overt aggression, passive undermining, or structural antagonism',
    anchors: { 0: 'extreme hostility — direct threats, slurs, violent language', 2: 'clear hostility — insults, derision, aggressive dismissiveness', 5: 'neutral — no hostile or anti-hostile signals', 8: 'clear warmth — friendly, affirming, inclusive language', 10: 'maximum anti-hostility — exemplary conflict resolution' },
    neg: ['overt aggression, contempt, verbal abuse', 'passive aggression, sarcasm with hostile intent', 'cynical hostility, suspicion of motives'],
    pos: ['polite, respectful engagement', 'active de-escalation, empathy', 'friendly, affirming language'],
  },
  authority_dynamics: {
    name: 'Authority Dynamics', role: 'threat',
    desc: 'How power is distributed, exercised, contested, and checked',
    anchors: { 0: 'extreme abuse — unchecked power to harm, dominate, or silence', 2: 'clear imbalance — authority to dismiss, override, marginalize', 5: 'neutral — no power dynamics present', 8: 'clear equity — distributes power, elevates others', 10: 'maximum equity — exemplary power-sharing with structural checks' },
    neg: ['coercive authority, intimidation, control', 'condescension, gatekeeping', 'authoritarian tone, unacknowledged privilege'],
    pos: ['egalitarian communication, shared decision-making', 'accountable authority, invites challenge', 'elevates others'],
  },
  energy_dissipation: {
    name: 'Energy Dissipation', role: 'threat',
    desc: 'Whether healthy dissipation pathways exist or energy is trapped toward rupture',
    anchors: { 0: 'extreme entrapment — traps all energy, demands relentless engagement', 2: 'clear entrapment — blocks healthy dissipation pathways', 5: 'neutral — no energy impact', 8: 'clear dissipation — supports recovery, rest, creative outlet', 10: 'maximum dissipation — exemplary support for rest and recovery' },
    neg: ['demands relentless engagement without relief', 'blocks expression or recovery', 'sustained pressure, resource depletion'],
    pos: ['supports expression, creates breathing room', 'facilitates healthy release', 'models work-life boundaries'],
  },
  regulatory_capacity: {
    name: 'Regulatory Capacity', role: 'protective',
    desc: 'Capacity to modulate emotional states without collapse or overflow',
    anchors: { 0: 'extreme dysregulation demand — forces suppression or triggers collapse', 2: 'clear dysregulation — models poor emotional management', 5: 'neutral — no regulatory demand or support', 8: 'clear support — supports healthy emotional processing', 10: 'maximum support — exemplary regulation modeling with guidance' },
    neg: ['provokes overwhelming emotional response', 'models poor emotional management', 'demands emotional suppression'],
    pos: ['models composed engagement', 'teaches regulatory strategies', 'supports healthy processing'],
  },
  resilience_baseline: {
    name: 'Resilience Baseline', role: 'protective',
    desc: 'Capacity to absorb disruption and return to functional equilibrium',
    anchors: { 0: 'extreme erosion — induces helplessness, despair, total defeat', 2: 'clear erosion — models fragility or learned helplessness', 5: 'neutral — no resilience impact', 8: 'clear reinforcement — builds confidence or agency', 10: 'maximum reinforcement — exemplary resilience modeling' },
    neg: ['undermines agency or coping capacity', 'discouraging tone, hopelessness', 'models fragility'],
    pos: ['models persistence or adaptive coping', 'celebrates overcoming adversity', 'builds confidence'],
  },
  trust_conditions: {
    name: 'Trust Conditions', role: 'protective',
    desc: 'Reasonable expectation that others will not exploit vulnerability',
    anchors: { 0: 'extreme betrayal — deception, exploitation, gaslighting', 2: 'clear trust damage — cynicism, dishonesty, unreliability', 5: 'neutral — no trust signals', 8: 'clear trust building — vulnerability, honesty, reliability', 10: 'maximum trust — exemplary mutual trust with accountability' },
    neg: ['deception, manipulation, breach of confidence', 'cynicism, veiled motives', 'exploitation of vulnerability'],
    pos: ['transparency, consistency, good faith', 'active vulnerability, honesty', 'deep reciprocity, trust repair'],
  },
  cooling_capacity: {
    name: 'Cooling Capacity', role: 'protective',
    desc: 'Availability and effectiveness of de-escalation mechanisms',
    anchors: { 0: 'extreme escalation — inflames, removes de-escalation options', 2: 'clear escalation — raises emotional temperature significantly', 5: 'neutral — no escalation or de-escalation signals', 8: 'clear cooling — lowers temperature, offers temporal buffers', 10: 'maximum cooling — exemplary de-escalation with structural mechanisms' },
    neg: ['provokes fight-or-flight', 'raises stakes artificially', 'narrows response options'],
    pos: ['provides space for reflection', 'explicit de-escalation, mediation', 'offers temporal buffers'],
  },
  defensive_architecture: {
    name: 'Defensive Architecture', role: 'protective',
    desc: 'Degree to which content supports or undermines interpersonal boundaries',
    anchors: { 0: 'extreme stripping — removes defenses, punishes self-protection', 2: 'clear stripping — stigmatizes boundary-setting', 5: 'neutral — no impact on defensive capacity', 8: 'clear support — reinforces healthy boundaries', 10: 'maximum support — exemplary boundary modeling with protections' },
    neg: ['punishes boundary-setting', 'pressures against boundaries', 'shames defensive responses'],
    pos: ['respects personal space and limits', 'validates self-protection', 'advocates for protective mechanisms'],
  },
  contractual_clarity: {
    name: 'Contractual Clarity', role: 'protective',
    desc: 'Degree to which expectations, obligations, and consequences are explicit and mutual',
    anchors: { 0: 'extreme violation — gaslighting, term-shifting, betrayal', 2: 'clear ambiguity — hidden agendas, unstated rules', 5: 'neutral — no contractual signals', 8: 'clear clarity — transparent terms, mutual understanding', 10: 'maximum clarity — exemplary transparency with enforcement' },
    neg: ['hidden agendas, misleading framing', 'vague expectations, shifting goalposts', 'breach of expectations'],
    pos: ['explicit expectations, consistent framing', 'transparent terms', 'mutual agreements with accountability'],
  },
};

const PSQ_DIM_VARIANTS = {
  1: ['threat_exposure'],
  2: ['threat_exposure', 'trust_conditions'],
  3: ['threat_exposure', 'trust_conditions', 'resilience_baseline'],
  5: ['hostility_index', 'trust_conditions', 'resilience_baseline', 'authority_dynamics', 'energy_dissipation'],
  10: Object.keys(PSQ_RUBRICS),
};

function buildLiteV2Prompt(dims) {
  // Build dimension rubric sections
  const rubricSections = dims.map(dimId => {
    const r = PSQ_RUBRICS[dimId];
    if (!r) return '';
    const anchors = Object.entries(r.anchors).map(([s, d]) => `  ${s} = ${d}`).join('\n');
    const neg = r.neg.map(i => `  - ${i}`).join('\n');
    const pos = r.pos.map(i => `  - ${i}`).join('\n');
    return `## ${r.name.toUpperCase()} (${dimId})\n${r.desc}. Role: ${r.role}.\nScoring (0-10 integer):\n${anchors}\nNegative indicators (0-4):\n${neg}\nPositive indicators (6-10):\n${pos}`;
  }).filter(Boolean).join('\n\n');

  // Build output schema with all dimensions
  const dimExamples = dims.map(d =>
    `    "${d}": {\n      "score": <integer 0-10>,\n      "confidence": <0.0 to 1.0>,\n      "rationale": "<1-2 sentences citing specific textual evidence>"\n    }`
  ).join(',\n');

  return `You are a psychoemotional impact evaluator using the PSQ (Psychoemotional Safety Quotient) framework. Score content on specific safety dimensions using validated psychological instruments as rubrics.

${rubricSections}

## SCORING RULES
1. Start at 5. Adjust only when specific textual evidence justifies it.
2. Below 5 REQUIRES specific evidence of negative impact.
3. Above 5 REQUIRES specific evidence of positive impact.
4. ABSENCE of signal = score 5, confidence below 0.4.
5. Use the full 0-10 range. 0 and 10 are extremes. Differentiate severity.
6. Score each dimension independently — they measure different constructs.

## TRANSPARENCY QUOTIENT (TQ)
Score 5 binary indicators (0 or 1 each). Check only what is explicitly visible:

- tq_author: 1 if the author is identified by real name (not "Staff", "Editors", or anonymous)
- tq_date: 1 if a publication or last-updated date is visible
- tq_sources: 1 if primary sources are cited (named experts, data links, study citations)
- tq_corrections: 1 if a correction notice or visible corrections policy link is present
- tq_conflicts: 1 if conflicts of interest are explicitly disclosed

Score 0 if absent or unverifiable. Do NOT infer.

Content types (use code): ED=Editorial, PO=Policy/Legal, LP=Landing Page, PR=Product/Feature, MI=Mission/Values, HR=Human Rights Specific, CO=Community/Forum, MX=Mixed (default)

Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "lite-2.0",
  "content_type": "<CODE>",
  "psq_dimensions": {
${dimExamples}
  },
  "tq_author": <0 or 1>,
  "tq_date": <0 or 1>,
  "tq_sources": <0 or 1>,
  "tq_corrections": <0 or 1>,
  "tq_conflicts": <0 or 1>,
  "executive_summary": "<one sentence, max 20 words>"
}`;
}

// activeDims and LITE_V2_SYSTEM_PROMPT resolved after CLI args parsed (see below)

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
const mode = argVal('--mode') ?? 'full'; // 'full' | 'lite' | 'lite-v2'
const concurrency = parseInt(argVal('--concurrency') ?? '3');
const dimsArg = parseInt(argVal('--dims') ?? '0'); // PSQ dimension count: 1, 2, 3, 5, 10
if (mode !== 'full' && mode !== 'lite' && mode !== 'light' && mode !== 'lite-v2') {
  console.error(`Invalid --mode "${mode}". Must be "full", "lite", or "lite-v2".`);
  process.exit(1);
}
if (dimsArg && ![1, 2, 3, 5, 10].includes(dimsArg)) {
  console.error(`Invalid --dims "${dimsArg}". Must be 1, 2, 3, 5, or 10.`);
  process.exit(1);
}

// Resolve PSQ dims: --dims N overrides, default is 1
const activeDims = dimsArg ? PSQ_DIM_VARIANTS[dimsArg] : PSQ_DIM_VARIANTS[1];
const LITE_V2_SYSTEM_PROMPT = buildLiteV2Prompt(activeDims);

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

const SYSTEM_PROMPT = mode === 'lite-v2' ? LITE_V2_SYSTEM_PROMPT
  : (mode === 'lite' || mode === 'light') ? LITE_SYSTEM_PROMPT
  : FULL_SYSTEM_PROMPT;
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
    console.log(`  schema_version: ${slim.schema_version}`);
    if (mode === 'lite-v2') {
      const dims = slim.psq_dimensions ?? {};
      for (const [dim, val] of Object.entries(dims)) {
        console.log(`  ${dim}: score=${val?.score} conf=${val?.confidence} rationale="${val?.rationale?.slice(0, 80)}"`);
      }
      const tqBits = [slim.tq_author, slim.tq_date, slim.tq_sources, slim.tq_corrections, slim.tq_conflicts];
      console.log(`  tq: [${tqBits.join(',')}] = ${tqBits.filter(Boolean).length}/5`);
      console.log(`  content_type: ${slim.content_type}`);
      console.log(`  summary: ${slim.executive_summary}`);
      // Derive HRCB editorial from PSQ
      const dimVals = Object.values(dims).filter(d => d?.confidence >= 0.3);
      if (dimVals.length > 0) {
        const totalW = dimVals.reduce((s, d) => s + d.confidence, 0);
        const gPsq = dimVals.reduce((s, d) => s + d.score * d.confidence, 0) / totalW;
        const editorial = (gPsq - 5) / 5;
        console.log(`  → g_psq: ${gPsq.toFixed(2)} → editorial: ${editorial.toFixed(3)}`);
      }
    } else if (mode === 'lite' || mode === 'light') {
      console.log(`  editorial: ${slim.evaluation?.editorial}`);
      console.log(`  structural: ${slim.evaluation?.structural}`);
      console.log(`  content_type: ${slim.evaluation?.content_type}`);
      console.log(`  confidence: ${slim.evaluation?.confidence}`);
      console.log(`  reasoning: ${slim.reasoning}`);
    } else {
      console.log(`  weighted_mean: ${slim.evaluation?.hcb_weighted_mean}`);
      console.log(`  classification: ${slim.evaluation?.hcb_classification}`);
      console.log(`  theme_tag: ${slim.theme_tag}`);
    }
    return;
  }

  const result = await postIngest(hnId, slim, MODEL_ID, PROVIDER, promptHash, inputTokens, outputTokens);
  console.log(`  ✓ Ingested: weighted_mean=${result.weighted_mean?.toFixed(3)}, classification=${result.classification}`);
  if (result.repairs?.length > 0) {
    console.log(`  Repairs: ${result.repairs.join('; ')}`);
  }
}

async function main() {
  const dimsLabel = mode === 'lite-v2' ? ` — dims: ${activeDims.length} (${activeDims.join(', ')})` : '';
  console.log(`HRCB Standalone Evaluator — model: ${MODEL_ID} — mode: ${mode}${dimsLabel} — concurrency: ${concurrency}`);
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
