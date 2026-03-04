#!/usr/bin/env node
/**
 * build-agent-inbox.mjs
 *
 * Generates site/public/.well-known/agent-inbox.json from YAML frontmatter
 * in .claude/plans/memorized/proposals/*.md files.
 *
 * Called by the Astro build integration in astro.config.mjs at build start.
 * Run standalone: node scripts/build-agent-inbox.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROPOSALS_DIR = join(REPO_ROOT, '.claude/plans/memorized/proposals');
const OUTPUT_FILE = join(REPO_ROOT, 'site/public/.well-known/agent-inbox.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser
// Handles: scalars, arrays (- item), one level of nested objects (  key: val)
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const result = {};
  let currentKey = null;   // parent key of current array or object
  let currentType = null;  // 'array' | 'object'

  for (const line of lines) {
    if (!line.trim()) continue;

    const indent = line.match(/^(\s*)/)[1].length;

    // Nested array item (indent=2, starts with "  - ")
    if (indent === 2 && line.trimStart().startsWith('- ')) {
      if (currentKey && currentType === 'array') {
        const val = line.trimStart().slice(2).trim().replace(/^["']|["']$/g, '');
        result[currentKey].push(val);
      }
      continue;
    }

    // Nested object key-value (indent=2, "  subkey: value")
    if (indent === 2 && currentKey && currentType === 'object') {
      const kv = line.trim().match(/^([\w_]+): ?(.*)?$/);
      if (kv) {
        const [, subkey, subval] = kv;
        const v = (subval ?? '').trim().replace(/^["']|["']$/g, '');
        result[currentKey][subkey] = v === 'true' ? true : v === 'false' ? false : v;
      }
      continue;
    }

    // Top-level key
    if (indent === 0) {
      const kv = line.match(/^([\w_]+): ?(.*)?$/);
      if (!kv) continue;
      const [, key, val] = kv;
      const trimVal = (val ?? '').trim().replace(/^["']|["']$/g, '');

      if (!trimVal) {
        // Empty value — next indented lines are an array or object
        // We'll determine type from the first child line
        result[key] = null; // placeholder
        currentKey = key;
        currentType = null;
      } else {
        currentKey = null;
        currentType = null;
        result[key] = trimVal === 'true' ? true : trimVal === 'false' ? false : trimVal;
      }
      continue;
    }

    // First child of a block — determine type (array vs object)
    if (indent === 2 && currentKey && currentType === null) {
      if (line.trimStart().startsWith('- ')) {
        result[currentKey] = [];
        currentType = 'array';
        const val = line.trimStart().slice(2).trim().replace(/^["']|["']$/g, '');
        result[currentKey].push(val);
      } else {
        result[currentKey] = {};
        currentType = 'object';
        const kv = line.trim().match(/^([\w_]+): ?(.*)?$/);
        if (kv) {
          const [, subkey, subval] = kv;
          const v = (subval ?? '').trim().replace(/^["']|["']$/g, '');
          result[currentKey][subkey] = v === 'true' ? true : v === 'false' ? false : v;
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(PROPOSALS_DIR)) {
    console.log('No proposals directory found — skipping agent-inbox.json generation');
    return;
  }

  const files = readdirSync(PROPOSALS_DIR)
    .filter(f => f.endsWith('.md') && f !== '.gitkeep')
    .sort()
    .reverse(); // newest first (alphabetical desc on YYYY-MM-DD prefix)

  const proposals = [];

  for (const file of files) {
    const content = readFileSync(join(PROPOSALS_DIR, file), 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.id) {
      console.warn(`  skip ${file} — no frontmatter or missing id`);
      continue;
    }

    const proposal = {
      id: fm.id,
      from: fm.from,
      to: fm.to,
      status: fm.status,
      date: fm.date,
      summary: fm.summary,
    };

    if (fm.accepted_at) proposal.accepted_at = fm.accepted_at;
    if (fm.accepted_by) proposal.accepted_by = fm.accepted_by;
    if (fm.implemented_at) proposal.implemented_at = fm.implemented_at;
    if (fm.priority) proposal.priority = fm.priority;
    if (Array.isArray(fm.priority_pages)) proposal.priority_pages = fm.priority_pages;
    if (fm.links && typeof fm.links === 'object') proposal.links = fm.links;
    if (fm.live_api && typeof fm.live_api === 'object') proposal.live_api = fm.live_api;

    proposals.push(proposal);
  }

  const updatedAt = new Date().toISOString();

  const output = {
    version: '1',
    description: 'Inter-agent proposal inbox — observatory.unratified.org → other agents',
    updated_at: updatedAt,
    _generated_from: '.claude/plans/memorized/proposals/*.md frontmatter',
    proposals,
  };

  const json = JSON.stringify(output, null, 2) + '\n';

  if (DRY_RUN) {
    console.log('--- DRY RUN ---');
    console.log(json);
    console.log(`--- would write to: ${OUTPUT_FILE} ---`);
    return;
  }

  writeFileSync(OUTPUT_FILE, json, 'utf8');
  console.log(`✓ agent-inbox.json: ${proposals.length} proposal(s) → ${OUTPUT_FILE}`);
}

main();
