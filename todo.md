# TODO

## Active / In Progress

- [x] **Fix 5 stuck 2-eval domains** *(done)* — archive.org (imported hn_id 19627885 via Algolia), hackaday.com, paultendo.github.io, pnas.org, www.xda-developers.com — all now have 3 done stories, qualifying for factions.
- [x] **Commit new scripts + cron changes** *(done)* — backfill-eval.sh, eval-to-sql.py, system-prompt.txt, cron.ts (/recalc), consumer.ts, compute-aggregates.ts, db.ts, shared-eval.ts
- [x] **Factor out hn-bot** *(done)* — extracted HN crawling/fetching/story mgmt from cron.ts into `src/lib/hn-bot.ts` (1114 lines). cron.ts is now a thin orchestrator.
- [x] **Unified CLI eval tool** *(done)* — `scripts/hn-hrcb-evaluate` replaces backfill-eval.sh + backfill-targeted.sh with flags: `--pending`, `--failed`, `--domain`, `--min-score`, `--dry-run`, `--recalc`, `--status`, positional IDs

- [x] **Content gate in cron pre-fetch** *(done)* — `hn-bot.ts` runs `classifyContent()` + `hasReadableText()` on raw HTML before queueing. Gated stories marked skipped with structured `gate_category`/`gate_confidence`. Consumer retains gate as safety net.
- [x] **Backfill gate_category for existing stories** *(done)* — Swept 18 skipped stories (score >= 50) back to pending; they'll flow through cron pre-fetch content gate naturally. Remaining ~1,738 are low-score (<50) stories — not worth re-evaluating.

## Data Model / Taxonomy Evaluation

- [ ] **Comprehensive data model audit** *(big effort — needs separate plan)*
  - **Trigger:** `avg_poster_karma` is computed and stored but not displayed anywhere meaningful. What else is being collected but unused? What relationships exist in the data that we're not surfacing?
  - **Scope:**
    1. **Inventory all computed/stored fields** — walk every D1 table, every computed aggregate, every crawled attribute. List which are displayed, which are only used internally, and which are completely orphaned.
    2. **Map entity relationships** — stories ↔ users ↔ domains ↔ articles ↔ feeds ↔ comments ↔ evals ↔ events. Document which joins exist vs which are missing (e.g., user→domain affinity, comment sentiment→story score correlation).
    3. **Identify missing vocabulary** — concepts we measure but don't name/surface (e.g., "user reliability" from karma+eval consistency, "domain editorial trajectory" from time-series HRCB).
    4. **Taxonomy gaps** — what dimensions of the data model have no UI representation? What pages would be needed to surface them?
    5. **Unused signals** — `avg_poster_karma`, supplementary signals on user/domain profiles, comment depth stats, feed membership patterns — where should these appear?
    6. **Network analysis gaps** — user↔domain posting patterns, article co-occurrence in stories, cross-feed correlation
  - **Output:** A `.claude/plans/data-model-audit-YYYY-MM-DD.md` with findings, gap analysis, and prioritized UI/schema recommendations
  - **Prerequisite:** Needs full schema read + all page reads + entity query inventory

## Data Sources

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth required: `/hottest.json`, `/newest.json`, `/active.json`
  - Fields: `short_id`, `title`, `url`, `score`, `comment_count`, `tags`, `comments_url`, `created_at`, `submitter_user`
  - Very similar data shape to HN — should map cleanly to existing `stories` schema
  - Need to: add `source` column to stories table, extend cron worker to crawl Lobsters feeds, apply same top-N auto-eval logic
  - Be polite with request rate (no documented limits, but ~1 req/min should be safe)

## Pipeline Resilience

- [x] **DLQ auto-replay with exponential backoff** *(done)*
  - First DLQ entry: auto-replay after 1h
  - Second DLQ entry: auto-replay after 6h
  - Third DLQ entry: mark `manual_review_required`, stop auto-replay
  - dlq-consumer.ts computes auto_replay_at on INSERT; cron.ts replays on schedule (migration 0027)

- [x] **Domain-level circuit breaker** *(done)*
  - KV-backed failure tracking per domain (5 consecutive failures → circuit open, 24h TTL auto-reset)
  - Pre-fetch skips circuit-broken domains, logs `fetch_error` event when breaker opens
  - Clears on successful fetch

