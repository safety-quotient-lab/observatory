-- PSQ (Psychoemotional Safety Quotient) columns
-- Independent reader safety signal alongside HRCB Editorial/Structural

-- stories: PSQ scores (first-eval fill-in + consensus)
ALTER TABLE stories ADD COLUMN psq_score REAL;
ALTER TABLE stories ADD COLUMN psq_dimensions_json TEXT;
ALTER TABLE stories ADD COLUMN psq_confidence REAL;
ALTER TABLE stories ADD COLUMN psq_consensus_score REAL;
ALTER TABLE stories ADD COLUMN psq_consensus_model_count INTEGER DEFAULT 0;
ALTER TABLE stories ADD COLUMN psq_consensus_spread REAL;

-- rater_evals: per-model PSQ
ALTER TABLE rater_evals ADD COLUMN psq_score REAL;
ALTER TABLE rater_evals ADD COLUMN psq_dimensions_json TEXT;

-- domain_aggregates: PSQ average
ALTER TABLE domain_aggregates ADD COLUMN avg_psq REAL;

-- user_aggregates: PSQ average
ALTER TABLE user_aggregates ADD COLUMN avg_psq REAL;
