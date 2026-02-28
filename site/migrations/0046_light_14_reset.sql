-- Migration 0046: Reset light-only stories for re-evaluation with light-1.4 prompt.
--
-- Condition: has hcb_editorial_mean from a light eval, but no hcb_weighted_mean (never
-- received a full eval). These stories carry the bimodal 0.0/0.8 distribution from
-- light-1.3, where small models defaulted to round floats on a [-1,+1] scale.
--
-- After reset: eval_status='pending' → cron re-dispatches to Workers AI queue →
-- writeLightRaterEvalResult fills in fresh light-1.4 scores via COALESCE (only updates NULLs).
--
-- Old rater_evals rows with prompt_mode='light' are preserved; re-eval overwrites them
-- via ON CONFLICT(hn_id, eval_model) DO UPDATE with the new schema_version='light-1.4'.
--
-- DO NOT apply this migration until light-1.4 is deployed and calibration has passed.
-- This is the point of no return — old bimodal scores are discarded.

UPDATE stories
SET hcb_editorial_mean    = NULL,
    eq_score              = NULL,
    so_score              = NULL,
    td_score              = NULL,
    et_primary_tone       = NULL,
    et_valence            = NULL,
    et_arousal            = NULL,
    hcb_theme_tag         = NULL,
    hcb_sentiment_tag     = NULL,
    hcb_executive_summary = NULL,
    eval_status           = 'pending',
    eval_model            = NULL,
    evaluated_at          = NULL
WHERE hcb_editorial_mean IS NOT NULL
  AND hcb_weighted_mean  IS NULL;
