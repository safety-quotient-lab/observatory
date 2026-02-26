# TODO

## Data Sources

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth required: `/hottest.json`, `/newest.json`, `/active.json`
  - Fields: `short_id`, `title`, `url`, `score`, `comment_count`, `tags`, `comments_url`, `created_at`, `submitter_user`
  - Very similar data shape to HN — should map cleanly to existing `stories` schema
  - Need to: add `source` column to stories table, extend cron worker to crawl Lobsters feeds, apply same top-N auto-eval logic
  - Be polite with request rate (no documented limits, but ~1 req/min should be safe)

## Pipeline Resilience

- [ ] **DLQ auto-replay with exponential backoff**
  - First DLQ entry: auto-replay after 1h
  - Second DLQ entry: auto-replay after 6h
  - Third DLQ entry: mark `manual_review_required`, stop auto-replay
  - Implement as cron job checking `auto_replay_at` column on dlq_messages

- [ ] **Domain-level circuit breaker**
  - Track consecutive fetch failures per domain
  - After 10 consecutive failures, auto-skip new stories from that domain with reason `domain_unreachable`
  - Reset counter on any successful fetch
  - Prevents wasting queue slots on permanently-down sites

- [ ] **Configurable rate limit max backoff**
  - Current hard-coded 120s cap may be too low under heavy rate limiting
  - Add `RATE_LIMIT_MAX_BACKOFF_SECONDS` env var (default 120)

## Monitoring & Alerting

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h window of eval_history token usage
  - Log `alert_level: critical` event when projected exhaustion <24h
  - Show forecast on dashboard headroom widget

- [ ] **Evaluation latency percentiles**
  - Track P50/P95/P99 eval duration by model
  - Add `eval_duration_seconds` derived from `evaluated_at - created_at`
  - Surface on dashboard as sparkline

- [ ] **DLQ trend tracking**
  - Compare DLQ count across time windows (1d, 7d, 30d)
  - Flag if DLQ backlog is growing (more entries than resolves)

- [ ] **Self-throttle impact analysis**
  - Aggregate `delay_seconds` from self_throttle events
  - Show total time lost to throttling per day/week
  - Correlate with API quota events

## Data Quality

- [ ] **Signal completeness matrix**
  - Query per-model % non-null for each supplementary signal (eq_score, pt_flag_count, so_score, etc.)
  - Flag models with <80% completion for re-evaluation targeting
  - Dashboard widget showing completion heatmap

- [ ] **Content type classification validation**
  - Post-eval check: if content_type=PO but 0 structural evidence, flag as likely misclassification
  - Track misclassification rate per model over time

- [ ] **DCP staleness alerting**
  - Flag domains appearing in >20 stories where DCP is >30 days old
  - Log `dcp_stale` event for dashboard visibility

- [ ] **Eval consistency check for re-evaluations**
  - When same URL is evaluated by different models, compare hcb_weighted_mean
  - Alert if divergence > ±0.25 (potential model drift or content change)

## User-Facing Features

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side hcb_weighted_mean, classification, sentiment
  - Section-by-section score differences
  - E vs S channel divergence visualization

- [ ] **Domain reputation card**
  - Aggregate: avg score, avg confidence, avg SETL, total stories evaluated
  - DCP elements displayed as tags
  - 7d vs 30d trend comparison

- [ ] **Story audit trail in UI**
  - Show full event chain on `/item/[id]` (created → queued → evaluating → done)
  - Rate limit state snapshot at eval time
  - Content fetch latency, token usage, model used
  - Major debugging win for understanding individual evals

- [ ] **Temporal trend analysis**
  - Rolling 7-day avg hcb_weighted_mean line chart
  - Eval velocity (stories/day)
  - Model mix over time (stacked bar)

- [ ] **Article deep dive enhancements** (`/article/[n]`)
  - Stddev distribution, evidence strength breakdown
  - Top 3 positive/negative stories per article
  - Directionality marker distribution (A/P/F/C bar chart)
  - Theme tag word cloud

## Schema & Architecture

- [ ] **Cost attribution per model**
  - Compute daily cost per model from eval_history token counts + Anthropic pricing
  - Dashboard widget showing cost/eval by model, daily burn rate

- [ ] **Eval batch tracking**
  - Add `eval_batch_id` to link related evals from same cron cycle
  - Enables "which evals ran together" debugging

- [ ] **Story priority scoring**
  - Rank pending stories by composite of HN score, comment count, time-decay, feed membership
  - Replace simple "top 5 pages" threshold with dynamic priority queue
  - Add `eval_priority_score` computed by cron

- [ ] **R2 content snapshot retention policy**
  - Delete snapshots >90 days old for completed evaluations
  - Add as cron job or cleanup in pruneEvents

- [ ] **A/B testing framework for methodology**
  - Add `eval_variant` column (control, candidate_A, candidate_B)
  - Dashboard view comparing outcome distributions between variants
  - Enables safe prompt/methodology iteration

## Operational Endpoints

- [ ] **Health check endpoint** (`/health`)
  - Report: last cron run age, queue depth, DLQ backlog, latest eval age, rate limit headroom
  - Return 200/503 based on thresholds
  - Usable by external uptime monitors

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue stories matching criteria (domain, date range, model, methodology_hash)
  - Useful when methodology changes and old evals need refresh
  - Rate-limited to prevent queue flooding
