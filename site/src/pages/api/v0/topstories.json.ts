import type { APIContext } from 'astro';
import { corsHeaders, checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../lib/api-v1';
import { readDb } from '../../../lib/db-utils';

export const prerender = false;

/** Top 500 story IDs ordered by HN score (last 30 days). HN API-compatible. */
export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env;
  if (!env?.DB) return errorResponse('Service unavailable', 503);

  const db = readDb(env.DB);
  const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CONTENT_CACHE && !(await checkRateLimit(env.CONTENT_CACHE, ip))) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  const { results } = await db
    .prepare(
      `SELECT hn_id FROM stories
       WHERE hn_time > unixepoch('now', '-30 days')
         AND hn_type != 'calibration'
       ORDER BY hn_score DESC NULLS LAST
       LIMIT 500`
    )
    .all<{ hn_id: number }>();

  return jsonResponse(results.map(r => r.hn_id), 200, listCacheHeaders());
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
