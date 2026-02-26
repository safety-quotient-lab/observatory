/**
 * One-shot script: manually enqueue pending stories for evaluation.
 * Run with: npx wrangler deploy scripts/enqueue.ts --name hrcb-enqueue --dry-run=false
 * Or just use `wrangler dispatch` if available.
 */

interface Env {
  DB: D1Database;
  EVAL_QUEUE: Queue;
}

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const limit = 25;

    const { results: pending } = await env.DB
      .prepare(
        `SELECT hn_id, url, title, domain, hn_text FROM stories
         WHERE eval_status = 'pending'
           AND (url IS NOT NULL OR hn_text IS NOT NULL)
         ORDER BY hn_time DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<{
        hn_id: number;
        url: string | null;
        title: string;
        domain: string | null;
        hn_text: string | null;
      }>();

    if (pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, enqueued: 0 }));
    }

    const messages: { body: QueueMessage }[] = [];
    const enqueuedIds: number[] = [];

    for (const story of pending) {
      if (story.url && /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|iso|mp4|mp3|wav|avi|mov)(\?|$)/i.test(story.url)) {
        await env.DB.prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = 'Binary content' WHERE hn_id = ?`).bind(story.hn_id).run();
        continue;
      }
      if (!story.url && (!story.hn_text || story.hn_text.length < 50)) {
        await env.DB.prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = 'No URL and no text' WHERE hn_id = ?`).bind(story.hn_id).run();
        continue;
      }

      messages.push({
        body: {
          hn_id: story.hn_id,
          url: story.url,
          title: story.title,
          hn_text: story.hn_text,
          domain: story.domain,
        },
      });
      enqueuedIds.push(story.hn_id);
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, enqueued: 0, skipped: pending.length }));
    }

    // Send to queue
    await env.EVAL_QUEUE.sendBatch(messages);

    // Mark as queued
    const stmts = enqueuedIds.map(id =>
      env.DB.prepare(`UPDATE stories SET eval_status = 'queued' WHERE hn_id = ?`).bind(id)
    );
    await env.DB.batch(stmts);

    return new Response(JSON.stringify({
      ok: true,
      enqueued: messages.length,
      ids: enqueuedIds,
    }));
  },
};
