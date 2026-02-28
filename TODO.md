# TODO

## Security & Open Source Readiness

- [ ] **Revoke live credentials** *(do this now — independently of any GitHub plans)*
  - `site/.dev.vars` contains `ANTHROPIC_API_KEY` (`sk-ant-api03-xhnH...`), a live OpenRouter key
    (`sk-or-v1-e606...`), and `TRIGGER_SECRET`. The Anthropic key was previously in `claude.key`
    (now deleted) and consolidated here. Revoke Anthropic key at console.anthropic.com → API Keys;
    revoke OpenRouter key at openrouter.ai → Keys; then generate new ones and update wrangler secrets.
  - `site/.dev.vars` also contains `TRIGGER_SECRET`.
    Revoke the OpenRouter key at openrouter.ai → Keys. Rotate `TRIGGER_SECRET` by running
    `openssl rand -base64 32` and updating both `site/.dev.vars` and your wrangler secrets.
  - **Verified clean:** `git log --all --full-history` confirms none of these were ever committed.
    Root `.gitignore` covers `*.key` and `.dev.vars`. Safe — but revoke anyway.
  - To rotate TRIGGER_SECRET: `openssl rand -base64 32`, update `TRIGGER_SECRET=` in
    `site/.dev.vars`, then `wrangler secret put TRIGGER_SECRET` for each deployed worker.

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

- [ ] **Eval consistency check for re-evaluations**
  - Compare hcb_weighted_mean across models for same URL
  - Alert if divergence > ±0.25

## User-Facing Features

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side scores, classification, sentiment
  - Section-by-section score differences, E vs S channel divergence

- [ ] **Temporal trend analysis** *(Seldon has daily HRCB + rolling avg + regime change; gaps below)*
  - [ ] **Model mix over time** — stacked bar: which models (Haiku, DeepSeek, Llama 4, Llama 3.3) did evals each day. Data: `rater_evals.evaluated_at` + `eval_model` grouped by `DATE()`. Shows model diversity and free-model adoption.
  - [ ] **Eval velocity chart** — evals/day line chart over 30/90 days (not just a single number on `/status`). Data: `COUNT(*) GROUP BY DATE(evaluated_at)` from `rater_evals`. Overlay light vs full prompt_mode.
  - [ ] **Coverage progression** — daily funnel chart: how no-coverage → light → full → multi-model counts change over time. Needs new `daily_coverage_stats` materialized table or query from `stories` + `rater_evals`. Shows pipeline health trajectory.
  - [ ] **Per-content-type eval mix** — which content types (ED, PO, LP, PR, etc.) are getting evaluated vs skipped. Seldon has per-type HRCB but not eval coverage by type.
  - [ ] **Truncation impact dashboard** — distribution of `content_truncation_pct` across models, correlation with score divergence from non-truncated evals on same story. New data from migration 0040.
  - **Placement**: Enhance existing Seldon page (add tabs/sections) or new `/status/events` sub-page for ops-focused charts. Seldon is editorial/analytical; model mix + velocity are operational.

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
