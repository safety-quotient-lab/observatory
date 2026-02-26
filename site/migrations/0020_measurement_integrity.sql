-- Dead Letter Queue messages
CREATE TABLE IF NOT EXISTS dlq_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  domain TEXT,
  original_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_dlq_status ON dlq_messages (status, created_at DESC);

-- Calibration run results
CREATE TABLE IF NOT EXISTS calibration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  methodology_hash TEXT NOT NULL,
  total_urls INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Methodology hash on stories for reprocessing detection
ALTER TABLE stories ADD COLUMN methodology_hash TEXT;
CREATE INDEX idx_stories_methodology ON stories (methodology_hash);
