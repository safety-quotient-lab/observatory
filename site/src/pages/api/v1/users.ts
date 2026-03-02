// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { checkRateLimit, jsonResponse, errorResponse, listCacheHeaders } from '../../../lib/api-v1';
import { readDb } from '../../../lib/db-utils';
import { getUserIntelligence, type UserIntelSortOption } from '../../../lib/db-entities';

const VALID_SORTS: UserIntelSortOption[] = [
  'stories', 'score', 'hrcb', 'karma', 'domains', 'eq',
  'full_evaluated', 'editorial_full', 'editorial_lite',
];

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

  const url = new URL(request.url);
  const rawSort = url.searchParams.get('sort') ?? 'stories';
  const sort: UserIntelSortOption = VALID_SORTS.includes(rawSort as UserIntelSortOption)
    ? (rawSort as UserIntelSortOption)
    : 'stories';
  const rawMin = parseInt(url.searchParams.get('min_stories') ?? '3', 10);
  const minStories = Number.isFinite(rawMin) ? Math.max(1, Math.min(rawMin, 100)) : 3;
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;

  try {
    const users = await getUserIntelligence(db, sort, minStories, limit);
    return jsonResponse({ users, total: users.length, sort, min_stories: minStories, limit }, 200, listCacheHeaders());
  } catch (err) {
    console.error('[api/v1/users]', err);
    return errorResponse('Internal error', 500);
  }
};
