-- Add unique constraint to prevent duplicate calibration_evals rows
-- when multiple evaluator instances run concurrently (e.g. backfill daemon + manual run).
-- Uses a covering index with UNIQUE so INSERT OR IGNORE can deduplicate at write time.

-- SQLite doesn't support ADD CONSTRAINT on existing tables, so we recreate.
-- Deduplicate first: keep the earliest row per (run, hn_id, model, provider).
DELETE FROM calibration_evals
WHERE id NOT IN (
  SELECT MIN(id)
  FROM calibration_evals
  GROUP BY calibration_run, hn_id, eval_model, eval_provider
);

-- Recreate table with unique constraint.
CREATE TABLE calibration_evals_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  calibration_run    INTEGER NOT NULL,
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
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(calibration_run, hn_id, eval_model, eval_provider)
);

INSERT INTO calibration_evals_new SELECT * FROM calibration_evals;
DROP TABLE calibration_evals;
ALTER TABLE calibration_evals_new RENAME TO calibration_evals;

CREATE INDEX idx_calibration_evals_run ON calibration_evals(calibration_run);
CREATE INDEX idx_calibration_evals_hn  ON calibration_evals(hn_id);
