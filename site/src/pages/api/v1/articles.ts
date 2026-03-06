// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, itemCacheHeaders } from '../../../lib/api-v1';
import { readDb } from '../../../lib/db-utils';

interface ArticleApiRow {
  sort_order: number;
  section: string;
  avg_editorial: number | null;
  avg_structural: number | null;
  avg_final: number | null;
  avg_final_sq: number | null;
  signal_count: number;
  nd_count: number;
  story_count: number;
  evidence_h: number;
  evidence_m: number;
  evidence_l: number;
}

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
    const { results } = await db
      .prepare(
        `SELECT sc.section, sc.sort_order,
                AVG(sc.final) as avg_final,
                AVG(sc.editorial) as avg_editorial,
                AVG(sc.structural) as avg_structural,
                AVG(sc.final * sc.final) as avg_final_sq,
                SUM(CASE WHEN sc.final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
                SUM(CASE WHEN sc.final IS NULL THEN 1 ELSE 0 END) as nd_count,
                COUNT(DISTINCT sc.hn_id) as story_count,
                SUM(CASE WHEN sc.evidence = 'H' THEN 1 ELSE 0 END) as evidence_h,
                SUM(CASE WHEN sc.evidence = 'M' THEN 1 ELSE 0 END) as evidence_m,
                SUM(CASE WHEN sc.evidence = 'L' THEN 1 ELSE 0 END) as evidence_l
         FROM rater_scores sc
         JOIN stories s ON s.hn_id = sc.hn_id
         WHERE sc.eval_model = s.eval_model
         GROUP BY sc.section ORDER BY sc.sort_order`
      )
      .all<ArticleApiRow>();

    const articles = results.map(r => {
      const avgFinalSq = r.avg_final_sq ?? 0;
      const avgFinal = r.avg_final ?? 0;
      const stddev = Math.sqrt(Math.max(0, avgFinalSq - avgFinal * avgFinal));
      const editorial = r.avg_editorial ?? 0;
      const structural = r.avg_structural ?? 0;
      const setl = Math.abs(editorial - structural);

      return {
        article: r.sort_order,
        name: r.section.replace(/^Article \d+:\s*/, ''),
        avg_editorial: r.avg_editorial != null ? +r.avg_editorial.toFixed(4) : null,
        avg_structural: r.avg_structural != null ? +r.avg_structural.toFixed(4) : null,
        stddev_final: +stddev.toFixed(4),
        story_count: r.story_count,
        trigger_count: r.signal_count,
        nd_count: r.nd_count,
        avg_setl: +setl.toFixed(4),
        evidence: {
          high: r.evidence_h,
          medium: r.evidence_m,
          low: r.evidence_l,
        },
      };
    });

    return jsonResponse({
      articles,
      generated_at: new Date().toISOString(),
    }, 200, itemCacheHeaders());
  } catch (err) {
    console.error('[api/v1/articles]', err);
    return errorResponse('Internal error', 500);
  }
};