- [x] **Configurable rate limit max backoff** *(done)*
  - `checkRateLimitCapacity()` takes optional `maxBackoffSec` param (default 120)
  - `RATE_LIMIT_MAX_BACKOFF_SECONDS` env var wired in consumer-anthropic + openrouter configs

## Monitoring & Alerting

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h window of eval_history token usage
  - Log `alert_level: critical` event when projected exhaustion <24h
  - Show forecast on dashboard headroom widget

- [x] **Evaluation latency percentiles** *(done — backend)*
  - `getEvalLatencyStats()` in db-analytics.ts computes P50/P95/P99 per model (JS NTILE)
  - UI card pending (system.astro)

- [x] **DLQ trend tracking** *(done — backend)*
  - `getDlqTrend()` returns 14-day daily counts + backlog_growing flag
  - UI card pending (system.astro)

- [x] **Self-throttle impact analysis** *(done — backend)*
  - `getSelfThrottleImpact()` aggregates `delay_seconds` from self_throttle events by model
  - UI card pending (system.astro)

## Data Quality

- [x] **Signal completeness matrix** *(done — backend)*
  - `getSignalCompleteness()` in db-analytics.ts; flags models <80% on any signal
  - UI card pending (system.astro)

- [ ] **Content type classification validation**
  - Post-eval check: if content_type=PO but 0 structural evidence, flag as likely misclassification
  - Track misclassification rate per model over time

- [x] **DCP staleness alerting** *(done)*
  - Hourly cron step logs `dcp_stale` event (deduplicated per domain per 24h) for domains with >20 done stories and DCP age >30 days

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

- [x] **Signal Space visualization** *(meerkat phase 39B — done)* — 2D PCA scatter + 3D Three.js orbit on /factions (`site/src/components/SignalSpace.astro`). Server-side PCA from 8D z-vectors, CDN Three.js lazy-loaded, cluster ellipses, hover/click detail panels.

- [x] **Evaluator Trust Index** *(meerkat phase 37B — done)* — `model_trust_snapshots` table (migration 0031), daily cron computation (cal×0.40 + consensus×0.35 + parse×0.25), 14-day sparklines on /models. Auto-flags models with trust <0.3 for 7 consecutive days.

- [x] **Internet Archive integration** *(meerkat phase 39C — done)* — Fire-and-forget Wayback preservation after primary eval (stores archive_url + archive_used columns, migration 0032). Wayback content fallback in prepareContent() when live content is unusable (error, gated, or unreadable).

- [ ] **Model soft-delete (DB-level flag)** *(meerkat phase 34)*
  - New `model_registry` table in D1 with `enabled`, `deleted_at`, `disabled_reason` columns
  - Seed from `MODEL_REGISTRY` in models.ts; `getEnabledModels(db)` replaces hardcoded array
  - Disable/re-enable models via D1 query without code deploy
  - Enables model personality profiles (bias_direction, calibration accuracy, topic strengths/weaknesses)

- [ ] **HN-compatible + REST API** *(meerkat phase 35)*
  - New `functions/api-public.ts` worker + `wrangler.api-public.toml`
  - HN-compatible endpoints: `GET /v0/item/{id}.json`, `/v0/topstories.json`, `/v0/beststories.json`
  - Extended endpoints: `GET /api/stories`, `/api/story/{id}`, `/api/domain/{domain}`, `/api/domains`, `/api/search`
  - Rate-limited by IP; optional API key in KV; `Cache-Control: public, max-age=60` on list endpoints

- [ ] **Structured Knowledge Base** *(meerkat phase 39A — requires phase 35)*
  - JSON-LD with Schema.org annotations on all eval records
  - Export endpoints via Phase 35 API: `GET /api/domain/{domain}/profile.json`, `GET /api/export/dataset.csv`
  - Bulk dataset CSV export as daily R2 snapshot
  - Citation format: "HRCB Score for {domain}, evaluated {date}, schema v3.x. Source: hn-hrcb.pages.dev/domain/{domain}"
  - Domain profile versioning: version counter + changelog per domain

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

- [x] **R2 content snapshot retention policy** *(done)*
  - Weekly cron step (guarded by KV flag `r2:cleanup:last_run`) deletes objects >90 days old for done stories (max 200/cycle); logs `r2_cleanup`

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

- [x] **Best-of feed auto-evaluation** *(done)*
  - Top 30 `bestIds` already included in `autoEvalIds` in hn-bot.ts alongside top 7 pages of topstories

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
