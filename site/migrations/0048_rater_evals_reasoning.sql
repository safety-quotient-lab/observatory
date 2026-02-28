-- Add reasoning column to rater_evals for light-1.4+ pre-commit classification strings.
-- Stores the 10-word "content type and rights stance" field that appears before the numeric
-- score in the JSON template. Null for all pre-1.4 evals and full-mode evals (not emitted).
-- Used for diagnosing score calibration (e.g. distinguishing genuine neutral-50 from lazy-50).
ALTER TABLE rater_evals ADD COLUMN reasoning TEXT;
