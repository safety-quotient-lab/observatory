-- Content change detection: track content hashes for drift detection
ALTER TABLE stories ADD COLUMN content_hash TEXT;
ALTER TABLE stories ADD COLUMN content_last_fetched TEXT;
CREATE INDEX idx_stories_content_hash ON stories(content_hash) WHERE content_hash IS NOT NULL;
