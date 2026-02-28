import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../lib/api-v1';
import { readDb } from '../../../lib/db-utils';
import { getSignalOverview } from '../../../lib/db-entities';

export const GET: APIRoute = async ({ locals, request }) => {
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

  try {
    const overview = await getSignalOverview(db);
    return jsonResponse({ signals: overview }, 200, itemCacheHeaders());
  } catch (err) {
    console.error('[api/v1/signals]', err);
    return errorResponse('Internal error', 500);
  }
};
