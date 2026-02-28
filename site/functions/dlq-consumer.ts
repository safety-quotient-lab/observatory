/**
 * Dead Letter Queue Consumer + Replay Endpoint.
 *
 * Queue consumer:
 * 1. Writes failed messages to dlq_messages (including eval_model/eval_provider)
 * 2. Logs a structured 'dlq' event
 * 3. Acks the message (so it doesn't loop)
 *
 * HTTP endpoints:
 * - GET  /          → health check
 * - POST /replay    → re-enqueue pending DLQ messages to the correct provider queue
 * - POST /replay/:id → re-enqueue a single DLQ message by ID
 */

import { logEvent } from '../src/lib/events';
import { extractDomain, getModelDef } from '../src/lib/shared-eval';
import { MODEL_QUEUE_BINDINGS, PRIMARY_MODEL_ID } from '../src/lib/models';

interface Env {
  DB: D1Database;
  // Queue producer bindings — one per provider queue
  EVAL_QUEUE: Queue;
  DEEPSEEK_QUEUE: Queue;
  TRINITY_QUEUE: Queue;
  NEMOTRON_QUEUE: Queue;
  STEP_QUEUE: Queue;
  QWEN_QUEUE: Queue;
  LLAMA_QUEUE: Queue;
  MISTRAL_QUEUE: Queue;
  HERMES_QUEUE: Queue;
  WORKERS_AI_QUEUE: Queue;
  CRON_SECRET?: string;
}

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
  eval_model?: string;
  eval_provider?: string;
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
  eval_model: string | null;
  eval_provider: string | null;
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

/** Get the correct queue for a model ID, falling back to EVAL_QUEUE (Anthropic). */
function getQueue(env: Env, modelId: string | null | undefined): Queue {
  if (!modelId) return env.EVAL_QUEUE;
  const binding = MODEL_QUEUE_BINDINGS[modelId] || 'EVAL_QUEUE';
  const queue = (env as any)[binding] as Queue | undefined;
  return queue || env.EVAL_QUEUE;
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;

    for (const msg of batch.messages) {
      const story = msg.body;
      console.log(`[dlq] Dead-lettered: hn_id=${story.hn_id} model=${story.eval_model || 'primary'}: ${story.title}`);

      try {
        // Count prior DLQ entries for this hn_id to determine auto-replay schedule
        const priorRow = await db
          .prepare(`SELECT COUNT(*) as cnt FROM dlq_messages WHERE hn_id = ?`)
          .bind(story.hn_id)
          .first<{ cnt: number }>();
        const prevCount = priorRow?.cnt ?? 0;

        const autoReplayAt = prevCount === 0
          ? new Date(Date.now() + 3_600_000).toISOString()   // +1h
          : prevCount === 1
            ? new Date(Date.now() + 21_600_000).toISOString() // +6h
            : null;                                            // manual review required
        const manualRequired = prevCount >= 2 ? 1 : 0;

        // Write to dlq_messages table (including model/provider for routing on replay)
        await db
          .prepare(
            `INSERT INTO dlq_messages (hn_id, url, title, domain, original_error, retry_count, eval_model, eval_provider, auto_replay_at, manual_review_required)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            story.hn_id,
            story.url || null,
            story.title,
            story.domain || null,
            `Exhausted all retries (delivered to DLQ at ${new Date().toISOString()})`,
            msg.attempts,
            story.eval_model || null,
            story.eval_provider || null,
            autoReplayAt,
            manualRequired,
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
            eval_model: story.eval_model,
            eval_provider: story.eval_provider,
          },
        });

        // Ack only after successful recording
        msg.ack();
      } catch (err) {
        console.error(`[dlq] Failed to record DLQ message for hn_id=${story.hn_id}:`, err);
        // Don't ack — let CF retry or expire naturally
      }
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
          .prepare(`SELECT id, hn_id, url, title, domain, original_error, retry_count, status, eval_model, eval_provider FROM dlq_messages WHERE id = ? AND status = 'pending'`)
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
          .prepare(`SELECT id, hn_id, url, title, domain, original_error, retry_count, status, eval_model, eval_provider FROM dlq_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
          .bind(cappedLimit)
          .all<DlqRow>();
        rows = result.results;
        if (rows.length === 0) {
          return new Response(JSON.stringify({ replayed: 0, message: 'No pending DLQ messages' }), { status: 200 });
        }
      } else {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      // Re-enqueue each row to the correct provider queue and mark as replayed
      let replayed = 0;
      let failed = 0;
      const details: { id: number; hn_id: number; status: string; queue?: string }[] = [];

      for (const row of rows) {
        try {
          // Look up the story from the stories table to get hn_text
          const storyRow = await db
            .prepare(`SELECT hn_id, url, title, hn_text, domain FROM stories WHERE hn_id = ?`)
            .bind(row.hn_id)
            .first<QueueMessage>();

          const queueMsg: QueueMessage = {
            hn_id: storyRow?.hn_id ?? row.hn_id,
            url: storyRow?.url ?? row.url,
            title: storyRow?.title ?? row.title,
            hn_text: storyRow?.hn_text ?? null,
            domain: storyRow?.domain ?? row.domain ?? (row.url ? extractDomain(row.url) : null),
            eval_model: row.eval_model || undefined,
            eval_provider: row.eval_provider || undefined,
          };

          // Route to the correct queue based on the model that originally failed
          const targetQueue = getQueue(env, row.eval_model);
          const queueBinding = row.eval_model ? (MODEL_QUEUE_BINDINGS[row.eval_model] || 'EVAL_QUEUE') : 'EVAL_QUEUE';
          await targetQueue.send(queueMsg);

          // Mark as replayed
          await db
            .prepare(`UPDATE dlq_messages SET status = 'replayed', resolved_at = datetime('now') WHERE id = ?`)
            .bind(row.id)
            .run();

          // Reset story eval_status so it gets re-evaluated (primary model only)
          if (!row.eval_model || row.eval_model === PRIMARY_MODEL_ID) {
            await db
              .prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status = 'failed'`)
              .bind(row.hn_id)
              .run();
          }

          await logEvent(db, {
            hn_id: row.hn_id,
            event_type: 'dlq_replay',
            severity: 'info',
            message: `DLQ message ${row.id} replayed to ${queueBinding}: ${row.title}`,
            details: { dlq_id: row.id, original_error: row.original_error, eval_model: row.eval_model, queue: queueBinding },
          });

          replayed++;
          details.push({ id: row.id, hn_id: row.hn_id, status: 'replayed', queue: queueBinding });
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
