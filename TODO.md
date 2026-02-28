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

- [ ] **Rate limit exhaustion forecasting**
  - Project time-to-exhaustion from rolling 1h token usage window
  - Alert event when projected exhaustion <24h
  - Dashboard headroom widget

- [ ] **Cost attribution per model**
  - Daily cost per model from eval_history token counts + pricing table
  - Dashboard widget: cost/eval by model, daily burn rate
  - *Directly informs Phase 2 pricing tiers*
  - Note: `getCostStats` function already exists (orphaned query — wire it up)

- [ ] **Adaptive daemon parallelism**
  - Real-time backpressure: adjust `--parallel` between batches based on signals
  - Rate limited → halve (min 1); all ok → increment by 1 (up to max cap)
  - >50% failures → decrement; avg claude_ms > 180s → decrement (model under load)
  - Empty queue → reset to initial. ~20 lines in daemon loop.

### Round 3.5 — Triage UX Audit

- [ ] **UX audit findings** — 31 items across navigation, accessibility, visual design, mobile
  - Full plan: `.claude/plans/ux-audit-2026-02-28.md`
  - 5 critical, 9 high, 11 medium, 6 low
  - Key items: sub-page sibling nav, lite-only eval display, touch targets, jargon scaffolding

- [ ] **Semantic color system** — replace 1,400+ hardcoded hex values with CSS variables
  - Heading colors + text-shadows moved to global CSS *(done 2026-02-28)*
  - Remaining: ~1,400 inline `color: #hex` across 31 .astro files → `var(--color-*)` refs
  - **Orange overload** — `#d56500` means paywall gate, lite eval badge, nav accent, and active toggle.
    Resolve: keep orange for brand/nav; paywall → red family; lite badge already outlined (box style)
  - **Green fragmentation** — 3 different greens (`#819500`, `#4ade80`, `#22c55e`) for "positive."
    `--color-green` (#819500) defined in CSS but never used (scores use Tailwind greens)
  - **Purple fragmentation** — 3 shades (`#7d80d1`, `#a78bfa`, `#c084fc`) for related concepts
  - **Unused palette vars** — `--color-green` and `--color-red` defined but score coloring uses
    Tailwind classes instead. Either use the palette vars or drop them.
  - Approach: create semantic CSS classes (`.text-positive`, `.text-negative`, `.text-neutral`,
    `.text-muted`, `.text-emphasis`) and migrate inline styles file by file

### Round 4 — Analytics (runs on existing data, no migrations needed)

- [ ] **Temporal trend analysis** *(Seldon has daily HRCB + rolling avg; gaps below)*
  - [x] **Model channel averages** — HRCB/E/S triple bar per model on `/status/models`. *(done 2026-02-28)*
  - [x] **Eval velocity chart** — stacked bar evals/day (full+light) on `/status`. *(done 2026-02-28)*
  - [ ] **Coverage progression** — daily funnel: no-coverage → light → full → multi-model.
    Needs `daily_coverage_stats` materialized table or query from `stories` + `rater_evals`
  - [ ] **Per-content-type eval mix** — which content types (ED, PO, LP, PR, etc.) are
    getting evaluated vs skipped
  - [ ] **Truncation impact dashboard** — distribution of `content_truncation_pct` across
    models, correlation with score divergence. Data from migration 0040.
  - **Placement:** `/status` (velocity) and `/status/models` (channel averages). Remaining items: `/status/metrics` sub-page or Seldon tabs.

- [ ] **SETL spike alerting**
  - Alert system for sudden SETL spikes across a domain or story cluster

- [ ] **Velocity enhancements**
  - Velocity alerts (stories hitting score threshold)
  - Velocity decay analysis

### Round 5 — Data Expansion

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

### Housekeeping (no urgency)

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
