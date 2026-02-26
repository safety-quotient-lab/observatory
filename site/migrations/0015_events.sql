-- Structured event log for pipeline observability.
-- Captures cron runs, eval retries/failures, rate limits, crawl errors, etc.
-- 90-day retention enforced by pruneEvents() in cron worker.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER,                          -- nullable (system-level events have no story)
  event_type TEXT NOT NULL,               -- eval_failure, eval_retry, eval_skip, eval_success,
                                          -- rate_limit, fetch_error, parse_error,
                                          -- cron_run, cron_error, crawl_error,
                                          -- r2_error, dlq, trigger
  severity TEXT NOT NULL DEFAULT 'info',  -- info | warn | error
  message TEXT NOT NULL,                  -- human-readable summary
  details TEXT,                           -- JSON blob (error stack, HTTP status, retry count, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_hn_id ON events (hn_id, created_at DESC);
CREATE INDEX idx_events_type ON events (event_type, created_at DESC);
CREATE INDEX idx_events_created ON events (created_at DESC);
