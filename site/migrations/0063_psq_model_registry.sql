-- PSQ model registry: new model IDs for lite-v2 prompt mode
-- Clean cut: same LLMs, different rater identity (prompt_mode='lite-v2')

-- Disable old lite models (historical evals preserved under old IDs)
UPDATE model_registry SET enabled = 0, disabled_reason = 'superseded by -psq variant (lite-v2)' WHERE model_id = 'llama-3.3-70b-wai';
UPDATE model_registry SET enabled = 0, disabled_reason = 'superseded by -psq variant (lite-v2)' WHERE model_id = 'llama-4-scout-wai';
UPDATE model_registry SET enabled = 0, disabled_reason = 'superseded by -psq variant (lite-v2)' WHERE model_id = 'qwen3-30b-a3b-wai';

-- Insert new PSQ model entries
INSERT OR IGNORE INTO model_registry (model_id, enabled, disabled_reason) VALUES ('llama-3.3-70b-wai-psq', 1, NULL);
INSERT OR IGNORE INTO model_registry (model_id, enabled, disabled_reason) VALUES ('llama-4-scout-wai-psq', 1, NULL);
INSERT OR IGNORE INTO model_registry (model_id, enabled, disabled_reason) VALUES ('qwen3-30b-a3b-wai-psq', 0, 'enable after PSQ pipeline proven in production');
