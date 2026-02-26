-- Add missing columns to eval_history that consumer.ts INSERT expects.
ALTER TABLE eval_history ADD COLUMN hcb_classification TEXT;
ALTER TABLE eval_history ADD COLUMN hcb_json TEXT;
