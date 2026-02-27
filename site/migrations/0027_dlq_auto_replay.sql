-- Migration 0027: DLQ auto-replay scheduling
ALTER TABLE dlq_messages ADD COLUMN auto_replay_at TEXT;
ALTER TABLE dlq_messages ADD COLUMN manual_review_required INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing pending entries get first auto-replay window
UPDATE dlq_messages
  SET auto_replay_at = datetime('now', '+1 hour')
  WHERE status = 'pending' AND auto_replay_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_auto_replay
  ON dlq_messages(auto_replay_at)
  WHERE status = 'pending' AND manual_review_required = 0;
