import type { APIRoute } from 'astro';

/**
 * GET /api/queue — returns pending stories for the standalone evaluator on gray-box.
 * Auth: Authorization: Bearer <TRIGGER_SECRET>
 */
export const GET: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env as { DB: D1Database; TRIGGER_SECRET?: string };

  const auth = request.headers.get('Authorization') ?? '';
  if (!env.TRIGGER_SECRET || auth !== `Bearer ${env.TRIGGER_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);

  const { results } = await env.DB
    .prepare(
      `SELECT hn_id, url, title
       FROM stories
       WHERE eval_status IN ('pending', 'queued')
         AND url NOT LIKE 'item?id=%'
       ORDER BY score DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ hn_id: number; url: string; title: string }>();

  return new Response(JSON.stringify({ stories: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
