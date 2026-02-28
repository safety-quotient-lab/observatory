# TODO

Items are organized by execution horizon and track. Phases 1 and 2 are
sequenced prerequisites for GitHub publishing and commercialization respectively.

---

## Immediate

- [ ] **Revoke live credentials** *(independent of any GitHub plans)*
  - `ANTHROPIC_API_KEY` in `site/.dev.vars` — revoke at console.anthropic.com → API Keys,
    generate new one, run `wrangler secret put ANTHROPIC_API_KEY` on each worker
  - `OPENROUTER_API_KEY` in `site/.dev.vars` — revoke at openrouter.ai → Keys, same process
  - `TRIGGER_SECRET` in `site/.dev.vars` — rotate: `openssl rand -base64 32`, update
    `site/.dev.vars`, run `wrangler secret put TRIGGER_SECRET` on each worker
  - **Status:** never committed (`git log` verified); `.gitignore` covers `*.key` + `.dev.vars`

- [ ] **Decide on `site/src/pages/system/events.astro`** — untracked file from a previous
  session. Finish and commit, or `git rm` it.

- [ ] **Commit pending `TODO.md` temporal trends expansion** — minor unstaged change already
  in working tree from a previous session (pre-dates this restructure; now incorporated here).

---

## Phase 1 — Open Source Prep
*Prerequisite for creating the public GitHub repo. ~2–4 weeks of part-time work.*

- [ ] **Replace real Cloudflare resource IDs** in committed code
  - `site/scripts/test-workers-ai.sh:9` — hardcoded account ID `82cd6d38...`
    → replace with `${CLOUDFLARE_ACCOUNT_ID:-<your-account-id>}`
  - All 7 `wrangler*.toml` files — D1 database ID `8d46e768...`
    → replace with `# replace with your D1 database ID`
  - 5 `wrangler*.toml` files — KV namespace ID `ffe31e8b...`
    → replace with `# replace with your KV namespace ID`

- [ ] **Remove personal eval sample files** from repo root
  - `git rm` or move to `examples/`: `berthub-eu-us-clouds.*`,
    `economictimes-shopping-list-psychology.*`, `hn-viking-dna-study.*`,
    `kashifshah-net.*` (x3), `nytimes-evolution-vertebrate-eye.*`,
    `pen-org-mongolian-language.*`, `top-100-sfw-udhr-evaluation.txt`,
    `top-100-websites-2026-*.txt`

- [ ] **Add `LICENSE`** — AGPL-3.0 for code (see `COMMERCIALIZATION.md` for rationale)

- [ ] **Write `README.md`** — architecture overview, what it does, screenshots, local dev setup

- [ ] **Remove or relocate `IDEAS.md`** — contains detailed product roadmap; optional but
  recommended before publishing (per Opus's analysis)

---

## Phase 2 — Commercialization Gate
*Turns the project from hobby into product. ~1–2 months. Do before Phase 3 (full publish).*

- [ ] **API key system** — the commercial gate
  - D1 table: `api_keys` (key_hash, tier, quota_per_hour, owner, created_at, active)
  - Key issuance endpoint (email-based or OAuth)
  - Replace IP-based KV rate limit on `/api/v1/` with key-based quota tracking
  - A `/api-keys` management UI page

- [ ] **Stripe integration**
  - Webhook handler updates `api_keys.tier` in D1
  - Tiers: free (IP-rate-limited) → research → pro → enterprise (manual)
  - `/pricing` page

- [ ] **Bulk export implementation** *(Phase 39B)*
  - CSV/JSONL to R2 daily snapshot (R2 bound to cron worker)
  - Implement the 501 stubs: `/api/v1/export/stories.csv`, `.jsonl`,
    `domains.csv`, `rater-evals.jsonl`

- [ ] **Full-text search endpoint** *(Phase 39B)*
  - `/api/v1/search` via FTS5 virtual table on D1

- [ ] **Dataset license decision**
  - CC BY-NC-SA 4.0 recommended (non-commercial + share-alike)
  - Publish to `/data` page once decided

---

## Pipeline & Data Quality

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h token usage window
  - Alert event when projected exhaustion <24h
  - Dashboard headroom widget

- [ ] **Eval consistency check for re-evaluations**
  - Compare hcb_weighted_mean across models for same URL
  - Alert if divergence > ±0.25

- [ ] **Cost attribution per model**
  - Daily cost per model from eval_history token counts + pricing table
  - Dashboard widget: cost/eval by model, daily burn rate

- [ ] **Eval batch tracking**
  - `eval_batch_id` to link related evals from same cron cycle
  - Useful for isolating regressions to a specific run

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

---

## Data Sources & Crawling

- [ ] **Add Lobsters (lobste.rs) as a data source**
  - Free JSON API, no auth: `/hottest.json`, `/newest.json`, `/active.json`
  - Need: `source` column on stories, cron extension, top-N auto-eval logic

- [ ] **Story priority scoring** *(consolidates 3 related items)*
  - Composite score: HN score + comment count + time-decay + feed membership
    + `log10(submitter_karma) * 0.1` + score acceleration from rank snapshots
  - `eval_priority_score` computed by cron, factored into eval dispatch order
  - Prerequisite for meaningful eval queue prioritization

- [ ] **Enhanced comments** *(consolidates user-facing + crawler items)*
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (light prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

---

## Analytics & Ops Dashboard

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
  - **Placement:** Enhance Seldon page (add tabs) or new `/system/metrics` sub-page.
    Seldon is editorial/analytical; model mix + velocity are operational.

- [ ] **SETL spike alerting**
  - Alert system for sudden SETL spikes across a domain or story cluster

- [ ] **Velocity enhancements**
  - Velocity alerts (stories hitting score threshold)
  - Velocity decay analysis

---

## User-Facing Features

- [ ] **Story comparison view** (`/compare/[id1]/[id2]`)
  - Side-by-side scores, classification, sentiment
  - Section-by-section score differences, E vs S channel divergence

- [ ] **Article deep dive enhancements** (`/article/[n]`)
  - Stddev distribution, evidence strength breakdown
  - Top 3 positive/negative stories per article
  - Directionality marker distribution, theme tag word cloud

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

---

## Platform & Architecture

- [ ] **Comprehensive data model audit** *(big effort — needs separate plan)*
  - Inventory all computed/stored fields — displayed, internal-only, or orphaned
  - Map entity relationships: stories ↔ users ↔ domains ↔ articles ↔ feeds
    ↔ comments ↔ evals ↔ events
  - Identify missing vocabulary — concepts we measure but don't name/surface
  - Taxonomy gaps — dimensions with no UI representation
  - Network analysis gaps — user↔domain posting patterns, article co-occurrence
  - **Output:** `.claude/plans/data-model-audit-YYYY-MM-DD.md`

- [ ] **A/B testing framework for methodology**
  - `eval_variant` column, dashboard comparing outcome distributions across variants
