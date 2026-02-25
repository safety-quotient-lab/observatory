-- Enhance comments with depth tracking and HN score (RAW reality tunnels)
ALTER TABLE story_comments ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE story_comments ADD COLUMN hn_score INTEGER;
