/**
 * Structured event logger for pipeline observability.
 * Inserts into the `events` table and provides query helpers.
 */

export type EventType =
  | 'eval_failure'
  | 'eval_retry'
  | 'eval_skip'
  | 'eval_success'
  | 'rate_limit'
  | 'fetch_error'
  | 'parse_error'
  | 'cron_run'
  | 'cron_error'
  | 'crawl_error'
  | 'r2_error'
  | 'dlq'
  | 'trigger';

export type Severity = 'info' | 'warn' | 'error';

export interface Event {
  id: number;
  hn_id: number | null;
  event_type: string;
  severity: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface EventStats {
  total: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  last_24h: number;
  last_7d: number;
  error_count_7d: number;
}

/**
 * Log a structured event to the events table.
 * Non-throwing — swallows DB errors to avoid disrupting the pipeline.
 */
export async function logEvent(
  db: D1Database,
  event: {
    hn_id?: number | null;
    event_type: EventType;
    severity?: Severity;
    message: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO events (hn_id, event_type, severity, message, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        event.hn_id ?? null,
        event.event_type,
        event.severity ?? 'info',
        event.message,
        event.details ? JSON.stringify(event.details) : null,
      )
      .run();
  } catch (err) {
    // Never let event logging break the pipeline
    console.error('[events] Failed to log event:', err);
  }
}

/**
 * Delete events older than `daysToKeep` days. Returns count of deleted rows.
 */
export async function pruneEvents(
  db: D1Database,
  daysToKeep = 90,
): Promise<number> {
  try {
    const result = await db
      .prepare(
        `DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`,
      )
      .bind(daysToKeep)
      .run();
    return result.meta?.changes ?? 0;
  } catch (err) {
    console.error('[events] Failed to prune events:', err);
    return 0;
  }
}

// --- Query helpers for frontend ---

interface EventRow {
  id: number;
  hn_id: number | null;
  event_type: string;
  severity: string;
  message: string;
  details: string | null;
  created_at: string;
}

function rowToEvent(row: EventRow): Event {
  let details: Record<string, unknown> | null = null;
  if (row.details) {
    try {
      details = JSON.parse(row.details);
    } catch {
      details = null;
    }
  }
  return { ...row, details };
}

/**
 * Get events for a specific story, newest first.
 */
export async function getEventsForStory(
  db: D1Database,
  hnId: number,
  limit = 50,
): Promise<Event[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM events WHERE hn_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(hnId, limit)
    .all<EventRow>();
  return results.map(rowToEvent);
}

/**
 * Get recent events across all stories, optionally filtered by type.
 */
export async function getRecentEvents(
  db: D1Database,
  limit = 50,
  eventType?: string,
): Promise<Event[]> {
  if (eventType) {
    const { results } = await db
      .prepare(
        `SELECT * FROM events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(eventType, limit)
      .all<EventRow>();
    return results.map(rowToEvent);
  }
  const { results } = await db
    .prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<EventRow>();
  return results.map(rowToEvent);
}

/**
 * Get aggregate event stats for the dashboard.
 */
export async function getEventStats(
  db: D1Database,
  days = 7,
): Promise<EventStats> {
  const [totalRow, typeRows, sevRows, h24Row, d7Row, errRow] =
    await Promise.all([
      db
        .prepare(`SELECT COUNT(*) as cnt FROM events`)
        .first<{ cnt: number }>(),
      db
        .prepare(
          `SELECT event_type, COUNT(*) as cnt FROM events
         WHERE created_at >= datetime('now', '-' || ? || ' days')
         GROUP BY event_type`,
        )
        .bind(days)
        .all<{ event_type: string; cnt: number }>(),
      db
        .prepare(
          `SELECT severity, COUNT(*) as cnt FROM events
         WHERE created_at >= datetime('now', '-' || ? || ' days')
         GROUP BY severity`,
        )
        .bind(days)
        .all<{ severity: string; cnt: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM events WHERE created_at >= datetime('now', '-1 day')`,
        )
        .first<{ cnt: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM events WHERE created_at >= datetime('now', '-7 days')`,
        )
        .first<{ cnt: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM events WHERE severity = 'error' AND created_at >= datetime('now', '-7 days')`,
        )
        .first<{ cnt: number }>(),
    ]);

  const by_type: Record<string, number> = {};
  for (const r of typeRows.results) {
    by_type[r.event_type] = r.cnt;
  }

  const by_severity: Record<string, number> = {};
  for (const r of sevRows.results) {
    by_severity[r.severity] = r.cnt;
  }

  return {
    total: totalRow?.cnt ?? 0,
    by_type,
    by_severity,
    last_24h: h24Row?.cnt ?? 0,
    last_7d: d7Row?.cnt ?? 0,
    error_count_7d: errRow?.cnt ?? 0,
  };
}

/**
 * Get last N cron_run events for dashboard health display.
 */
export async function getCronRuns(
  db: D1Database,
  limit = 5,
): Promise<Event[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM events WHERE event_type = 'cron_run' ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<EventRow>();
  return results.map(rowToEvent);
}

export interface CycleStats {
  cycle_start: string;
  cycle_end: string | null;
  duration_ms: number | null;
  stories_found: number | null;
  stories_new: number | null;
  evals_completed: number;
  evals_failed: number;
}

/**
 * Get per-cycle stats: for each cron_run, count eval_success and eval_failure events
 * that occurred between this cron_run and the next one.
 */
export async function getEvalsPerCycle(
  db: D1Database,
  limit = 10,
): Promise<CycleStats[]> {
  // Get last N+1 cron runs to compute boundaries
  const { results: runs } = await db
    .prepare(
      `SELECT created_at, details FROM events
       WHERE event_type = 'cron_run'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit + 1)
    .all<{ created_at: string; details: string | null }>();

  if (runs.length === 0) return [];

  const cycles: CycleStats[] = [];

  for (let i = 0; i < Math.min(runs.length, limit); i++) {
    const cycleStart = runs[i].created_at;
    const cycleEnd = i > 0 ? runs[i - 1].created_at : null;
    const details = runs[i].details ? JSON.parse(runs[i].details!) : null;

    // Count evals between this cron_run and the next (or now)
    const upperBound = cycleEnd || "datetime('now')";
    const { results: counts } = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN event_type = 'eval_success' THEN 1 ELSE 0 END) as success_count,
           SUM(CASE WHEN event_type = 'eval_failure' THEN 1 ELSE 0 END) as fail_count
         FROM events
         WHERE created_at >= ? AND created_at < ?
           AND event_type IN ('eval_success', 'eval_failure')`,
      )
      .bind(cycleStart, cycleEnd || new Date().toISOString())
      .all<{ success_count: number; fail_count: number }>();

    cycles.push({
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      duration_ms: details?.duration_ms ?? null,
      stories_found: details?.stories_found ?? null,
      stories_new: details?.stories_new ?? null,
      evals_completed: counts[0]?.success_count ?? 0,
      evals_failed: counts[0]?.fail_count ?? 0,
    });
  }

  return cycles;
}

/**
 * Get daily error counts for sparkline (last N days).
 */
export async function getDailyErrorCounts(
  db: D1Database,
  days = 7,
): Promise<{ day: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT DATE(created_at) as day, COUNT(*) as count
       FROM events
       WHERE severity IN ('warn', 'error')
         AND created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
    )
    .bind(days)
    .all<{ day: string; count: number }>();
  return results;
}
