-- Track which HN feed lists a story appeared on (Seldon Index)
CREATE TABLE IF NOT EXISTS story_feeds (
  hn_id     INTEGER NOT NULL REFERENCES stories(hn_id) ON DELETE CASCADE,
  feed      TEXT NOT NULL,  -- 'top', 'new', 'best', 'ask', 'show', 'job'
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hn_id, feed)
);

CREATE INDEX IF NOT EXISTS idx_story_feeds_feed ON story_feeds(feed);
