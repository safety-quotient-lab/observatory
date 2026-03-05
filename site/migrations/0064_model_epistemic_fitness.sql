-- Model epistemic fitness benchmark results (longitudinal tracking)
CREATE TABLE IF NOT EXISTS model_epistemic_fitness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  run_date TEXT NOT NULL,
  confab_probes_sent INTEGER NOT NULL DEFAULT 0,
  confab_flags_total INTEGER NOT NULL DEFAULT 0,
  confab_rate REAL,
  eval_stories_tested INTEGER NOT NULL DEFAULT 0,
  eval_in_range_count INTEGER NOT NULL DEFAULT 0,
  eval_in_range_rate REAL,
  eval_class_ordering_ok INTEGER,
  eval_scores_json TEXT,
  output_attempts INTEGER NOT NULL DEFAULT 0,
  output_valid_json INTEGER NOT NULL DEFAULT 0,
  output_valid_schema INTEGER NOT NULL DEFAULT 0,
  output_valid_json_rate REAL,
  output_valid_schema_rate REAL,
  composite_score REAL,
  prompt_mode TEXT NOT NULL DEFAULT 'lite',
  benchmark_version TEXT NOT NULL DEFAULT '1.0',
  duration_ms INTEGER,
  error_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mef_model_date ON model_epistemic_fitness(model_id, run_date);
