import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../lib/api-v1';

export const GET: APIRoute = async ({ locals, request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }

  const env = locals.runtime.env as { DB: D1Database; CONTENT_CACHE?: KVNamespace };
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

  if (env.CONTENT_CACHE) {
    const ok = await checkRateLimit(env.CONTENT_CACHE, ip);
    if (!ok) return errorResponse('Rate limit exceeded', 429);
  }

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;

  const rawSort = url.searchParams.get('sort') ?? 'stories';
  const orderBy =
    rawSort === 'score' ? 'avg_hrcb DESC NULLS LAST' :
    rawSort === 'setl'  ? 'avg_setl DESC NULLS LAST' :
                          'story_count DESC';

  const [{ results }, totalRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT domain, story_count, evaluated_count,
                avg_hrcb, avg_setl, avg_editorial, avg_structural,
                avg_eq, avg_so, avg_td, avg_pt_count,
                avg_valence, avg_arousal,
                dominant_tone, dominant_scope, last_updated_at
         FROM domain_aggregates
         WHERE evaluated_count >= 1
         ORDER BY ${orderBy}
         LIMIT ?`
      )
      .bind(limit)
      .all<Record<string, unknown>>(),
    env.DB
      .prepare(`SELECT COUNT(*) as total FROM domain_aggregates WHERE evaluated_count >= 1`)
      .first<{ total: number }>(),
  ]);

  return jsonResponse(
    { domains: results, total: totalRow?.total ?? 0, limit },
    200,
    listCacheHeaders(),
  );
};
