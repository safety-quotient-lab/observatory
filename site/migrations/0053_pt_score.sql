-- Replace ad-hoc per-instance severity with technique-inherent weighted score.
-- pt_score = sum of PT_TECHNIQUE_WEIGHTS[technique] for each detected flag instance.
-- Weights: tier A (reductio_ad_hitlerum, appeal_to_fear, name_calling, false_dilemma,
--   thought_terminating_cliche) = 3; tier B (causal_oversimplification, strawman,
--   whataboutism, bandwagon, flag_waving, exaggeration, doubt) = 2; tier C (all others) = 1.
-- NULL = not measured (lite evals). 0 = measured, no flags found.
-- Backfill via: POST /trigger?sweep=backfill_pt_score (reads pt_flags_json, computes weights).

ALTER TABLE stories ADD COLUMN pt_score REAL;
ALTER TABLE rater_evals ADD COLUMN pt_score REAL;
ALTER TABLE domain_aggregates ADD COLUMN avg_pt_score REAL;
