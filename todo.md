# TODO

## Data Sources

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth required: `/hottest.json`, `/newest.json`, `/active.json`
  - Fields: `short_id`, `title`, `url`, `score`, `comment_count`, `tags`, `comments_url`, `created_at`, `submitter_user`
  - Very similar data shape to HN — should map cleanly to existing `stories` schema
  - Need to: add `source` column to stories table, extend cron worker to crawl Lobsters feeds, apply same top-N auto-eval logic
  - Be polite with request rate (no documented limits, but ~1 req/min should be safe)
