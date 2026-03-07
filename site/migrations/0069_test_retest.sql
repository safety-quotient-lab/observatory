-- Test-retest reliability tracking.
-- Stores original scores before re-evaluation so we can compare.
CREATE TABLE IF NOT EXISTS test_retest_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER NOT NULL,
  eval_model TEXT NOT NULL,
  original_score REAL NOT NULL,
  original_editorial REAL,
  original_structural REAL,
  original_setl REAL,
  original_evaluated_at TEXT NOT NULL,
  retest_score REAL,
  retest_editorial REAL,
  retest_structural REAL,
  retest_setl REAL,
  retest_evaluated_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hn_id, eval_model)
);
