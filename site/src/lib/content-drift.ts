// SPDX-License-Identifier: Apache-2.0
/**
 * Content change detection.
 *
 * Computes SHA-256 hashes of cleaned HTML content and detects when content
 * has changed since the last evaluation. Changed content is re-queued for eval.
 */

import { fetchUrlContent } from './shared-eval';
import { cleanHtml, hasReadableText } from './html-clean';
import { logEvent } from './events';

/** Max chars for drift comparison fetch — intentionally larger than eval's DRIFT_FETCH_MAX_CHARS (20K)
 *  to capture more of the page for hash comparison without truncation artifacts. */
const DRIFT_FETCH_MAX_CHARS = 50_000;

/**
 * Compute SHA-256 hash of content (first 16 bytes as hex, 32 chars).
 * Same algorithm as hashString in consumer-shared.ts.
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface DriftCandidate {
  hn_id: number;
  url: string;
  content_hash: string;
}

interface DriftResult {
  checked: number;
  drifted: number;
  errors: number;
}

/**
 * Check a batch of old evaluations for content changes.
 * Re-queues stories whose content has changed since last evaluation.
 */
export async function checkContentDrift(
  db: D1Database,
  limit = 20,
): Promise<DriftResult> {
  const { results: candidates } = await db
    .prepare(
      `SELECT hn_id, url, content_hash FROM stories
       WHERE eval_status = 'done'
         AND evaluated_at < datetime('now', '-7 days')
         AND content_hash IS NOT NULL
         AND url IS NOT NULL
       ORDER BY evaluated_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<DriftCandidate>();

  let checked = 0;
  let drifted = 0;
  let errors = 0;

  for (const candidate of candidates) {
    try {
      const rawHtml = await fetchUrlContent(candidate.url);
      if (rawHtml.startsWith('[error:')) {
        errors++;
        continue;
      }
      if (!hasReadableText(rawHtml)) {
        errors++;
        continue;
      }

      const cleaned = cleanHtml(rawHtml, DRIFT_FETCH_MAX_CHARS);
      const newHash = await computeContentHash(cleaned);
      checked++;

      if (newHash !== candidate.content_hash) {
        // Content has changed — re-queue for evaluation
        await db
          .prepare(
            `UPDATE stories
             SET content_hash = ?, content_last_fetched = datetime('now'), eval_status = 'pending'
             WHERE hn_id = ?`
          )
          .bind(newHash, candidate.hn_id)
          .run();

        await logEvent(db, {
          hn_id: candidate.hn_id,
          event_type: 'content_drift',
          severity: 'info',
          message: `Content changed: ${candidate.content_hash.slice(0, 8)}.. → ${newHash.slice(0, 8)}..`,
          details: { old_hash: candidate.content_hash, new_hash: newHash, url: candidate.url },
        });
        drifted++;
      } else {
        // Content unchanged — just update last fetched time
        await db
          .prepare(`UPDATE stories SET content_last_fetched = datetime('now') WHERE hn_id = ?`)
          .bind(candidate.hn_id)
          .run();
      }
    } catch {
      errors++;
    }
  }

  return { checked, drifted, errors };
}
