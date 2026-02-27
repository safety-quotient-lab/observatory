-- Indexes for /system page query performance
-- eval_history has ZERO indexes despite being scanned by 3 system page functions

CREATE INDEX IF NOT EXISTS idx_eval_history_model
  ON eval_history(eval_model);

CREATE INDEX IF NOT EXISTS idx_eval_history_evaluated
  ON eval_history(evaluated_at);

CREATE INDEX IF NOT EXISTS idx_eval_history_hn_model
  ON eval_history(hn_id, eval_model);

-- rater_evals: partial index for done evals with date range (latency, summary, completeness)
CREATE INDEX IF NOT EXISTS idx_rater_evals_done_evaluated
  ON rater_evals(eval_status, evaluated_at)
  WHERE eval_status = 'done';

-- rater_evals: provider stats (getProviderStats, getModelQueueStats)
CREATE INDEX IF NOT EXISTS idx_rater_evals_provider_status
  ON rater_evals(eval_provider, eval_status, evaluated_at);
