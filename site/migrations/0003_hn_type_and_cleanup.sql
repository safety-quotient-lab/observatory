-- Add hn_type column for API-sourced categorization (replaces title LIKE matching)
ALTER TABLE stories ADD COLUMN hn_type TEXT NOT NULL DEFAULT 'story';

-- Add hn_text column for self-post body (Ask HN, Show HN text content)
ALTER TABLE stories ADD COLUMN hn_text TEXT;

-- Index for hn_type filtering
CREATE INDEX idx_stories_hn_type ON stories(hn_type);

-- Backfill hn_type from existing titles
UPDATE stories SET hn_type = 'ask' WHERE title LIKE 'Ask HN:%';
UPDATE stories SET hn_type = 'show' WHERE title LIKE 'Show HN:%';

-- Clear redundant per-row prompt storage (identical system prompt stored 111 times)
UPDATE stories SET eval_system_prompt = NULL, eval_user_prompt = NULL WHERE eval_system_prompt IS NOT NULL;
