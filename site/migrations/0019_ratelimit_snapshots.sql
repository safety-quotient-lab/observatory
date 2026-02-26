CREATE TABLE IF NOT EXISTS ratelimit_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  requests_remaining INTEGER,
  requests_limit INTEGER,
  input_tokens_remaining INTEGER,
  input_tokens_limit INTEGER,
  output_tokens_remaining INTEGER,
  output_tokens_limit INTEGER,
  cache_hit_rate REAL,
  consecutive_429s INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ratelimit_model_created ON ratelimit_snapshots (model, created_at DESC);
