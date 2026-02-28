import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../../lib/api-v1';
import { readDb } from '../../../../lib/db-utils';
import { getUserAggregate } from '../../../../lib/db-entities';

export const GET: APIRoute = async ({ locals, request, params }) => {
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

  const username = params.username;
  if (!username) return errorResponse('Username required', 400);

  try {
    const user = await getUserAggregate(db, username);
    if (!user) return errorResponse('User not found', 404);
    return jsonResponse({ user }, 200, itemCacheHeaders());
  } catch (err) {
    console.error('[api/v1/user]', err);
    return errorResponse('Internal error', 500);
  }
};
