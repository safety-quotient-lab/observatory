-- Add et_arousal to rater_evals (was only in stories, needed for light-1.3 evals)
ALTER TABLE rater_evals ADD COLUMN et_arousal REAL;

-- Backfill stories supplementary signals from best available light rater_eval
-- Uses COALESCE so full-eval scores are never overwritten — light fills nulls only
UPDATE stories SET
  eq_score = COALESCE(eq_score, (
    SELECT eq_score FROM rater_evals
    WHERE hn_id = stories.hn_id AND prompt_mode = 'light' AND eq_score IS NOT NULL
    ORDER BY evaluated_at DESC LIMIT 1
  )),
  so_score = COALESCE(so_score, (
    SELECT so_score FROM rater_evals
    WHERE hn_id = stories.hn_id AND prompt_mode = 'light' AND so_score IS NOT NULL
    ORDER BY evaluated_at DESC LIMIT 1
  )),
  td_score = COALESCE(td_score, (
    SELECT td_score FROM rater_evals
    WHERE hn_id = stories.hn_id AND prompt_mode = 'light' AND td_score IS NOT NULL
    ORDER BY evaluated_at DESC LIMIT 1
  )),
  et_primary_tone = COALESCE(et_primary_tone, (
    SELECT et_primary_tone FROM rater_evals
    WHERE hn_id = stories.hn_id AND prompt_mode = 'light' AND et_primary_tone IS NOT NULL
    ORDER BY evaluated_at DESC LIMIT 1
  ))
WHERE eval_status = 'done';
