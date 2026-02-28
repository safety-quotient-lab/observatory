-- Migration 0050: Indexes to support domain_aggregates refresh patterns
--
-- 1. Partial covering indexes for the dominant-mode sub-selects in refreshDomainAggregate.
--    Each of the 4 correlated sub-selects groups by a mode column within a domain — these
--    partial indexes allow SQLite to do an index-only scan without filtering et_primary_tone IS NOT NULL.
--
-- 2. Index on domain_aggregates.last_updated_at for the stale-domain cron query
--    (ORDER BY last_updated_at ASC LIMIT 50) added in cron.ts at minute % 30.

CREATE INDEX IF NOT EXISTS idx_stories_domain_done_tone
  ON stories(domain, et_primary_tone)
  WHERE eval_status = 'done' AND et_primary_tone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stories_domain_done_scope
  ON stories(domain, gs_scope)
  WHERE eval_status = 'done' AND gs_scope IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stories_domain_done_reading_level
  ON stories(domain, cl_reading_level)
  WHERE eval_status = 'done' AND cl_reading_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stories_domain_done_sentiment
  ON stories(domain, hcb_sentiment_tag)
  WHERE eval_status = 'done' AND hcb_sentiment_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_aggregates_updated
  ON domain_aggregates(last_updated_at ASC)
  WHERE evaluated_count >= 1;
