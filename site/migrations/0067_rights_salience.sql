-- Rights Salience (RS) — three-factor validity gate for HRCB
-- rs_score = breadth × depth × intensity
-- Only meaningful for full evals (per-section scores); NULL for lite/PSQ

ALTER TABLE stories ADD COLUMN rs_score REAL;
ALTER TABLE stories ADD COLUMN rs_breadth REAL;
ALTER TABLE stories ADD COLUMN rs_depth REAL;
ALTER TABLE stories ADD COLUMN rs_intensity REAL;

ALTER TABLE rater_evals ADD COLUMN rs_score REAL;
ALTER TABLE rater_evals ADD COLUMN rs_breadth REAL;
ALTER TABLE rater_evals ADD COLUMN rs_depth REAL;
ALTER TABLE rater_evals ADD COLUMN rs_intensity REAL;

-- Index for salience gating queries (low-salience stories)
CREATE INDEX IF NOT EXISTS idx_stories_rs_score ON stories(rs_score)
  WHERE rs_score IS NOT NULL;
