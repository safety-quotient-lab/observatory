import type { APIContext } from 'astro';
import { corsHeaders, checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../../lib/api-v1';

export const prerender = false;

interface StoryRow {
  hn_id: number;
  hn_type: string;
  hn_by: string | null;
  hn_time: number;
  url: string | null;
  hn_score: number | null;
  title: string;
  hn_comments: number | null;
  eval_status: string;
  hcb_weighted_mean: number | null;
  hcb_editorial_mean: number | null;
  hcb_classification: string | null;
  eq_score: number | null;
  so_score: number | null;
  td_score: number | null;
  et_valence: number | null;
  et_arousal: number | null;
  et_primary_tone: string | null;
  eval_model: string | null;
  evaluated_at: string | null;
}

/**
 * HN Firebase API-compatible item endpoint, extended with HRCB evaluation data.
 * URL pattern: /api/v0/item/{id}.json
 *
 * Standard HN fields: id, type, by, time, url, score, title, descendants
 * Extension: hcb object with evaluation scores (null if not yet evaluated)
 */
export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env;
  if (!env?.DB) return errorResponse('Service unavailable', 503);

  // Astro captures "[id].json" as the param — strip the .json suffix
  const rawId = context.params.id ?? '';
  const hnId = parseInt(rawId.replace(/\.json$/, ''), 10);
  if (isNaN(hnId) || hnId <= 0) return errorResponse('Invalid item id', 400);

  const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CONTENT_CACHE && !(await checkRateLimit(env.CONTENT_CACHE, ip))) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  const story = await env.DB
    .prepare(
      `SELECT hn_id, hn_type, hn_by, hn_time, url, hn_score, title, hn_comments,
              eval_status, hcb_weighted_mean, hcb_editorial_mean, hcb_classification,
              eq_score, so_score, td_score, et_valence, et_arousal, et_primary_tone,
              eval_model, evaluated_at
       FROM stories
       WHERE hn_id = ? AND hn_type != 'calibration'`
    )
    .bind(hnId)
    .first<StoryRow>();

  if (!story) return errorResponse('Item not found', 404);

  const hasEval = story.hcb_weighted_mean !== null || story.hcb_editorial_mean !== null;

  const item = {
    id: story.hn_id,
    type: story.hn_type,
    ...(story.hn_by != null && { by: story.hn_by }),
    time: story.hn_time,
    ...(story.url != null && { url: story.url }),
    score: story.hn_score ?? 0,
    title: story.title,
    descendants: story.hn_comments ?? 0,
    hcb: hasEval
      ? {
          weighted_mean: story.hcb_weighted_mean,
          editorial_mean: story.hcb_editorial_mean,
          classification: story.hcb_classification,
          eq_score: story.eq_score,
          so_score: story.so_score,
          td_score: story.td_score,
          et_valence: story.et_valence,
          et_arousal: story.et_arousal,
          et_primary_tone: story.et_primary_tone,
          eval_model: story.eval_model,
          evaluated_at: story.evaluated_at,
          eval_status: story.eval_status,
        }
      : { eval_status: story.eval_status },
  };

  return jsonResponse(item, 200, itemCacheHeaders());
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
