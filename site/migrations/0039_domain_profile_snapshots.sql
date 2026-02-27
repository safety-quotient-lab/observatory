-- Domain profile versioning: daily snapshots of domain_aggregates state
-- Enables trend queries like "how did nytimes.com's HRCB change over 30 days?"
-- Populated by cron at minute === 5 (KV-guarded daily).

CREATE TABLE IF NOT EXISTS domain_profile_snapshots (
  domain           TEXT    NOT NULL,
  snapshot_date    TEXT    NOT NULL,  -- YYYY-MM-DD
  story_count      INTEGER NOT NULL,
  evaluated_count  INTEGER NOT NULL,
  avg_hrcb         REAL,
  avg_setl         REAL,
  avg_editorial    REAL,
  avg_structural   REAL,
  avg_eq           REAL,
  avg_so           REAL,
  avg_td           REAL,
  avg_valence      REAL,
  avg_arousal      REAL,
  dominant_tone    TEXT,
  PRIMARY KEY (domain, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_domain_snapshots_date
  ON domain_profile_snapshots(snapshot_date);
