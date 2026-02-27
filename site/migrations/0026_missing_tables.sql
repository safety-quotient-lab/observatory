-- story_comments: referenced in hn-bot.ts (INSERT), db-stories.ts (queries),
-- and migration 0010 (ALTER) but never created via migration.
CREATE TABLE IF NOT EXISTS story_comments (
  hn_id      INTEGER NOT NULL REFERENCES stories(hn_id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL,
  parent_id  INTEGER NOT NULL,
  author     TEXT,
  text       TEXT,
  time       INTEGER,
  depth      INTEGER NOT NULL DEFAULT 0,
  hn_score   INTEGER,
  PRIMARY KEY (hn_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_story_comments_hn_id ON story_comments(hn_id);

-- story_snapshots: indexed in migration 0022 but never created via migration.
CREATE TABLE IF NOT EXISTS story_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id       INTEGER NOT NULL REFERENCES stories(hn_id) ON DELETE CASCADE,
  hn_rank     INTEGER,
  hn_score    INTEGER,
  hn_comments INTEGER,
  list_type   TEXT NOT NULL DEFAULT 'topstories',
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_story_snapshots_hn_id ON story_snapshots(hn_id, snapshot_at);

-- hn_rank already exists in production (added manually). Skipped.

-- Composite indexes for common feed/domain query patterns
CREATE INDEX IF NOT EXISTS idx_stories_status_time
  ON stories(eval_status, hn_time DESC);
CREATE INDEX IF NOT EXISTS idx_stories_domain_status
  ON stories(domain, eval_status);
CREATE INDEX IF NOT EXISTS idx_rater_evals_hn_status
  ON rater_evals(hn_id, eval_status, eval_model);
CREATE INDEX IF NOT EXISTS idx_stories_evaluated_at
  ON stories(evaluated_at DESC)
  WHERE eval_status = 'done';

-- Phase 15B: partial index for evaluated story score lookups
CREATE INDEX IF NOT EXISTS idx_stories_eval_done_score
  ON stories(hcb_weighted_mean)
  WHERE eval_status = 'done';
