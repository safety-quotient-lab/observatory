-- Materialized article pair statistics (co-occurrence + Pearson correlation)
-- Replaces the expensive rater_scores self-join in getArticlePairStats.
-- Refreshed via refreshArticlePairStats() after evals or via sweep.
CREATE TABLE IF NOT EXISTS article_pair_stats (
  section_a   TEXT NOT NULL,
  section_b   TEXT NOT NULL,
  n           INTEGER NOT NULL DEFAULT 0,
  sum_ab      REAL NOT NULL DEFAULT 0,
  sum_a       REAL NOT NULL DEFAULT 0,
  sum_b       REAL NOT NULL DEFAULT 0,
  sum_a2      REAL NOT NULL DEFAULT 0,
  sum_b2      REAL NOT NULL DEFAULT 0,
  pearson_r   REAL,
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (section_a, section_b)
);
