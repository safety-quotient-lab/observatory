/**
 * Dead Letter Queue Consumer + Replay Endpoint.
 *
 * Queue consumer:
 * 1. Writes failed messages to dlq_messages for inspection
 * 2. Logs a structured 'dlq' event
 * 3. Acks the message (so it doesn't loop)
 *
 * HTTP endpoints:
 * - GET  /          → health check
 * - POST /replay    → re-enqueue pending DLQ messages to eval queue
 * - POST /replay/:id → re-enqueue a single DLQ message by ID
 */

import { logEvent } from '../src/lib/events';
import { extractDomain } from '../src/lib/shared-eval';

interface Env {
  DB: D1Database;
  EVAL_QUEUE: Queue;
  CRON_SECRET?: string;
}

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
}

interface DlqRow {
  id: number;
  hn_id: number;
  url: string | null;
  title: string;
  domain: string | null;
  original_error: string | null;
  retry_count: number;
  status: string;
}

function checkAuth(request: Request, env: Env): Response | null {
  if (env.CRON_SECRET) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }
  return null;
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;

    for (const msg of batch.messages) {
      const story = msg.body;
      console.log(`[dlq] Dead-lettered: hn_id=${story.hn_id}: ${story.title}`);

      try {
        // Write to dlq_messages table
        await db
          .prepare(
            `INSERT INTO dlq_messages (hn_id, url, title, domain, original_error, retry_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            story.hn_id,
            story.url || null,
            story.title,
            story.domain || null,
            `Exhausted all retries (delivered to DLQ at ${new Date().toISOString()})`,
            msg.attempts,
          )
          .run();

        // Log structured event
        await logEvent(db, {
          hn_id: story.hn_id,
          event_type: 'dlq',
          severity: 'error',
          message: `Dead-lettered after ${msg.attempts} attempts: ${story.title}`,
          details: {
            url: story.url,
            domain: story.domain,
            attempts: msg.attempts,
          },
        });
      } catch (err) {
        console.error(`[dlq] Failed to record DLQ message for hn_id=${story.hn_id}:`, err);
      }

      // Always ack — we've recorded it, don't let it loop
      msg.ack();
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' && request.method === 'GET') {
      return new Response('HN HRCB DLQ Consumer + Replay Endpoint', { status: 200 });
    }

    // POST /replay — replay all pending DLQ messages
    // POST /replay/:id — replay a single DLQ message
    if (path.startsWith('/replay') && request.method === 'POST') {
      const authErr = checkAuth(request, env);
      if (authErr) return authErr;

      const db = env.DB;
      const singleIdMatch = path.match(/^\/replay\/(\d+)$/);

      let rows: DlqRow[];
      if (singleIdMatch) {
        const id = parseInt(singleIdMatch[1], 10);
        const result = await db
          .prepare(`SELECT id, hn_id, url, title, domain, original_error, retry_count, status FROM dlq_messages WHERE id = ? AND status = 'pending'`)
          .bind(id)
          .all<DlqRow>();
        rows = result.results;
        if (rows.length === 0) {
          return new Response(JSON.stringify({ error: 'Not found or not pending', id }), { status: 404 });
        }
      } else if (path === '/replay') {
        // Replay all pending, capped at 50 per call
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const cappedLimit = Math.min(Math.max(limit, 1), 100);
        const result = await db
          .prepare(`SELECT id, hn_id, url, title, domain, original_error, retry_count, status FROM dlq_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
          .bind(cappedLimit)
          .all<DlqRow>();
        rows = result.results;
        if (rows.length === 0) {
          return new Response(JSON.stringify({ replayed: 0, message: 'No pending DLQ messages' }), { status: 200 });
        }
      } else {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      // Re-enqueue each row and mark as replayed
      let replayed = 0;
      let failed = 0;
      const details: { id: number; hn_id: number; status: string }[] = [];

      for (const row of rows) {
        try {
          // Look up the story from the stories table to get hn_text
          const storyRow = await db
            .prepare(`SELECT hn_id, url, title, hn_text, domain FROM stories WHERE hn_id = ?`)
            .bind(row.hn_id)
            .first<QueueMessage>();

          const queueMsg: QueueMessage = storyRow || {
            hn_id: row.hn_id,
            url: row.url,
            title: row.title,
            hn_text: null,
            domain: row.domain || (row.url ? extractDomain(row.url) : null),
          };

          await env.EVAL_QUEUE.send(queueMsg);

          // Mark as replayed
          await db
            .prepare(`UPDATE dlq_messages SET status = 'replayed', resolved_at = datetime('now') WHERE id = ?`)
            .bind(row.id)
            .run();

          // Reset story eval_status so it gets re-evaluated
          await db
            .prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status = 'failed'`)
            .bind(row.hn_id)
            .run();

          await logEvent(db, {
            hn_id: row.hn_id,
            event_type: 'dlq_replay',
            severity: 'info',
            message: `DLQ message ${row.id} replayed: ${row.title}`,
            details: { dlq_id: row.id, original_error: row.original_error },
          });

          replayed++;
          details.push({ id: row.id, hn_id: row.hn_id, status: 'replayed' });
        } catch (err) {
          console.error(`[dlq] Replay failed for id=${row.id} hn_id=${row.hn_id}:`, err);
          failed++;
          details.push({ id: row.id, hn_id: row.hn_id, status: `error: ${String(err).slice(0, 100)}` });
        }
      }

      return new Response(JSON.stringify({ replayed, failed, total: rows.length, details }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  },
};
