CREATE TABLE stories (
  hn_id             INTEGER PRIMARY KEY,
  url               TEXT,
  title             TEXT NOT NULL,
  domain            TEXT,
  hn_score          INTEGER,
  hn_comments       INTEGER,
  hn_by             TEXT,
  hn_time           INTEGER NOT NULL,
  content_type      TEXT NOT NULL DEFAULT 'ED',
  hcb_weighted_mean REAL,
  hcb_classification TEXT,
  hcb_signal_sections INTEGER,
  hcb_nd_count      INTEGER,
  hcb_json          TEXT,
  eval_status       TEXT NOT NULL DEFAULT 'pending',
  eval_error        TEXT,
  evaluated_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stories_hn_time ON stories(hn_time DESC);
CREATE INDEX idx_stories_eval_status ON stories(eval_status);
CREATE INDEX idx_stories_hcb ON stories(hcb_weighted_mean);

CREATE TABLE scores (
  hn_id             INTEGER NOT NULL REFERENCES stories(hn_id) ON DELETE CASCADE,
  section           TEXT NOT NULL,
  sort_order        INTEGER NOT NULL,
  final             REAL,
  editorial         REAL,
  structural        REAL,
  evidence          TEXT,
  directionality    TEXT NOT NULL DEFAULT '[]',
  note              TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hn_id, section)
);

CREATE INDEX idx_scores_section_final ON scores(section, final);
