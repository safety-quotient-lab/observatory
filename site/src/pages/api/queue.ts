// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { readDb } from '../../lib/db-utils';

/**
 * GET /api/queue — returns pending stories for the standalone evaluator on gray-box.
 * Auth: Authorization: Bearer <TRIGGER_SECRET>
 *
 * KV reservation: served hn_ids are marked in-flight (queue:inflight:<provider>:<id>, TTL 300s)
 * so that concurrent evaluator instances don't double-evaluate the same story.
 * Fail-open: if CONTENT_CACHE is unavailable, proceeds without reservation.
 */
export const GET: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env as { DB: D1Database; TRIGGER_SECRET?: string; CONTENT_CACHE?: KVNamespace };
  const db = readDb(env.DB);

  const auth = request.headers.get('Authorization') ?? '';
  if (!env.TRIGGER_SECRET || auth !== `Bearer ${env.TRIGGER_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

  const provider = url.searchParams.get('provider') ?? 'claude-code-standalone';

  // Collect currently in-flight hn_ids from KV to exclude from this batch
  let inflightFilter = '';
  let inflightIds: number[] = [];
  if (env.CONTENT_CACHE) {
    try {
      const listed = await env.CONTENT_CACHE.list({ prefix: `queue:inflight:${provider}:` });
      inflightIds = listed.keys
        .map(k => parseInt(k.name.split(':').pop() ?? '', 10))
        .filter(n => !isNaN(n));
    } catch {
      // KV unavailable — skip exclusion, proceed without reservation
    }
  }

  if (inflightIds.length > 0) {
    const placeholders = inflightIds.map(() => '?').join(',');
    inflightFilter = `AND s.hn_id NOT IN (${placeholders})`;
  }

  const { results } = await db
    .prepare(
      `SELECT s.hn_id, s.url, s.title
       FROM stories s
       WHERE s.eval_status IN ('pending', 'queued')
         AND s.url NOT LIKE 'item?id=%'
         AND NOT EXISTS (
           SELECT 1 FROM rater_evals r
           WHERE r.hn_id = s.hn_id
             AND r.eval_provider = ?
             AND r.eval_status = 'done'
         )
         ${inflightFilter}
       ORDER BY CASE WHEN s.hn_type = 'calibration' THEN 0 ELSE 1 END ASC,
                COALESCE(s.eval_priority_score, s.hn_score, 0) DESC
       LIMIT ?`
    )
    .bind(provider, ...inflightIds, limit)
    .all<{ hn_id: number; url: string; title: string }>();

  // Mark returned stories as in-flight (TTL 300s = 5 min)
  if (env.CONTENT_CACHE && results.length > 0) {
    await Promise.allSettled(
      results.map(s =>
        env.CONTENT_CACHE!.put(`queue:inflight:${provider}:${s.hn_id}`, '1', { expirationTtl: 300 })
      )
    );
  }

  return new Response(JSON.stringify({ stories: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
