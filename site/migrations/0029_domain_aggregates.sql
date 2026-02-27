-- Migration 0029: domain_aggregates materialized table
-- Pre-computed per-domain signal averages and dominant modes.
-- Updated incrementally at eval write time via refreshDomainAggregate().
-- Replaces expensive correlated-subquery version of getDomainSignalProfiles.

CREATE TABLE IF NOT EXISTS domain_aggregates (
  domain               TEXT PRIMARY KEY,
  story_count          INTEGER NOT NULL DEFAULT 0,
  evaluated_count      INTEGER NOT NULL DEFAULT 0,
  avg_hrcb             REAL,
  avg_setl             REAL,
  avg_editorial        REAL,
  avg_structural       REAL,
  avg_confidence       REAL,
  avg_eq               REAL,
  avg_so               REAL,
  avg_sr               REAL,
  avg_td               REAL,
  avg_pt_count         REAL,
  avg_valence          REAL,
  avg_arousal          REAL,
  avg_dominance        REAL,
  avg_fw_ratio         REAL,
  avg_hn_score         REAL,
  avg_hn_comments      REAL,
  dominant_tone        TEXT,
  dominant_scope       TEXT,
  dominant_reading_level TEXT,
  dominant_sentiment   TEXT,
  last_updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_domain_aggregates_evaluated
  ON domain_aggregates(evaluated_count DESC);
