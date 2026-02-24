import type { APIRoute } from 'astro';

/**
 * SSE endpoint for real-time evaluation updates.
 * Polls D1 for recently completed evaluations and streams them to clients.
 * No Durable Objects needed — uses server-sent events with short polling.
 */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const encoder = new TextEncoder();

  let lastSeen = new Date().toISOString();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ time: lastSeen })}\n\n`));

      // Poll every 10 seconds for up to 5 minutes (30 polls)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10000));

        try {
          const { results } = await db
            .prepare(
              `SELECT hn_id, title, domain, hcb_weighted_mean, hcb_classification, evaluated_at
               FROM stories
               WHERE eval_status = 'done' AND evaluated_at > ?
               ORDER BY evaluated_at DESC
               LIMIT 5`
            )
            .bind(lastSeen)
            .all<{
              hn_id: number;
              title: string;
              domain: string | null;
              hcb_weighted_mean: number | null;
              hcb_classification: string | null;
              evaluated_at: string;
            }>();

          if (results.length > 0) {
            lastSeen = results[0].evaluated_at;
            for (const r of results) {
              controller.enqueue(
                encoder.encode(`event: evaluation\ndata: ${JSON.stringify(r)}\n\n`)
              );
            }
          }

          // Heartbeat
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Non-fatal — keep polling
        }
      }

      // Close after 5 minutes — client should reconnect
      controller.enqueue(encoder.encode(`event: timeout\ndata: {}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
