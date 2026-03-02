-- Migration 0057: Add structured score columns to eval_history for longitudinal queries
-- Purpose: Enable queryable comparisons (e.g., lite-1.4 vs lite-1.5) without JSON extraction
-- Historical rows get NULLs (safe — they still have hcb_json for full data)

ALTER TABLE eval_history ADD COLUMN hcb_editorial_mean REAL;
ALTER TABLE eval_history ADD COLUMN hcb_structural_mean REAL;
ALTER TABLE eval_history ADD COLUMN hcb_setl REAL;
ALTER TABLE eval_history ADD COLUMN schema_version TEXT;
