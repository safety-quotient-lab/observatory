// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../../lib/api-v1';
import { readDb } from '../../../../lib/db-utils';

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

  const domain = params.domain ?? '';
  if (!domain) return errorResponse('Invalid domain', 400);

  const [profile, recentStories] = await Promise.all([
    db
      .prepare(
        `SELECT domain, story_count, evaluated_count,
                avg_hrcb, avg_setl, avg_editorial, avg_structural, avg_confidence,
                avg_eq, avg_so, avg_td, avg_pt_count,
                avg_valence, avg_arousal,
                dominant_tone, dominant_scope, dominant_reading_level, dominant_sentiment,
                last_updated_at
         FROM domain_aggregates WHERE domain = ?`
      )
      .bind(domain)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT hn_id, url, title, hn_score, hn_time,
                hcb_weighted_mean, hcb_editorial_mean, hcb_classification,
                eval_model, evaluated_at
         FROM stories
         WHERE domain = ? AND eval_status = 'done' AND hn_id > 0
         ORDER BY hn_time DESC
         LIMIT 5`
      )
      .bind(domain)
      .all<Record<string, unknown>>(),
  ]);

  if (!profile) return errorResponse('Domain not found', 404);

  return jsonResponse({ profile, recent_stories: recentStories.results }, 200, itemCacheHeaders());
};
