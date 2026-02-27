-- Migration 0028: Ensemble consensus scoring columns
ALTER TABLE stories ADD COLUMN consensus_score REAL;
ALTER TABLE stories ADD COLUMN consensus_model_count INTEGER DEFAULT 0;
ALTER TABLE stories ADD COLUMN consensus_spread REAL;
ALTER TABLE stories ADD COLUMN consensus_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_stories_consensus
  ON stories(consensus_score DESC)
  WHERE consensus_model_count >= 2;
