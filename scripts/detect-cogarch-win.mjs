#!/usr/bin/env node
/**
 * detect-cogarch-win.mjs
 *
 * Analyzes the latest Claude Code session JSONL to detect cogarch wins —
 * moments where a cognitive trigger fired and produced a measurably better outcome.
 * Run at cycle end (step 12.5) or on demand.
 *
 * Usage:
 *   node scripts/detect-cogarch-win.mjs [--session <path>] [--dry-run] [--threshold <n>]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execSync, spawn } from 'child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SESSIONS_DIR = join(homedir(), '.claude/projects/-home-kashif-projects-unudhr');
const LOG_FILE = join(SESSIONS_DIR, 'memory/cogarch-wins-log.jsonl');
const SCAFFOLD_DIR = join(process.cwd(), '.claude/plans/exports/blog/cogarch-wins');

const DEFAULT_THRESHOLD = 3;
const DEDUP_WINDOW_DAYS = 30;
const MAX_EXTRACT_CHARS = 4000;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sessionArgIdx = args.indexOf('--session');
const SESSION_PATH = sessionArgIdx >= 0 ? args[sessionArgIdx + 1] : null;
const thresholdArgIdx = args.indexOf('--threshold');
const THRESHOLD = thresholdArgIdx >= 0 ? parseInt(args[thresholdArgIdx + 1], 10) : DEFAULT_THRESHOLD;

// ---------------------------------------------------------------------------
// Step 1 — Find session JSONL
// ---------------------------------------------------------------------------

function findLatestSession() {
  if (SESSION_PATH) return SESSION_PATH;

  const files = readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.includes('/'))
    .map(f => {
      const fullPath = join(SESSIONS_DIR, f);
      try {
        return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) throw new Error(`No JSONL session files found in ${SESSIONS_DIR}`);
  return files[0].path;
}

// ---------------------------------------------------------------------------
// Step 2 — Extract compressed decision moments
// ---------------------------------------------------------------------------

function extractMoments(sessionPath) {
  const lines = readFileSync(sessionPath, 'utf8').trim().split('\n').filter(Boolean);
  const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const userMessages = [];
  const thinkingMoments = [];
  const toolCalls = [];

  for (const entry of parsed) {
    // User messages
    if (entry.type === 'user' || entry.role === 'user') {
      const content = entry.message?.content ?? entry.content;
      if (typeof content === 'string' && content.trim()) {
        userMessages.push(content.slice(0, 300));
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            userMessages.push(block.text.slice(0, 300));
          }
        }
      }
    }

    // Assistant messages — extract thinking + tool_use blocks
    if (entry.type === 'assistant' || entry.role === 'assistant') {
      const content = entry.message?.content ?? entry.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'thinking' && block.thinking?.trim()) {
            thinkingMoments.push(block.thinking.slice(0, 500));
          }
          if (block.type === 'tool_use') {
            const inp = block.input ?? {};
            const keyFields = [
              inp.command, inp.path, inp.pattern, inp.file_path,
              inp.prompt, inp.description, inp.query,
            ].filter(Boolean).join(' | ').slice(0, 200);
            toolCalls.push(`${block.name}: ${keyFields}`);
          }
        }
      }
    }
  }

  // Newest-first for thinking/tools (most recent decisions most relevant)
  thinkingMoments.reverse();
  toolCalls.reverse();

  let output = '';

  if (userMessages.length) {
    output += '=== USER MESSAGES ===\n';
    output += userMessages.slice(0, 6).join('\n---\n') + '\n\n';
  }

  if (thinkingMoments.length) {
    output += '=== THINKING MOMENTS (newest first) ===\n';
    for (const t of thinkingMoments.slice(0, 8)) {
      output += t + '\n---\n';
    }
    output += '\n';
  }

  if (toolCalls.length) {
    output += '=== TOOL CALLS (newest first) ===\n';
    output += toolCalls.slice(0, 30).join('\n') + '\n';
  }

  return output.slice(0, MAX_EXTRACT_CHARS);
}

// ---------------------------------------------------------------------------
// Step 3 — Detection prompt
// ---------------------------------------------------------------------------

const DETECTION_PROMPT = `You are a cognitive architecture analyst. Given a session transcript excerpt from a Claude Code agent, identify whether a "cogarch win" occurred — a moment where a specific cognitive trigger fired and produced a measurably better outcome than would otherwise have happened.

TRIGGER LIST:
- T1 (session-start orientation): reading TODO.md/session mode before diving in
- T2 (bare-fork prevention): never presenting options without adjudicating first
- T3 (adjudication): systematic evaluation of 2+ options with order-3+ effect tracing
- T4 (before-file-write): checking if a file exists / reading context before writing
- T5 (phase-boundary): explicit transition checkpoint between phases
- T6 (position-stability): holding a position under pushback when the evidence didn't change
- gap-detection: "which sections did I NOT read — could they be affected?" checkpoint
- triangulate-before-destructive-action: verifying with 2nd method before deleting/removing
- epistemic-flag: surfacing a threat to validity or knowledge limit proactively

A WIN requires ALL THREE:
1. A specific trigger from the list above fired
2. The outcome was measurably better because of it (something bad was caught or prevented)
3. The mechanism is specific enough to explain concisely in a blog post

Return ONLY valid JSON, no markdown, no explanation:
{
  "detected": true or false,
  "trigger": "trigger-name or null",
  "mechanism": "what the trigger checked / how it fired",
  "caught": "what problem was caught or prevented",
  "counterfactual": "what would have happened without it",
  "blog_angle": "the publishable insight — why this matters beyond this session",
  "title_draft": "a compelling blog post title",
  "novelty_score": 1-5 (1=routine, 3=interesting, 5=genuinely novel mechanism),
  "tags": ["tag1", "tag2"]
}

If no win detected, return: {"detected": false}

SESSION TRANSCRIPT:
`;

function runDetection(excerpt) {
  const fullPrompt = DETECTION_PROMPT + excerpt;
  const spawnEnv = {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    // Unset nested-session guards so claude CLI can be spawned from within Claude Code
    CLAUDE_CODE: undefined,
    CLAUDECODE: undefined,
    CLAUDE_CODE_ENTRYPOINT: undefined,
  };

  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', 'claude-haiku-4-5-20251001'], {
      env: spawnEnv,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(fullPrompt);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude timed out after 120s'));
    }, 120000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      // claude -p may write to stdout or stderr depending on version/context; try both
      const raw = (stdout.trim() || stderr.trim());
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        reject(new Error(`No JSON in claude output: ${raw.slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(jsonMatch[0]));
      } catch (e) {
        reject(new Error(`JSON parse failed: ${e.message}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Step 4 — Dedup check
// ---------------------------------------------------------------------------

function alreadyLogged(detection) {
  if (!existsSync(LOG_FILE)) return false;

  const cutoff = Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (new Date(entry.date).getTime() < cutoff) continue;
      if (entry.trigger !== detection.trigger) continue;

      // Simple string similarity: check word overlap in mechanism
      const words1 = new Set((entry.mechanism ?? '').toLowerCase().split(/\W+/).filter(w => w.length > 4));
      const words2 = new Set((detection.mechanism ?? '').toLowerCase().split(/\W+/).filter(w => w.length > 4));
      const intersection = [...words1].filter(w => words2.has(w)).length;
      const union = new Set([...words1, ...words2]).size;
      const similarity = union > 0 ? intersection / union : 0;

      if (similarity > 0.5) return true;
    } catch {
      // malformed line — skip
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 5 — Generate scaffold
// ---------------------------------------------------------------------------

function todayISO() {
  try {
    return execSync('date -Idate', { encoding: 'utf8' }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
}

function generateScaffold(detection, sessionPath, today) {
  const slug = slugify(detection.title_draft ?? detection.trigger ?? 'cogarch-win');
  const filename = `${today}-${slug}.md`;
  const outputPath = join(SCAFFOLD_DIR, filename);
  const sessionId = basename(sessionPath, '.jsonl');
  const tagsYaml = (detection.tags ?? []).map(t => `  - ${t}`).join('\n');

  const content = `---
title: "${detection.title_draft ?? ''}"
date: ${today}
status: draft
tags:
${tagsYaml}
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/${slug}
trigger: ${detection.trigger}
session_id: ${sessionId}
novelty_score: ${detection.novelty_score}/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

${detection.caught ?? '[describe what was caught or prevented]'}

## The Mechanism

${detection.mechanism ?? '[explain the trigger, why it fired, what it checked]'}

## Why It Matters

${detection.blog_angle ?? '[the publishable insight]'}

## Counterfactual

Without this trigger: ${detection.counterfactual ?? '[what would have happened]'}

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
`;

  return { outputPath, filename, slug, content };
}

// ---------------------------------------------------------------------------
// Step 6 — Side effects
// ---------------------------------------------------------------------------

function appendToLog(detection, sessionPath, today) {
  const entry = {
    date: today,
    trigger: detection.trigger,
    mechanism: detection.mechanism,
    novelty_score: detection.novelty_score,
    session_id: basename(sessionPath, '.jsonl'),
  };
  const line = JSON.stringify(entry) + '\n';
  const dir = join(SESSIONS_DIR, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LOG_FILE, line, { flag: 'a', encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sessionPath = findLatestSession();
  console.log(`Session: ${sessionPath}`);

  const excerpt = extractMoments(sessionPath);
  if (!excerpt.trim()) {
    console.log('No extractable content in session. No win detected.');
    return;
  }

  let detection;
  try {
    detection = await runDetection(excerpt);
  } catch (err) {
    console.error(`Detection failed: ${err.message}`);
    process.exit(1);
  }

  if (!detection.detected) {
    console.log('No cogarch win detected this session.');
    return;
  }

  if ((detection.novelty_score ?? 0) < THRESHOLD) {
    console.log(`Win detected but novelty ${detection.novelty_score}/5 < threshold ${THRESHOLD}. Skipping scaffold.`);
    console.log(`  Trigger: ${detection.trigger}`);
    console.log(`  Caught: ${detection.caught}`);
    return;
  }

  if (alreadyLogged(detection)) {
    console.log(`Already logged: same trigger (${detection.trigger}) + similar mechanism within ${DEDUP_WINDOW_DAYS} days.`);
    return;
  }

  const today = todayISO();
  const { outputPath, filename, content } = generateScaffold(detection, sessionPath, today);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN — scaffold content ---');
    console.log(content);
    console.log('--- would write to:', outputPath, '---');
    return;
  }

  if (!existsSync(SCAFFOLD_DIR)) mkdirSync(SCAFFOLD_DIR, { recursive: true });
  writeFileSync(outputPath, content, 'utf8');

  appendToLog(detection, sessionPath, today);

  console.log(`✓ Cogarch win detected: ${detection.trigger} (novelty ${detection.novelty_score}/5)`);
  console.log(`  Caught: ${detection.caught}`);
  console.log(`  Scaffold: .claude/plans/exports/blog/cogarch-wins/${filename}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
