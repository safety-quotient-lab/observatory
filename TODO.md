# TODO

Items are organized by execution horizon. Phases 2 and 3 are sequenced
prerequisites for commercialization and GitHub publishing respectively.

Production readiness audit findings (2026-02-27) merged into appropriate
rounds. 30/43 items already fixed; remaining items below.

---

## Phase 1 — Active Engineering
*Ordered by dependency and value.*

### Round 1 — Foundational (done)

- [x] **Eval batch tracking** *(done 2026-02-27)*
- [x] **Story priority scoring** *(done 2026-02-27)*
- [x] **Unified primary model** *(done 2026-02-27)*
  - `model_registry.is_primary` DB flag, single write path, 22+ read queries
    migrated from `scores`/`fair_witness` to `rater_scores`/`rater_witness`

### Round 2 — Hardening
*Production readiness fixes. Merged from audit (2026-02-27). Items marked with audit step ID.*

- [x] **Add try/catch to unguarded DB query functions** *(done 2026-02-27)*
- [x] **Log silent catch blocks** *(done 2026-02-27)*
- [x] **Wrap KV writes in try/catch in consumer-shared.ts** *(done 2026-02-27)*
- [x] **Fix diverged `CONTENT_MAX_CHARS` in content-drift.ts** *(done 2026-02-27)*
- [x] **Cap `getRegionDistribution` LIMIT** *(done 2026-02-27)*
- [x] **Guard Promise.all on users.astro and domains.astro** *(done 2026-02-27)*
- [x] **Replace `SELECT *` with explicit columns** *(done 2026-02-27)*

### Round 3 — Data Integrity

- [x] **Fix S-not-E / E-not-S channel asymmetry in rater_scores** *(done 2026-02-28)*
  - Migration 0049: 2,384 rows with structural-not-null/editorial-null retroactively cleaned;
    hcb_weighted_mean re-derived for 372 stories; 132 all-bad stories reset to pending.
    E-not-S rows (1,900+) are intentional behavior — no fix needed.

### Round 3 — Ops Visibility

- [ ] **Rate limit exhaustion forecasting** *(deferred)*
  - Project time-to-exhaustion from rolling 1h token usage window
  - Alert event when projected exhaustion <24h
  - Dashboard headroom widget

