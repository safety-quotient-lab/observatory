-- Batch API support for 50% cost savings
CREATE TABLE IF NOT EXISTS batches (
  batch_id      TEXT PRIMARY KEY,    -- Anthropic batch ID
  status        TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress/ended/expired/canceled
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  succeeded     INTEGER,
  failed        INTEGER
);

-- Link stories to their batch
ALTER TABLE stories ADD COLUMN eval_batch_id TEXT;
