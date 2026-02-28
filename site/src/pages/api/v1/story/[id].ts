import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../../lib/api-v1';

export const GET: APIRoute = async ({ locals, request, params }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }

  const env = locals.runtime.env as { DB: D1Database; CONTENT_CACHE?: KVNamespace };
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

  if (env.CONTENT_CACHE) {
    const ok = await checkRateLimit(env.CONTENT_CACHE, ip);
    if (!ok) return errorResponse('Rate limit exceeded', 429);
  }

  const hnId = parseInt(params.id ?? '', 10);
  if (!Number.isFinite(hnId) || hnId <= 0) {
    return errorResponse('Invalid story id', 400);
  }

  const [story, raterEvals] = await Promise.all([
    env.DB
      .prepare(
        `SELECT hn_id, url, title, domain, hn_score, hn_time,
                hcb_weighted_mean, hcb_editorial_mean, hcb_classification,
                consensus_score, eval_model, evaluated_at,
                eq_score, so_score, td_score,
                et_valence, et_arousal, et_primary_tone
         FROM stories WHERE hn_id = ?`
      )
      .bind(hnId)
      .first<Record<string, unknown>>(),
    env.DB
      .prepare(
        `SELECT re.eval_model, re.eval_provider, re.prompt_mode, re.eval_status,
                re.hcb_editorial_mean, re.hcb_weighted_mean, re.evaluated_at
         FROM rater_evals re
         INNER JOIN model_registry mr ON mr.id = re.eval_model AND mr.enabled = 1
         WHERE re.hn_id = ? AND re.eval_status = 'done'
         ORDER BY re.evaluated_at DESC`
      )
      .bind(hnId)
      .all<Record<string, unknown>>(),
  ]);

  if (!story) return errorResponse('Story not found', 404);

  return jsonResponse({ story, rater_evals: raterEvals.results }, 200, itemCacheHeaders());
};
