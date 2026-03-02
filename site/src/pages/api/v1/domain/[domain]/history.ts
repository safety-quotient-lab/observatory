// SPDX-License-Identifier: Apache-2.0
import type { APIContext } from 'astro';
import { corsHeaders, checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../../../lib/api-v1';
import { readDb } from '../../../../../lib/db-utils';

export const prerender = false;

interface SnapshotRow {
  snapshot_date: string;
  story_count: number;
  evaluated_count: number;
  avg_hrcb: number | null;
  avg_setl: number | null;
  avg_editorial: number | null;
  avg_structural: number | null;
  avg_eq: number | null;
  avg_so: number | null;
  avg_td: number | null;
  avg_valence: number | null;
  avg_arousal: number | null;
  dominant_tone: string | null;
  avg_confidence: number | null;
  avg_sr: number | null;
  avg_pt_count: number | null;
  avg_pt_score: number | null;
  avg_dominance: number | null;
  avg_fw_ratio: number | null;
  dominant_scope: string | null;
  dominant_reading_level: string | null;
  dominant_sentiment: string | null;
}

/**
 * GET /api/v1/domain/{domain}/history
 * Returns daily HRCB profile snapshots for a domain.
 * Params: ?days=30 (1–365, default 30)
 */
export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env;
  if (!env?.DB) return errorResponse('Service unavailable', 503);

  const db = readDb(env.DB);
  const domain = context.params.domain ?? '';
  if (!domain) return errorResponse('Domain required', 400);

  const rawDays = parseInt(context.url.searchParams.get('days') ?? '30', 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 30 : Math.min(rawDays, 365);

  const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CONTENT_CACHE && !(await checkRateLimit(env.CONTENT_CACHE, ip))) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  const { results } = await db
    .prepare(
      `SELECT snapshot_date, story_count, evaluated_count,
              avg_hrcb, avg_setl, avg_editorial, avg_structural,
              avg_eq, avg_so, avg_td, avg_valence, avg_arousal, dominant_tone,
              avg_confidence, avg_sr, avg_pt_count, avg_pt_score,
              avg_dominance, avg_fw_ratio,
              dominant_scope, dominant_reading_level, dominant_sentiment
       FROM domain_profile_snapshots
       WHERE domain = ?
         AND snapshot_date >= date('now', ? || ' days')
       ORDER BY snapshot_date DESC`
    )
    .bind(domain, `-${days}`)
    .all<SnapshotRow>();

  if (results.length === 0) {
    // Check if domain exists at all
    const exists = await db
      .prepare(`SELECT 1 FROM domain_aggregates WHERE domain = ? LIMIT 1`)
      .bind(domain)
      .first();
    if (!exists) return errorResponse('Domain not found', 404);
  }

  return jsonResponse({ domain, days, snapshots: results }, 200, listCacheHeaders());
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
