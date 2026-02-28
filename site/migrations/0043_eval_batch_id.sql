-- Add batch tracking to rater_evals and eval_queue.
-- eval_batch_id links all evals dispatched in the same cron cycle,
-- enabling regression isolation to a specific run.
ALTER TABLE rater_evals ADD COLUMN eval_batch_id TEXT;
ALTER TABLE eval_queue ADD COLUMN batch_id TEXT;
-- stories.eval_batch_id already exists (original schema).
