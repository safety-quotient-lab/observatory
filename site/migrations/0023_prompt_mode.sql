-- Add prompt_mode column to rater_evals for filtering light vs full evals
ALTER TABLE rater_evals ADD COLUMN prompt_mode TEXT DEFAULT 'full';

-- Backfill existing light evals based on schema_version
UPDATE rater_evals SET prompt_mode = 'light' WHERE schema_version LIKE 'light%';

-- Index for filtering by prompt_mode
CREATE INDEX IF NOT EXISTS idx_rater_evals_prompt_mode ON rater_evals(prompt_mode);