- [ ] **Cost attribution per model** *(deferred)*
  - [x] Anthropic trigger path now writes real token counts *(done 2026-02-28 — `callClaude()` extracts `usage`; consumer-anthropic.ts was already correct)*
  - Historical 278 Anthropic evals have 0 tokens (not backfilled). Workers AI = $0 (CF doesn't expose usage; hardcode).
  - Daily cost per model from rater_evals token counts + pricing table
  - Dashboard widget: cost/eval by model, daily burn rate — rebuild `getCostStats` now that data is reliable
  - *Directly informs Phase 2 pricing tiers*

### Round 3.5 — Triage UX Audit

- [x] **UX audit findings** — 29/31 done *(2026-02-28)*
  - Full plan: `.claude/plans/ux-audit-2026-02-28.md`
  - Deferred (2): NAV-07 (back-to-top), NAV-08 (Phase 2 FTS)

- [ ] **Semantic color system — per-file migration**
  - Foundation done *(2026-02-28)*: 30+ CSS vars, 9 badge classes, 6 text classes, paywall→red, unused vars removed
  - Remaining: ~1,395 inline `color: #hex` across 48 .astro files → `var(--color-*)` / utility class refs
  - Top 10 files = 82% of instances: about (242), item/[id] (170), status/models (152), signals (114), factions (107), rights/observatory (89), status (84), users (70), status/events (70), dynamics (53)
  - **Assigned to a separate agent** — do not interleave with feature work

### Round 4 — Analytics (runs on existing data, no migrations needed)

- [ ] **Temporal trend analysis** *(Seldon has daily HRCB + rolling avg; gaps below)*
  - [x] **Model channel averages** — HRCB/E/S triple bar per model on `/status/models`. *(done 2026-02-28)*
  - [x] **Eval velocity chart** — stacked bar evals/day (full+lite) on `/status`. *(done 2026-02-28)*
  - [ ] **Coverage progression** — daily funnel: no-coverage → light → full → multi-model. On `/status/models`.
    Needs `daily_coverage_stats` materialized table or live query from `stories` + `rater_evals`
  - [ ] **Per-content-type eval mix** — which content types (ED, PO, LP, PR, etc.) are
    getting evaluated vs skipped. On `/status/models`.
  - [ ] **Truncation impact dashboard** — distribution of `content_truncation_pct` across
    models, correlation with score divergence. Data from migration 0040. On `/status/models`.

- [ ] **Cost attribution widget** — cost/eval by model + daily burn rate on `/status/models`
  - Token count data reliable since 2026-02-28. Needs pricing table (Anthropic/OpenRouter rates hardcoded).
  - Workers AI = $0 (CF doesn't expose usage). Rate limit forecasting deferred to Phase 2.

- [ ] **SETL spike alerting** — emit `event_type='setl_spike'` when domain avg |SETL| crosses threshold.
  Visible on `/status/events`. No new UI.

- [ ] **Velocity enhancements**
  - Velocity alerts (stories hitting score threshold)
  - Velocity decay analysis

### Round 4.5 — Search + Longitudinal

- [ ] **Passthrough FTS** — Algolia-backed search with mirror + eval integration
  - UI: nav "search" link → `/search?q=...` page (HN-style: simple input, results below)
  - Scope: stories (Algolia) + domains + users (D1)
  - Results: all hits — evaluated with HRCB scores, unevaluated with badges — plus filter controls
  - **Eager consumer**: auto-pulls stories matching `(score ≥100 AND age ≤7d) OR (score ≤10 AND comments ≥5 AND age ≤12h)` + readable URL required. The second branch is the **sleeper detector** — a pluggable `SLEEPER_RULES` array (each rule: `{ maxScore, minComments, maxAgeHours, label }`) so rules can be added/removed without code restructuring.
  - **Play button** (►): donor-only (same 7-day donation cookie as homepage/stories page). Non-donors see locked button.
  - Donation cookie check: `request.headers.get('cookie')` includes `donated=1` — same as existing support page bypass

- [ ] **Longitudinal item page** — dual sparkline + tightened audit trail
  - Dual mini-chart on `/item/[id]`: HN score trajectory (area/line from `story_snapshots`) + HRCB dots (from `eval_history`) on shared time axis. Show only when ≥2 eval_history entries OR ≥5 story_snapshots.
  - Audit trail: type filter chips (eval / pipeline / content drift), model filter dropdown, newest/oldest sort toggle

### Round 5 — Data Expansion

- [ ] **Enhanced comments** *(deep dive before Lobsters)*
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (lite prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

- [ ] **Add Lobsters (lobste.rs) as a data source** *(after comments)*
  - Free JSON API, no auth: `/hottest.json`, `/newest.json`, `/active.json`
  - Need: `source` column on stories, cron extension, top-N auto-eval logic
  - *Migration first — enables source-aware analytics downstream*

### Round 6 — User-Facing Features

- [ ] **Article deep dive enhancements** (`/article/[n]`)
  - Stddev distribution, evidence strength breakdown
  - Top 3 positive/negative stories per article (wire up orphaned
    `getTopPositiveStories`/`getTopNegativeStories` from db-stories.ts)
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

### Round 7 — Platform

- [ ] **A/B testing framework for methodology**
  - `eval_variant` column, dashboard comparing outcome distributions across variants

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

### Round 8 — Infrastructure Optimization

- [ ] **Prerender static pages** — add `export const prerender = true` to `/about`, `/data` (need to refactor `Astro.request.url` → `Astro.site` first). `/support` already done.
- [ ] **Cloudflare Analytics Engine** — write data points per eval in consumers (model, score, latency, prompt_mode). Replace D1 scans (`getDailyEvalVelocity`, `getEvalLatencyStats`) with AE queries. Free: 100K writes/day.
- [ ] **D1 Read Replication** — enable via dashboard (free). Reduces read latency globally. Add Sessions API bookmarks for read-after-write pages.
- [ ] **Investigate Pages → Workers migration** — get 30s CPU (vs 10ms free Pages). Would eliminate KV pre-computation workaround. Needs `compat_date 2024-09-23` testing.

### Housekeeping (no urgency)

- [ ] **Remaining `i += 100` literals in hn-bot.ts** *(code quality, CQ-02 partial)*
  - `D1_BATCH_SIZE = 100` exported from `db-utils.ts` but 10+ manual `i += 100` chunking loops in `hn-bot.ts` and `cron.ts` still hardcode 100
  - Replace with `D1_BATCH_SIZE` import where not already using `safeBatch()`

- [ ] **Materialize `getUserIntelligence`** *(audit step 14, LOW)*
  - Currently a live CTE scan over full stories table
  - Create `user_aggregates` materialized table (like `domain_aggregates`)
  - Update on eval write, query from materialized data

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
- [x] **Add fork-setup comments to all wrangler configs** *(done 2026-02-27)*

- [ ] **Decide on `LICENSE`** — TBD (AGPL-3.0 was considered; not yet decided)

- [ ] **Write `README.md`** — architecture overview, what it does, screenshots, local dev setup

- [ ] **`IDEAS.md` publish decision** — keeping for now; revisit when license is decided

- [ ] **Revoke/rotate live credentials** — do immediately before `git push` to public repo
  - `ANTHROPIC_API_KEY` — revoke at console.anthropic.com → API Keys, re-issue, `wrangler secret put`
  - `OPENROUTER_API_KEY` — revoke at openrouter.ai → Keys, re-issue, `wrangler secret put`
  - `TRIGGER_SECRET` — rotate: `openssl rand -base64 32`, update `site/.dev.vars`, `wrangler secret put`
  - **Status:** never committed (`git log` verified); `.gitignore` covers `*.key` + `.dev.vars`
