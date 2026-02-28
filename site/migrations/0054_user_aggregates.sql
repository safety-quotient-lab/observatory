-- Migration 0054: user_aggregates materialized table + submitted_count on hn_users
--
-- Replaces the double full-table CTE scan in getUserIntelligence with a
-- materialized aggregate refreshed at eval write time. Same pattern as
-- domain_aggregates (migration 0029).
--
-- Two editorial lenses (empirically validated, r=0.44 — distinct constructs):
--   avg_editorial_full  = section-aggregate, full eval, Claude (eval_status='done')
--   avg_editorial_lite  = holistic estimate, lite eval, Llama/truncated content
--
-- submitted_count on hn_users: populated by crawlUserProfiles() from HN API.

ALTER TABLE hn_users ADD COLUMN submitted_count INTEGER;

CREATE TABLE IF NOT EXISTS user_aggregates (
  username             TEXT PRIMARY KEY,
  stories              INTEGER NOT NULL DEFAULT 0,
  full_evaluated       INTEGER NOT NULL DEFAULT 0,
  lite_evaluated       INTEGER NOT NULL DEFAULT 0,
  submitted_count      INTEGER,
  avg_hrcb             REAL,
  min_hrcb             REAL,
  max_hrcb             REAL,
  hrcb_range           REAL,
  positive_pct         REAL,
  negative_pct         REAL,
  neutral_pct          REAL,
  avg_structural       REAL,
  avg_setl             REAL,
  avg_editorial_full   REAL,
  avg_editorial_lite   REAL,
  avg_eq               REAL,
  avg_so               REAL,
  avg_td               REAL,
  total_hn_score       INTEGER NOT NULL DEFAULT 0,
  avg_hn_score         REAL,
  total_comments       INTEGER NOT NULL DEFAULT 0,
  avg_comments         REAL,
  unique_domains       INTEGER NOT NULL DEFAULT 0,
  top_domain           TEXT,
  dominant_tone        TEXT,
  karma                INTEGER,
  account_age_days     INTEGER,
  last_updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_agg_stories    ON user_aggregates(stories DESC);
CREATE INDEX IF NOT EXISTS idx_user_agg_karma      ON user_aggregates(karma DESC);
CREATE INDEX IF NOT EXISTS idx_user_agg_hrcb       ON user_aggregates(avg_hrcb DESC);
CREATE INDEX IF NOT EXISTS idx_user_agg_eq         ON user_aggregates(avg_eq DESC);
CREATE INDEX IF NOT EXISTS idx_user_agg_evaluated  ON user_aggregates(full_evaluated DESC);
