#!/usr/bin/env node
/**
 * TQ (Transparency Quotient) prompt dry-run.
 * Tests whether an LLM can reliably produce binary/countable
 * verifiability indicators from web content.
 *
 * Usage: node scripts/tq-dryrun.mjs --url <url>
 */

import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';

const CLAUDE_BIN = join(dirname(process.execPath), 'claude');
const RAW_HTML_MAX_CHARS = 30_000;

const TQ_PROMPT = `You are a Transparency Quotient (TQ) evaluator. Assess web content for verifiability structure — objective indicators of transparency and accountability.

## TASK
Answer each indicator with a factual observation. Do NOT interpret or judge the content's quality — only report what is structurally present or absent.

## INDICATORS

1. **author_disclosed** (bool): Is a specific author identified by name? Bylines, "Written by," author bio sections count. Generic org names ("The Team") do NOT count.

2. **sources_cited** (int): Count of distinct external sources referenced. Include: hyperlinks to other domains, named studies/papers, quoted experts with affiliations, data sources with citations. Exclude: self-links, navigation, ads, social share buttons.

3. **date_published** (bool): Is a publication or last-updated date present?

4. **corrections_policy** (bool): Is there a visible corrections policy, errata section, or update log? "Updated:" timestamps on the article itself count.

5. **conflicts_stated** (bool): Are potential conflicts of interest disclosed? Includes: funding sources, sponsorship labels, affiliate disclaimers, "paid partnership" notices, ownership disclosures.

6. **methodology_visible** (bool): For claims or data: is the methodology or data source described? For opinion pieces: is the basis for claims made explicit? For product pages: are specs/evidence provided for claims?

## OUTPUT FORMAT
Output ONLY a JSON object. No markdown, no explanation.

{
  "schema_version": "tq-0.1",
  "url": "<url>",
  "domain": "<domain>",
  "content_type": "<ED|PO|LP|PR|MI|HR|CO|MX>",
  "indicators": {
    "author_disclosed": <true|false>,
    "author_name": "<name or null>",
    "sources_cited": <integer count>,
    "source_examples": ["<first 3 source descriptions>"],
    "date_published": <true|false>,
    "date_value": "<date string or null>",
    "corrections_policy": <true|false>,
    "conflicts_stated": <true|false>,
    "conflict_detail": "<description or null>",
    "methodology_visible": <true|false>
  },
  "tq_composite": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining the composite score>"
}

## COMPOSITE SCORING
tq_composite = weighted sum of indicators:
- author_disclosed: 0.20
- sources_cited > 0: 0.20 (bonus +0.05 if sources_cited >= 3)
- date_published: 0.15
- corrections_policy: 0.10
- conflicts_stated: 0.15
- methodology_visible: 0.20

Round to 2 decimal places.`;

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const url = urlIdx !== -1 ? args[urlIdx + 1] : null;

if (!url) {
  console.error('Usage: node scripts/tq-dryrun.mjs --url <url>');
  process.exit(1);
}

async function fetchContent(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'HN-HRCB-Bot/1.0 (UDHR evaluation research)',
      'Accept': 'text/html,application/xhtml+xml,text/plain',
    },
  });
  return (await res.text()).slice(0, RAW_HTML_MAX_CHARS);
}

function callClaude(userMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', '--model', 'claude-haiku-4-5',
      '--system-prompt', TQ_PROMPT,
      '--no-session-persistence', '--output-format', 'text',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.stdin.write(userMessage);
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 120_000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`exit ${code}: ${stderr.slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

console.log(`TQ Dry-Run — ${url}\n`);
console.log('Fetching content...');
const content = await fetchContent(url);
console.log(`Content: ${content.length} chars\n`);

const userMessage = `Evaluate the transparency/verifiability of this URL: ${url}\n\n--- BEGIN CONTENT ---\n${content}\n--- END CONTENT ---`;
console.log('Calling claude -p (haiku)...\n');
const text = await callClaude(userMessage);

const first = text.indexOf('{');
const last = text.lastIndexOf('}');
if (first === -1) { console.error('No JSON in response'); console.log(text); process.exit(1); }
const json = JSON.parse(text.slice(first, last + 1));

console.log('=== TQ RESULT ===');
console.log(`  schema:      ${json.schema_version}`);
console.log(`  content_type: ${json.content_type}`);
console.log(`  tq_composite: ${json.tq_composite}`);
console.log(`  reasoning:    ${json.reasoning}`);
console.log('');
console.log('  INDICATORS:');
const ind = json.indicators;
console.log(`    author_disclosed:     ${ind.author_disclosed} ${ind.author_name ? `(${ind.author_name})` : ''}`);
console.log(`    sources_cited:        ${ind.sources_cited} ${ind.source_examples?.length ? `[${ind.source_examples.join(', ')}]` : ''}`);
console.log(`    date_published:       ${ind.date_published} ${ind.date_value ? `(${ind.date_value})` : ''}`);
console.log(`    corrections_policy:   ${ind.corrections_policy}`);
console.log(`    conflicts_stated:     ${ind.conflicts_stated} ${ind.conflict_detail ? `(${ind.conflict_detail})` : ''}`);
console.log(`    methodology_visible:  ${ind.methodology_visible}`);
console.log('');
console.log('RAW JSON:');
console.log(JSON.stringify(json, null, 2));
