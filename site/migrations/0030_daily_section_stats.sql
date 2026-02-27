-- Migration 0030: daily_section_stats rollup table
-- Pre-computed per-day, per-section score aggregates.
-- Updated incrementally at eval write time via refreshDailySectionStats().
-- Replaces expensive full-scan query in getArticleSparklines.

CREATE TABLE IF NOT EXISTS daily_section_stats (
  day     TEXT NOT NULL,
  section TEXT NOT NULL,
  mean_final  REAL,
  min_final   REAL,
  max_final   REAL,
  eval_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, section)
);

CREATE INDEX IF NOT EXISTS idx_daily_section_stats_day
  ON daily_section_stats(day DESC);
