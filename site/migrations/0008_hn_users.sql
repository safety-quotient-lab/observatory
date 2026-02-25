-- HN user profiles for poster analysis (Heinlein competent-man)
CREATE TABLE IF NOT EXISTS hn_users (
  username    TEXT PRIMARY KEY,
  karma       INTEGER,
  created     INTEGER,
  about       TEXT,
  cached_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hn_users_karma ON hn_users(karma DESC);
