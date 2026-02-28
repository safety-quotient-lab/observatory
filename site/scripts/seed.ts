/**
 * Seed script: reads existing v3.4 evaluation JSONs from the parent directory
 * and outputs SQL INSERT statements to populate the D1 database.
 *
 * Usage:
 *   npx tsx scripts/seed.ts > seed.sql
 *   npx wrangler d1 execute udhr-hrcb --local --file=seed.sql
 */

import fs from 'node:fs';
import path from 'node:path';

interface Score {
  section: string;
  editorial: number | null;
  structural: number | null;
  final: number | null;
  directionality: string[];
  evidence: string | null;
  note: string;
}

interface Evaluation {
  schema_version: string;
  evaluation: {
    url: string;
    domain: string;
    content_type: { primary: string };
    date: string;
  };
  scores: Score[];
  aggregates: {
    weighted_mean: number;
    classification: string;
    signal_sections: number;
    nd_count: number;
  };
}

const ALL_SECTIONS = [
  'Preamble',
  ...Array.from({ length: 30 }, (_, i) => `Article ${i + 1}`),
];

function esc(s: string | null): string {
  if (s === null) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function numOrNull(n: number | null): string {
  return n === null ? 'NULL' : String(n);
}

const evalDir = path.resolve(process.cwd(), '..');
const files = fs.readdirSync(evalDir).filter((f) => f.endsWith('.json'));

// Generate fake HN IDs for seed data (starting from 90000001)
let fakeHnId = 90000001;

const statements: string[] = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(evalDir, file), 'utf-8');
  let data: Evaluation;
  try {
    data = JSON.parse(raw);
  } catch {
    continue;
  }

  if (data.schema_version !== '3.4') continue;

  const hnId = fakeHnId++;
  const ev = data.evaluation;
  const agg = data.aggregates;

  // Extract domain from URL
  let domain: string | null = null;
  try {
    domain = new URL(ev.url).hostname;
  } catch {
    domain = ev.domain;
  }

  const jsonBlob = raw.replace(/'/g, "''");

  statements.push(
    `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, content_type, hcb_weighted_mean, hcb_classification, hcb_signal_sections, hcb_nd_count, hcb_json, eval_status, evaluated_at) VALUES (${hnId}, ${esc(ev.url)}, ${esc(file.replace('.json', '').replace(/-/g, ' '))}, ${esc(domain)}, 100, 50, 'seed', ${Math.floor(Date.now() / 1000)}, ${esc(ev.content_type.primary)}, ${numOrNull(agg.weighted_mean)}, ${esc(agg.classification)}, ${numOrNull(agg.signal_sections)}, ${numOrNull(agg.nd_count)}, '${jsonBlob}', 'done', datetime('now'));`
  );

  // Insert score rows into rater_scores
  const evalModel = 'claude-haiku-4-5-20251001';
  for (const score of data.scores) {
    // Normalize section names: "Art. N" → "Article N"
    const normalizedSection = score.section.replace(/^Art\. /, 'Article ');
    const sortOrder = ALL_SECTIONS.indexOf(normalizedSection);
    statements.push(
      `INSERT OR IGNORE INTO rater_scores (hn_id, section, eval_model, sort_order, final, editorial, structural, evidence, directionality, note) VALUES (${hnId}, ${esc(normalizedSection)}, ${esc(evalModel)}, ${sortOrder}, ${numOrNull(score.final)}, ${numOrNull(score.editorial)}, ${numOrNull(score.structural)}, ${esc(score.evidence)}, ${esc(JSON.stringify(score.directionality))}, ${esc(score.note)});`
    );
  }
}

// Output all SQL
console.log(statements.join('\n'));
