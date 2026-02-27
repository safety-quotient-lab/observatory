-- Migration 0037: model_registry table
-- D1 overlay for MODEL_REGISTRY — enables toggling models without code deploys.
-- Seed includes all 11 models from MODEL_REGISTRY at their current enabled state.

CREATE TABLE IF NOT EXISTS model_registry (
  model_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 1,
  disabled_at     TEXT,
  disabled_reason TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed from MODEL_REGISTRY (4 enabled, 7 disabled)
INSERT INTO model_registry (model_id, enabled) VALUES
  ('claude-haiku-4-5-20251001', 1),
  ('deepseek-v3.2',             1),
  ('llama-3.3-70b',             1),
  ('llama-4-scout-wai',         1),
  ('trinity-large',             0),
  ('nemotron-nano-30b',         0),
  ('step-3.5-flash',            0),
  ('qwen3-next-80b',            0),
  ('mistral-small-3.1',         0),
  ('hermes-3-405b',             0),
  ('llama-3.3-70b-wai',         0);
