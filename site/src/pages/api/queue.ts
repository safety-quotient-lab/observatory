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

  const provider = url.searchParams.get('provider') ?? 'claude-code-standalone';

  const { results } = await env.DB
    .prepare(
      `SELECT s.hn_id, s.url, s.title
       FROM stories s
       WHERE s.eval_status IN ('pending', 'queued')
         AND s.url NOT LIKE 'item?id=%'
         AND NOT EXISTS (
           SELECT 1 FROM rater_evals r
           WHERE r.hn_id = s.hn_id
             AND r.eval_provider = ?
             AND r.eval_status = 'done'
         )
       ORDER BY s.score DESC
       LIMIT ?`
    )
    .bind(provider, limit)
    .all<{ hn_id: number; url: string; title: string }>();

  return new Response(JSON.stringify({ stories: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
