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

- [x] **Domain-level circuit breaker** *(done)*
  - KV-backed failure tracking per domain (5 consecutive failures → circuit open, 24h TTL auto-reset)
  - Pre-fetch skips circuit-broken domains, logs `fetch_error` event when breaker opens
  - Clears on successful fetch

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

- [x] **Domain reputation card** *(done)*
  - Supplementary signal averages, dominant tone/sentiment, geographic scope tags
  - 7d vs 8-30d trend indicator, propaganda flag density

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

## HN Crawler Expansion

- [x] **Re-evaluation trigger for viral stories** *(done)*
  - Stories ranked top-30 or hn_score >= 300, evaluated >6h ago, with <2 evals
  - Capped at 5/cycle to avoid queue flooding

- [x] **Dead/deleted story cleanup** *(done)*
  - During score refresh, stories returned as dead/deleted by HN API are marked skipped

- [x] **Pre-fetch failure logging** *(done)*
  - Logged as events with domain and error details, feeds into domain circuit breaker

- [ ] **Comment sentiment analysis**
  - We crawl comments (depth 0+1) but don't analyze them
  - Run lightweight sentiment classification on top comments
  - Use comment sentiment as a validation signal for HRCB score
  - Flag stories where comments strongly disagree with HRCB assessment

- [ ] **Best-of feed auto-evaluation**
  - Currently only top 5 pages of topstories get auto-evaluated
  - beststories contains high-quality content that may never reach top 5 pages
  - Add configurable threshold: auto-eval if story is in beststories AND hn_score >= N

- [ ] **Algolia historical backfill**
  - HN Algolia API (`hn.algolia.com/api/v1/search`) allows searching by date/score
  - Backfill high-scoring historical stories (e.g., score >= 500 from past year)
  - One-time or periodic: daily fetch of yesterday's top stories via Algolia

- [ ] **Story velocity tracking**
  - Compute score acceleration from rank snapshots (delta score / delta time)
  - Fast-rising stories may be more interesting to evaluate earlier
  - Factor into eval priority score

- [ ] **User karma-weighted priority**
  - We already crawl user profiles and store karma
  - Factor submitter karma into eval priority (high-karma users' stories tend to be higher quality)
  - Simple: `priority += log10(karma) * 0.1`

- [ ] **Content change detection**
  - Compare R2 content snapshot with fresh fetch for stories evaluated >7d ago
  - If content changed significantly (>30% diff), trigger re-evaluation
  - Run as periodic cron step (e.g., weekly, 20 stories per cycle)

## Operational Endpoints

- [x] **Health check endpoint** (`/health`) *(done)*
  - Returns pipeline vitals: cron age, eval age, queue depth, DLQ backlog, rate limit headroom
  - 200/503 based on thresholds, no auth required

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue stories matching criteria (domain, date range, model, methodology_hash)
  - Useful when methodology changes and old evals need refresh
  - Rate-limited to prevent queue flooding
