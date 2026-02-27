-- Longitudinal calibration eval storage.
-- Accumulates per-slot raw scores across calibration runs — never deleted.
-- rater_evals still written per-run for pipeline/queue-filter compat;
-- this table provides the historical record without needing schema changes to rater_evals.

CREATE TABLE calibration_evals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  calibration_run    INTEGER NOT NULL,  -- unix timestamp generated at POST /calibrate time
  hn_id              INTEGER NOT NULL,
  eval_model         TEXT NOT NULL,
  eval_provider      TEXT NOT NULL,
  prompt_mode        TEXT,
  schema_version     TEXT,
  hcb_editorial_mean REAL,
  hcb_weighted_mean  REAL,
  hcb_classification TEXT,
  eq_score           REAL,
  so_score           REAL,
  td_score           REAL,
  et_valence         REAL,
  et_arousal         REAL,
  et_primary_tone    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_calibration_evals_run ON calibration_evals(calibration_run);
CREATE INDEX idx_calibration_evals_hn  ON calibration_evals(hn_id);
