-- Rights Tension Signature (RTS): salient rights trade-offs identified during evaluation
-- Format: JSON array [{article_a: <int 0-30>, article_b: <int 0-30>, label: "<str>"}], max 3 pairs
-- Full JSON stored in stories (display); count only in rater_evals (hcb_json has full response)
-- NULL = not measured (lite evals or pre-RTS stories). [] = measured, no salient tensions found.

ALTER TABLE stories ADD COLUMN rts_tensions_json TEXT;
ALTER TABLE rater_evals ADD COLUMN rts_tension_count INTEGER;
