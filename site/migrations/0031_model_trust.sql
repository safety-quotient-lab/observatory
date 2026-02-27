-- Phase 37B: Evaluator Trust Index
-- Daily snapshot of per-model trust score (calibration accuracy + consensus agreement + parse success)

CREATE TABLE IF NOT EXISTS model_trust_snapshots (
  model_id     TEXT NOT NULL,
  day          TEXT NOT NULL,
  calibration_accuracy  REAL,   -- fraction of recent cal URLs in range (0.0-1.0)
  consensus_agreement   REAL,   -- avg agreement with consensus score (0.0-1.0)
  parse_success_rate    REAL,   -- fraction of evals that parsed successfully (0.0-1.0)
  trust_score           REAL,   -- composite: cal*0.4 + consensus*0.35 + parse*0.25
  eval_count            INTEGER NOT NULL DEFAULT 0,  -- evals in past 7 days
  PRIMARY KEY (model_id, day)
);

CREATE INDEX IF NOT EXISTS idx_model_trust_day ON model_trust_snapshots(day DESC);
