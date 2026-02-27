import type { APIContext } from 'astro';
import { corsHeaders, checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../lib/api-v1';

export const prerender = false;

/** 500 most recently submitted story IDs. HN API-compatible. */
export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env;
  if (!env?.DB) return errorResponse('Service unavailable', 503);

  const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CONTENT_CACHE && !(await checkRateLimit(env.CONTENT_CACHE, ip))) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  const { results } = await env.DB
    .prepare(
      `SELECT hn_id FROM stories
       WHERE hn_type != 'calibration'
       ORDER BY hn_time DESC
       LIMIT 500`
    )
    .all<{ hn_id: number }>();

  return jsonResponse(results.map(r => r.hn_id), 200, listCacheHeaders());
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
