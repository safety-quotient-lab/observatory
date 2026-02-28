-- Migration 0041: eval_queue — D1-backed pull model for story evaluation dispatch
--
-- Replaces CF Queue fan-out. enqueueForEvaluation inserts rows here; consumers
-- atomically claim and process them. One row per (hn_id, target_provider, target_model).
-- CF Queue messages become wake-up signals only (tiny { trigger: 'new_work' } payloads).
--
-- Status lifecycle: pending → claimed → done (or back to pending on failure/release)

CREATE TABLE IF NOT EXISTS eval_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id           INTEGER NOT NULL REFERENCES stories(hn_id),
  target_provider TEXT NOT NULL,
  target_model    TEXT NOT NULL,
  prompt_mode     TEXT NOT NULL DEFAULT 'full',
  priority        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | claimed | done
  claimed_by      TEXT,                               -- worker instance UUID
  claimed_at      TEXT,                               -- ISO datetime
  enqueued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hn_id, target_provider, target_model)
);

-- Primary claim index: by provider + status + priority/time ordering
CREATE INDEX IF NOT EXISTS idx_eval_queue_claim ON eval_queue(target_provider, status, priority DESC, enqueued_at ASC);

-- Cleanup index: stale claim recovery
CREATE INDEX IF NOT EXISTS idx_eval_queue_claimed_at ON eval_queue(status, claimed_at) WHERE status = 'claimed';
