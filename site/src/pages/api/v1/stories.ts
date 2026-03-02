// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../lib/api-v1';
import { readDb } from '../../../lib/db-utils';

export const GET: APIRoute = async ({ locals, request }) => {
  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }

  const env = locals.runtime.env as { DB: D1Database; CONTENT_CACHE?: KVNamespace };
  const db = readDb(env.DB);
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

  if (env.CONTENT_CACHE) {
    const ok = await checkRateLimit(env.CONTENT_CACHE, ip);
    if (!ok) return errorResponse('Rate limit exceeded', 429);
  }

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  const sort = url.searchParams.get('sort') === 'date' ? 'date' : 'score';
  const status = url.searchParams.get('status') === 'all' ? 'all' : 'done';

  const orderBy = sort === 'date' ? 's.hn_time DESC' : 's.hcb_weighted_mean DESC NULLS LAST';
  const statusFilter = status === 'done' ? `AND s.eval_status = 'done'` : '';

  const [{ results }, totalRow] = await Promise.all([
    db
      .prepare(
        `SELECT s.hn_id, s.url, s.title, s.domain, s.hn_score, s.hn_time,
                s.hcb_weighted_mean, s.hcb_editorial_mean, s.hcb_classification,
                s.consensus_score, s.eval_model, s.evaluated_at,
                s.eq_score, s.so_score, s.td_score,
                s.et_valence, s.et_arousal, s.et_primary_tone
         FROM stories s
         WHERE s.url NOT LIKE 'item?id=%'
           AND s.hn_id > 0
           ${statusFilter}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT COUNT(*) as total FROM stories s
         WHERE s.url NOT LIKE 'item?id=%' AND s.hn_id > 0 ${statusFilter}`
      )
      .first<{ total: number }>(),
  ]);

  return jsonResponse(
    { stories: results, total: totalRow?.total ?? 0, limit, offset },
    200,
    listCacheHeaders(),
  );
};
