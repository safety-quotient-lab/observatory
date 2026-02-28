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
  | 'self_throttle'
  | 'credit_exhausted'
  | 'fetch_error'
  | 'cron_run'
  | 'cron_error'
  | 'crawl_error'
  | 'r2_error'
  | 'dlq'
  | 'dlq_replay'
  | 'calibration'
  | 'coverage_crawl'
  | 'trigger'
  | 'rater_validation_warn'
  | 'rater_validation_fail'
  | 'rater_auto_disable'
  | 'rater_auto_enable'
  | 'story_flagged'
  | 'auto_retry'
  | 'dlq_auto_replay'
  | 'auto_calibration'
  | 'dcp_stale'
  | 'r2_cleanup'
  | 'content_drift'
  | 'model_divergence';

export type Severity = 'info' | 'warn' | 'error';

export interface Event {
  id: number;
  hn_id: number | null;
  event_type: string;
  severity: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
  investigated: number | null;
  resolved: number | null;
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
 * Update the investigated/resolved triage flags on an event.
 */
export async function updateEventTriage(
  db: D1Database,
  eventId: number,
  fields: { investigated?: boolean | null; resolved?: boolean | null },
): Promise<void> {
  const sets: string[] = [];
  const values: (number | null)[] = [];

  if ('investigated' in fields) {
    sets.push('investigated = ?');
    values.push(fields.investigated === null ? null : fields.investigated ? 1 : 0);
  }
  if ('resolved' in fields) {
    sets.push('resolved = ?');
    values.push(fields.resolved === null ? null : fields.resolved ? 1 : 0);
  }
  if (sets.length === 0) return;

  values.push(eventId);
  await db
    .prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Delete events older than `daysToKeep` days. Returns count of deleted rows.
 * Also prunes old ratelimit_snapshots rows.
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

    // Also prune ratelimit_snapshots (same retention)
    try {
      await db
        .prepare(
          `DELETE FROM ratelimit_snapshots WHERE created_at < datetime('now', '-' || ? || ' days')`,
        )
        .bind(daysToKeep)
        .run();
    } catch {
      // Table may not exist yet
    }

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
  investigated: number | null;
  resolved: number | null;
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

  // Build boundary pairs
  const boundaries: { start: string; end: string | null; details: string | null }[] = [];
  for (let i = 0; i < Math.min(runs.length, limit); i++) {
    boundaries.push({
      start: runs[i].created_at,
      end: i > 0 ? runs[i - 1].created_at : null,
      details: runs[i].details,
    });
  }

  // Single query: fetch all eval events since oldest cycle start
  const oldestStart = boundaries[boundaries.length - 1].start;
  const { results: evalEvents } = await db
    .prepare(
      `SELECT created_at, event_type FROM events
       WHERE event_type IN ('eval_success', 'eval_failure')
         AND created_at >= ?
       ORDER BY created_at`,
    )
    .bind(oldestStart)
    .all<{ created_at: string; event_type: string }>();

  // Bucket events into cycles in JS (O(events × cycles), both small)
  const cycleCounters = boundaries.map(() => ({ success: 0, fail: 0 }));
  for (const ev of evalEvents) {
    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      if (ev.created_at >= b.start && (b.end === null || ev.created_at < b.end)) {
        if (ev.event_type === 'eval_success') cycleCounters[i].success++;
        else cycleCounters[i].fail++;
        break;
      }
    }
  }

