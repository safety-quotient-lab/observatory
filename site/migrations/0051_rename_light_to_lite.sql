-- Migration 0051: Rename prompt_mode 'light' → 'lite' and schema_version 'light-*' → 'lite-*'
--
-- "lite" is already used in the UI (badges, icons). This aligns stored DB values
-- with the codebase rename. Backward compat checks in code accept both values
-- during the transition window and can be simplified in a future cleanup.

UPDATE rater_evals SET prompt_mode = 'lite' WHERE prompt_mode = 'light';

UPDATE rater_evals SET schema_version = 'lite-1.4' WHERE schema_version = 'light-1.4';
UPDATE rater_evals SET schema_version = 'lite-1.3' WHERE schema_version = 'light-1.3';

UPDATE eval_queue SET prompt_mode = 'lite' WHERE prompt_mode = 'light';

UPDATE calibration_runs SET model = 'lite-1.4' WHERE model = 'light-1.4';
UPDATE calibration_runs SET model = 'lite-1.3' WHERE model = 'light-1.3';
