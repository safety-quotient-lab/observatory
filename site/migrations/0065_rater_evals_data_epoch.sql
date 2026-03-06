-- Add data_epoch column to rater_evals for marking historical vs current evaluation eras.
-- 'current' = active pipeline output from enabled models.
-- 'legacy-lite-1.x' = pre-PSQ lite HRCB evals from now-disabled WAI models.
-- Consensus scoring already filters by model_registry.enabled=1, so this is
-- semantic documentation for ad-hoc queries and longitudinal analysis.

ALTER TABLE rater_evals ADD COLUMN data_epoch TEXT DEFAULT 'current';

-- Mark all evals from disabled lite HRCB models as legacy
UPDATE rater_evals
SET data_epoch = 'legacy-lite-1.x'
WHERE eval_model IN ('llama-3.3-70b-wai', 'llama-4-scout-wai')
  AND prompt_mode = 'lite';