  return boundaries.map((b, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let details: any = null;
    try {
      details = b.details ? JSON.parse(b.details) : null;
    } catch {
      details = null;
    }
    return {
      cycle_start: b.start,
      cycle_end: b.end,
      duration_ms: details?.duration_ms ?? null,
      stories_found: details?.stories_found ?? null,
      stories_new: details?.stories_new ?? null,
      evals_completed: cycleCounters[i].success,
      evals_failed: cycleCounters[i].fail,
    };
  });
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

// --- Rate limit snapshot queries ---

export interface RateLimitSnapshot {
  id: number;
  model: string;
  requests_remaining: number | null;
  requests_limit: number | null;
  input_tokens_remaining: number | null;
  input_tokens_limit: number | null;
  output_tokens_remaining: number | null;
  output_tokens_limit: number | null;
  cache_hit_rate: number | null;
  consecutive_429s: number;
  created_at: string;
}

/**
 * Get the latest rate limit snapshot, optionally filtered by model.
 * Returns null if the table doesn't exist or no rows match.
 */
export async function getLatestRateLimitSnapshot(
  db: D1Database,
  model?: string,
): Promise<RateLimitSnapshot | null> {
  try {
    if (model) {
      return await db
        .prepare(
          `SELECT * FROM ratelimit_snapshots WHERE model = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(model)
        .first<RateLimitSnapshot>();
    }
    return await db
      .prepare(
        `SELECT * FROM ratelimit_snapshots ORDER BY created_at DESC LIMIT 1`,
      )
      .first<RateLimitSnapshot>();
  } catch {
    // Table may not exist yet
    return null;
  }
}

// --- DLQ queries ---

export interface DlqMessage {
  id: number;
  hn_id: number;
  url: string | null;
  title: string;
  domain: string | null;
  original_error: string | null;
  retry_count: number;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export interface DlqStats {
  pending: number;
  replayed: number;
  discarded: number;
  total: number;
}

export async function getDlqStats(db: D1Database): Promise<DlqStats> {
  try {
    const { results } = await db
      .prepare(`SELECT status, COUNT(*) as cnt FROM dlq_messages GROUP BY status`)
      .all<{ status: string; cnt: number }>();
    const stats: DlqStats = { pending: 0, replayed: 0, discarded: 0, total: 0 };
    for (const r of results) {
      if (r.status === 'pending') stats.pending = r.cnt;
      else if (r.status === 'replayed') stats.replayed = r.cnt;
      else if (r.status === 'discarded') stats.discarded = r.cnt;
      stats.total += r.cnt;
    }
    return stats;
  } catch {
    return { pending: 0, replayed: 0, discarded: 0, total: 0 };
  }
}

export async function getDlqMessages(
  db: D1Database,
  status = 'pending',
  limit = 20,
): Promise<DlqMessage[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT * FROM dlq_messages WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(status, limit)
      .all<DlqMessage>();
    return results;
  } catch {
    return [];
  }
}

// --- Reprocessing / methodology queries ---

export interface MethodologyDistribution {
  methodology_hash: string | null;
  count: number;
  latest_eval: string | null;
}

export async function getMethodologyDistribution(
  db: D1Database,
): Promise<MethodologyDistribution[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT methodology_hash, COUNT(*) as count, MAX(evaluated_at) as latest_eval
         FROM stories WHERE eval_status = 'done'
         GROUP BY methodology_hash
         ORDER BY count DESC`,
      )
      .all<MethodologyDistribution>();
    return results;
  } catch {
    return [];
  }
}

// --- Model drift queries ---

export interface ModelDriftPair {
  eval_model: string;
  count: number;
  avg_score: number;
  min_score: number;
  max_score: number;
  stddev: number;
}

export async function getModelDriftStats(
  db: D1Database,
): Promise<{ models: ModelDriftPair[]; overlapping: number; meanDelta: number | null }> {
  try {
    // Per-model stats
    const { results: models } = await db
      .prepare(
        `SELECT eval_model,
                COUNT(*) as count,
                AVG(hcb_weighted_mean) as avg_score,
                MIN(hcb_weighted_mean) as min_score,
                MAX(hcb_weighted_mean) as max_score,
                AVG(hcb_weighted_mean * hcb_weighted_mean) as avg_sq
         FROM eval_history
         GROUP BY eval_model
         ORDER BY count DESC`,
      )
      .all<ModelDriftPair & { avg_sq: number }>();

    const modelStats = models.map((m) => ({
      ...m,
      stddev: Math.sqrt(Math.max(0, (m.avg_sq ?? 0) - (m.avg_score ?? 0) ** 2)),
    }));

    // Overlapping stories (evaluated by 2+ models)
    const overlapRow = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM (
           SELECT hn_id FROM eval_history GROUP BY hn_id HAVING COUNT(DISTINCT eval_model) >= 2
         )`,
      )
      .first<{ cnt: number }>();

    // Mean delta between models on overlapping stories
    let meanDelta: number | null = null;
    if ((overlapRow?.cnt ?? 0) > 0 && modelStats.length >= 2) {
      const deltaRow = await db
        .prepare(
          `SELECT AVG(ABS(a.hcb_weighted_mean - b.hcb_weighted_mean)) as mean_delta
           FROM eval_history a
           JOIN eval_history b ON a.hn_id = b.hn_id AND a.eval_model < b.eval_model`,
        )
        .first<{ mean_delta: number | null }>();
      meanDelta = deltaRow?.mean_delta ?? null;
    }

    return {
      models: modelStats,
      overlapping: overlapRow?.cnt ?? 0,
      meanDelta,
    };
  } catch {
    return { models: [], overlapping: 0, meanDelta: null };
  }
}

// --- Calibration queries ---

export interface CalibrationRun {
  id: number;
  model: string;
  methodology_hash: string;
  total_urls: number;
  passed: number;
  failed: number;
  skipped: number;
  status: string;
  details_json: string | null;
  created_at: string;
}

export async function getLatestCalibrationRun(
  db: D1Database,
): Promise<CalibrationRun | null> {
  try {
    return await db
      .prepare(
        `SELECT * FROM calibration_runs ORDER BY created_at DESC LIMIT 1`,
      )
      .first<CalibrationRun>();
  } catch {
    return null;
  }
}

export async function getLatestLiteCalibrationRun(
  db: D1Database,
): Promise<CalibrationRun | null> {
  try {
    return await db
      .prepare(
        `SELECT * FROM calibration_runs WHERE model IN ('light-1.3', 'light-1.4', 'lite-1.4') ORDER BY created_at DESC LIMIT 1`,
      )
      .first<CalibrationRun>();
  } catch {
    return null;
  }
}

