CREATE TABLE IF NOT EXISTS domain_dcp (
  domain    TEXT PRIMARY KEY,
  dcp_json  TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);
