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

- [x] **Content type classification validation** *(done 2026-02-27)*
  - `getContentTypeValidation`, `getContentTypeDisagreement`, `getMisclassificationSummary` in db-analytics.ts
  - Content Type Validation card + breakdown table + cross-model disagreement in /system Measurement Integrity

- [ ] **Eval consistency check for re-evaluations**
  - Compare hcb_weighted_mean across models for same URL
  - Alert if divergence > ±0.25

## User-Facing Features

- [x] **Story audit trail in UI** *(done 2026-02-27)*
  - `getEvalHistoryForStory` + unified timeline on `/item/[id]` merging events + eval_history

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side scores, classification, sentiment
  - Section-by-section score differences, E vs S channel divergence

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

- [x] **HN-compatible REST API extensions** *(done 2026-02-27)*
  - `/api/v1/` REST: stories, story/[id], domains, domain/[domain] *(Phase 35)*
  - `/api/v0/` HN Firebase-compatible: topstories.json, beststories.json, newstories.json, item/[id].json (with `hcb` extension)
  - Still TODO: `/api/v1/search` full-text search endpoint

- [ ] **Structured Knowledge Base** *(Phase 39A — partially done 2026-02-27)*
  - [x] JSON-LD on all major pages (index, item, article, domain, domains, about, sources)
  - [x] Domain profile versioning — `domain_profile_snapshots` table (migration 0039), daily cron snapshot, `/api/v1/domain/[domain]/history` endpoint
  - [x] `/data` stub page with live API table + greyed-out export table
  - [x] Export endpoint stubs returning 501 (`/api/v1/export/stories.csv`, `.jsonl`, `domains.csv`, `rater-evals.jsonl`)
  - [ ] License decision pending — Opus recommends CC BY-NC-SA 4.0 (non-commercial + share-alike); needs user confirmation before publishing to `/data`
  - [ ] Full-text search endpoint (`/api/v1/search` via FTS5 virtual table) — Phase 39B
  - [ ] Bulk export implementation (CSV/JSONL to R2 daily snapshot) — R2 only bound to cron worker, not Pages site

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

- [x] **Algolia historical backfill** *(done 2026-02-27)*
  - `?sweep=algolia_backfill&min_score=500&days_back=365` endpoint in cron.ts
  - Calls `searchAlgolia` + `insertAlgoliaHits` from coverage-crawl.ts

- [x] **Content change detection** *(done 2026-02-27)*
  - `content_hash` + `content_last_fetched` columns (migration 0038)
  - `checkContentDrift` in content-drift.ts, `?sweep=content_drift` endpoint

- [ ] **Story velocity tracking**
  - Score acceleration from rank snapshots
  - Factor into eval priority score

- [ ] **User karma-weighted priority**
  - Factor submitter karma into eval priority
  - `priority += log10(karma) * 0.1`

## Operational Endpoints

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding
