-- Story priority score: time-decayed composite signal for eval dispatch ordering.
-- Formula (computed in TypeScript, stored here): time-decayed HN score + comments
-- + log10(submitter karma) * 10 + feed membership * 5.
-- COALESCE fallback to hn_score in queue.ts for stories without a score yet.
ALTER TABLE stories ADD COLUMN eval_priority_score REAL;
CREATE INDEX IF NOT EXISTS idx_stories_priority_pending
  ON stories(eval_priority_score DESC)
  WHERE eval_status = 'pending';
