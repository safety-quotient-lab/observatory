-- Migration 0070: External PSQ endpoint integration
-- stories table is at 100 columns (D1/SQLite limit) — cannot add more.
-- Use psq_external table for external DistilBERT scores.
-- Existing psq_* columns on stories become "psq_lite" (LLM-based, no rename needed).
-- psq_score on stories is repurposed: cleared now, filled by trigger that
-- copies from psq_external after external scoring.

-- Phase 1: Create psq_external table for DistilBERT scores
CREATE TABLE IF NOT EXISTS psq_external (
  hn_id INTEGER PRIMARY KEY,
  psq_score REAL NOT NULL,
  psq_dimensions_json TEXT,
  psq_factors_json TEXT,
  psq_confidence REAL,
  scored_at TEXT DEFAULT (datetime('now')),
  model_version TEXT,
  elapsed_ms INTEGER
);

-- Phase 2: Preserve existing LLM PSQ data by copying to psq_external_lite
-- (This table preserves the LLM scores for comparison research)
CREATE TABLE IF NOT EXISTS psq_lite_archive (
  hn_id INTEGER PRIMARY KEY,
  psq_score REAL,
  psq_dimensions_json TEXT,
  psq_confidence REAL,
  psq_consensus_score REAL,
  psq_consensus_model_count INTEGER,
  psq_consensus_spread REAL,
  archived_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO psq_lite_archive (hn_id, psq_score, psq_dimensions_json, psq_confidence,
  psq_consensus_score, psq_consensus_model_count, psq_consensus_spread)
SELECT hn_id, psq_score, psq_dimensions_json, psq_confidence,
  psq_consensus_score, psq_consensus_model_count, psq_consensus_spread
FROM stories WHERE psq_score IS NOT NULL;

-- Phase 3: Clear stories.psq_* columns (external endpoint will repopulate)
UPDATE stories SET
  psq_score = NULL,
  psq_dimensions_json = NULL,
  psq_confidence = NULL,
  psq_consensus_score = NULL,
  psq_consensus_model_count = NULL,
  psq_consensus_spread = NULL;
