# TODO

## Data Model / Taxonomy

- [ ] **Comprehensive data model audit** *(big effort — needs separate plan)*
  - Inventory all computed/stored fields — which are displayed, internal-only, or orphaned
  - Map entity relationships — stories ↔ users ↔ domains ↔ articles ↔ feeds ↔ comments ↔ evals ↔ events
  - Identify missing vocabulary — concepts we measure but don't name/surface
  - Taxonomy gaps — what dimensions have no UI representation?
  - Network analysis gaps — user↔domain posting patterns, article co-occurrence, cross-feed correlation
  - **Output:** `.claude/plans/data-model-audit-YYYY-MM-DD.md`

## Data Sources

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth: `/hottest.json`, `/newest.json`, `/active.json`
  - Need: `source` column on stories, cron extension, top-N auto-eval logic

## Monitoring & Alerting

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h token usage window
  - Alert event when projected exhaustion <24h
  - Dashboard headroom widget

## Data Quality

- [ ] **Content type classification validation**
  - Flag content_type=PO with 0 structural evidence as likely misclassification
  - Track misclassification rate per model over time

- [ ] **Eval consistency check for re-evaluations**
  - Compare hcb_weighted_mean across models for same URL
  - Alert if divergence > ±0.25

## User-Facing Features

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side scores, classification, sentiment
  - Section-by-section score differences, E vs S channel divergence

- [ ] **Story audit trail in UI**
  - Full event chain on `/item/[id]` (created → queued → evaluating → done)
  - Content fetch latency, token usage, model used

- [ ] **Temporal trend analysis**
  - Rolling 7-day avg hcb_weighted_mean line chart
  - Eval velocity (stories/day), model mix over time (stacked bar)

- [ ] **Article deep dive enhancements** (`/article/[n]`)
  - Stddev distribution, evidence strength breakdown
  - Top 3 positive/negative stories per article
  - Directionality marker distribution, theme tag word cloud

- [ ] **Enhanced comments**
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions
  - Comment score tracking over time
  - Comment-level HRCB divergence scoring
  - Aggregate comment sentiment vs story HRCB comparison

- [ ] **Rights network enhancements**
  - Cluster detection (community finding algorithm)
  - Temporal network evolution (how correlations shift)

- [ ] **Domain factions enhancements**
  - Faction drift tracking over time
  - Force-directed faction network visualization

- [ ] **Seldon dashboard enhancements**
  - Per-article daily trends
  - Confidence interval bands
  - Real-world event annotation layer

- [ ] **SETL spike alerting**
  - Alert system for sudden SETL spikes

- [ ] **Velocity enhancements**
  - Velocity alerts (stories hitting threshold)
  - Velocity decay analysis

## Schema & Architecture

- [x] **Model soft-delete (DB-level flag)** *(done 2026-02-27 — Phase 34)*
  - `model_registry` table (migration 0037), `getEnabledModelsFromDb(db)` in models.ts
  - Toggle via `wrangler d1 execute hrcb-db --remote --command "UPDATE model_registry SET enabled=0 WHERE model_id='...'"` — no deploy needed

- [ ] **HN-compatible REST API extensions**
  - REST endpoints done: `/api/v1/stories`, `/api/v1/story/[id]`, `/api/v1/domains`, `/api/v1/domain/[domain]` *(Phase 35, 2026-02-27)*
  - Still TODO: HN-compatible `/v0/item/{id}.json`, `/v0/topstories.json`, `/api/search`

- [ ] **Structured Knowledge Base** *(requires REST API)*
  - JSON-LD with Schema.org annotations
  - Export endpoints, bulk CSV as daily R2 snapshot
  - Domain profile versioning

- [ ] **Cost attribution per model**
  - Daily cost per model from eval_history token counts + pricing
  - Dashboard widget: cost/eval by model, daily burn rate

- [ ] **Eval batch tracking**
  - `eval_batch_id` to link related evals from same cron cycle

- [ ] **Story priority scoring**
  - Composite of HN score, comment count, time-decay, feed membership
  - `eval_priority_score` computed by cron

- [ ] **A/B testing framework for methodology**
  - `eval_variant` column, dashboard comparing outcome distributions

## HN Crawler Expansion

- [ ] **Comment-level HRCB divergence**
  - Lightweight sentiment on top comments (light prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart
  - Prerequisite: deep comment crawling (recursive depth 2+) from Enhanced Comments TODO

- [ ] **Algolia historical backfill**
  - Backfill high-scoring historical stories (score >= 500 from past year)
  - Periodic: daily fetch of yesterday's top stories

- [ ] **Story velocity tracking**
  - Score acceleration from rank snapshots
  - Factor into eval priority score

- [ ] **User karma-weighted priority**
  - Factor submitter karma into eval priority
  - `priority += log10(karma) * 0.1`

- [ ] **Content change detection**
  - Compare R2 snapshot with fresh fetch for stories >7d old
  - Re-evaluate if >30% diff (weekly cron step, 20 stories/cycle)

## Operational Endpoints

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding
