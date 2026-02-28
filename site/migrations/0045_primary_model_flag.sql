-- Add is_primary flag to model_registry
-- Designates which model's data populates the stories table (feed/API display)
-- Only one model should be primary; enforced in code (LIMIT 1), not DB constraint

ALTER TABLE model_registry ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

UPDATE model_registry SET is_primary = 1 WHERE model_id = 'claude-haiku-4-5-20251001';
