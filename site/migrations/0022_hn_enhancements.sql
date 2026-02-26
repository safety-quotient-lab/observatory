-- User-story reverse index (speeds up all hn_by queries)
CREATE INDEX IF NOT EXISTS idx_stories_hn_by ON stories(hn_by);

-- Multi-feed snapshot indexes
CREATE INDEX IF NOT EXISTS idx_story_snapshots_list_type
  ON story_snapshots(list_type, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_story_snapshots_hn_id_list
  ON story_snapshots(hn_id, list_type);
