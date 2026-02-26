/**
 * Dead Letter Queue Consumer: Captures failed messages that exhausted retries.
 *
 * Instead of letting messages silently vanish, this worker:
 * 1. Writes the message to dlq_messages for inspection
 * 2. Logs a structured 'dlq' event
 * 3. Acks the message (so it doesn't loop)
 */

import { logEvent } from '../src/lib/events';

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
};
