# TODO

Items are organized by execution horizon. Phase 1 is fully unblocked.
Phases 2 and 3 are sequenced prerequisites for commercialization and
GitHub publishing respectively.

---

## Phase 1 — Active Engineering
*Fully unblocked. Ordered by dependency and value.*

### Round 1 — Foundational (unlock the rest)

- [x] **Eval batch tracking** *(done 2026-02-27)*
  - `eval_batch_id` to link related evals from same cron cycle
  - Useful for isolating regressions to a specific run
  - *Small migration + cron change — cheap to add now*

- [x] **Story priority scoring** *(done 2026-02-27)*
  - Composite score: HN score + comment count + time-decay + feed membership
    + `log10(submitter_karma) * 0.1` + score acceleration from rank snapshots
  - `eval_priority_score` computed by cron, factored into eval dispatch order
  - *Prerequisite for meaningful eval queue prioritization*

### Round 2 — Ops Visibility

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h token usage window
  - Alert event when projected exhaustion <24h
  - Dashboard headroom widget

- [ ] **Cost attribution per model**
  - Daily cost per model from eval_history token counts + pricing table
  - Dashboard widget: cost/eval by model, daily burn rate
  - *Directly informs Phase 2 pricing tiers*

### Round 3 — Analytics (runs on existing data, no migrations needed)

- [ ] **Temporal trend analysis** *(Seldon has daily HRCB + rolling avg; gaps below)*
  - [ ] **Model mix over time** — stacked bar: which models did evals each day.
    Data: `rater_evals.evaluated_at` + `eval_model` grouped by `DATE()`
  - [ ] **Eval velocity chart** — evals/day line chart over 30/90 days.
    Data: `COUNT(*) GROUP BY DATE(evaluated_at)`, overlay light vs full prompt_mode
  - [ ] **Coverage progression** — daily funnel: no-coverage → light → full → multi-model.
    Needs `daily_coverage_stats` materialized table or query from `stories` + `rater_evals`
  - [ ] **Per-content-type eval mix** — which content types (ED, PO, LP, PR, etc.) are
    getting evaluated vs skipped
  - [ ] **Truncation impact dashboard** — distribution of `content_truncation_pct` across
    models, correlation with score divergence. Data from migration 0040.
  - **Placement:** Enhance Seldon page (add tabs) or new `/status/metrics` sub-page.

- [ ] **Eval consistency check for re-evaluations**
  - Compare hcb_weighted_mean across models for same URL
  - Alert if divergence > ±0.25

- [ ] **SETL spike alerting**
  - Alert system for sudden SETL spikes across a domain or story cluster

- [ ] **Velocity enhancements**
  - Velocity alerts (stories hitting score threshold)
  - Velocity decay analysis

### Round 4 — Data Expansion

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth: `/hottest.json`, `/newest.json`, `/active.json`
  - Need: `source` column on stories, cron extension, top-N auto-eval logic
  - *Migration first — enables source-aware analytics downstream*

- [ ] **Enhanced comments** *(consolidates user-facing + crawler items)*
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (light prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

### Round 5 — User-Facing Features

- [ ] **Article deep dive enhancements** (`/article/[n]`)
  - Stddev distribution, evidence strength breakdown
  - Top 3 positive/negative stories per article
  - Directionality marker distribution, theme tag word cloud

- [ ] **Domain factions enhancements**
  - Faction drift tracking over time
  - Force-directed faction network visualization

- [ ] **Seldon dashboard enhancements**
  - Per-article daily trends
  - Confidence interval bands
  - Real-world event annotation layer

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side scores, classification, sentiment
  - Section-by-section score differences, E vs S channel divergence

- [ ] **Rights network enhancements**
  - Cluster detection (community finding algorithm)
  - Temporal network evolution (how correlations shift)

### Round 6 — Platform

- [ ] **A/B testing framework for methodology**
  - `eval_variant` column, dashboard comparing outcome distributions across variants

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

---

## Phase 2 — Commercialization Gate
*Mostly unblocked. Build before publishing. Stripe + dataset license wait on Phase 3.*

- [ ] **API key system** — the commercial gate
  - D1 table: `api_keys` (key_hash, tier, quota_per_hour, owner, created_at, active)
  - Key issuance endpoint (email-based or OAuth)
  - Replace IP-based KV rate limit on `/api/v1/` with key-based quota tracking
  - A `/api-keys` management UI page

- [ ] **Stripe integration** *(needs license + publishing strategy first)*
  - Webhook handler updates `api_keys.tier` in D1
  - Tiers: free (IP-rate-limited) → research → pro → enterprise (manual)
  - `/pricing` page

- [ ] **Bulk export implementation**
  - CSV/JSONL to R2 daily snapshot (R2 bound to cron worker)
  - Implement the 501 stubs: `/api/v1/export/stories.csv`, `.jsonl`,
    `domains.csv`, `rater-evals.jsonl`

- [ ] **Full-text search endpoint**
  - `/api/v1/search` via FTS5 virtual table on D1

- [ ] **Dataset license decision** *(CC BY-NC-SA 4.0 recommended; publish to `/data` once decided)*

---

## Phase 3 — Open Source Prep
*Blocked on license decision. Do before creating the public GitHub repo.*

- [x] **Remove personal eval sample files** from repo root *(done 2026-02-27)*

- [ ] **Scrub Cloudflare resource IDs** from `wrangler.toml` — do as last step before public push (reverted premature scrub that broke every deploy cycle)

- [ ] **Decide on `LICENSE`** — TBD (AGPL-3.0 was considered; not yet decided)

- [ ] **Write `README.md`** — architecture overview, what it does, screenshots, local dev setup

- [ ] **`IDEAS.md` publish decision** — keeping for now; revisit when license is decided

- [ ] **Revoke/rotate live credentials** — do immediately before `git push` to public repo
  - `ANTHROPIC_API_KEY` — revoke at console.anthropic.com → API Keys, re-issue, `wrangler secret put`
  - `OPENROUTER_API_KEY` — revoke at openrouter.ai → Keys, re-issue, `wrangler secret put`
  - `TRIGGER_SECRET` — rotate: `openssl rand -base64 32`, update `site/.dev.vars`, `wrangler secret put`
  - **Status:** never committed (`git log` verified); `.gitignore` covers `*.key` + `.dev.vars`
