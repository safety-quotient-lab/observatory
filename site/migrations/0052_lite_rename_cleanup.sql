-- Migration 0052: Comprehensive lite rename cleanup.
--
-- Catches everything migration 0051 missed:
--   1. Stragglers written by old production code between 0051 and deploy
--      (prompt_mode='light', schema_version='light-1.4')
--   2. Historical schema versions 1.0, 1.1, 1.2 that predate the rename
--      (display-only field — no code branches on stored schema_version)
--   3. Old calibration_runs rows with model='light-1.2'
--
-- Apply AFTER deploying new workers (so post-deploy evals already write 'lite').

-- Stragglers from pre-deploy production code
UPDATE rater_evals SET prompt_mode = 'lite' WHERE prompt_mode = 'light';
UPDATE eval_queue SET prompt_mode = 'lite' WHERE prompt_mode = 'light';

-- All remaining light-* schema versions (historical + stragglers)
UPDATE rater_evals SET schema_version = 'lite-1.4' WHERE schema_version = 'light-1.4';
UPDATE rater_evals SET schema_version = 'lite-1.3' WHERE schema_version = 'light-1.3';
UPDATE rater_evals SET schema_version = 'lite-1.2' WHERE schema_version = 'light-1.2';
UPDATE rater_evals SET schema_version = 'lite-1.1' WHERE schema_version = 'light-1.1';
UPDATE rater_evals SET schema_version = 'lite-1.0' WHERE schema_version = 'light-1.0';

-- Historical calibration runs
UPDATE calibration_runs SET model = 'lite-1.4' WHERE model = 'light-1.4';
UPDATE calibration_runs SET model = 'lite-1.3' WHERE model = 'light-1.3';
UPDATE calibration_runs SET model = 'lite-1.2' WHERE model = 'light-1.2';
