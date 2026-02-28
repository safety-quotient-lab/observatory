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

### Round 3.5 — Triage UX Audit

- [x] **UX audit findings** — 29/31 done *(2026-02-28)*
  - Full plan: `.claude/plans/archive/ux-audit-2026-02-28.md`
  - Deferred (2): NAV-07 (back-to-top), NAV-08 (Phase 2 FTS)

- [ ] **Semantic color system — per-file migration**
  - Foundation done *(2026-02-28)*: 30+ CSS vars, 9 badge classes, 6 text classes, paywall→red, unused vars removed
  - Full plan: `.claude/plans/semantic-colors-2026-02-28.md`
  - ~1,489 inline `color: #hex` across 32 files → `var(--color-*)`. 97% mechanical, 2.5% manual review.
  - 7 new CSS vars needed (Phase 0). Two substitutions (`#5b7279` + `#98a8a8`) cover 77% of all instances.
  - 4 batches: tiny (9 files) → medium (9) → mid (6) → heavy (8 files, top 10)
  - **Assigned to a separate agent** — do not interleave with feature work

### Round 4 — Analytics *(done 2026-02-28)*

- [x] **Model channel averages** — HRCB/E/S triple bar per model on `/status/models`.
- [x] **Eval velocity chart** — stacked bar evals/day (full+lite) on `/status`.
- [x] **Coverage progression** — 30-day stacked bar (full/lite) on `/status/models`. Live query, no materialization.
- [x] **Per-content-type eval mix** — stacked bar per content_type in Measurement Integrity on `/status/models`.
- [x] **Truncation impact** — per-model score bias (truncated vs full) in Measurement Integrity on `/status/models`.
- [x] **Cost attribution widget** — estimated API spend (7d/30d) per model on `/status/models`. MODEL_PRICING hardcoded.
- [x] **SETL spike alerting** — `sweep=setl_spikes` emits `setl_spike` warn events. Rate limit forecasting deferred.

### Round 4.5 — Search + Longitudinal *(done 2026-02-28)*

- [x] **Passthrough FTS** — `/search?q=...` page with Algolia + D1 enrichment, SLEEPER_RULES eager consumer, donor-gated play button
- [x] **Longitudinal item page** — dual sparkline (HN score + HRCB dots, shared time axis) + audit trail type/model filter + sort toggle

### Round 4.6 — Extrapolation Audit Fixes

- [x] **Fix `getModelAgreement` FK** *(done 2026-02-28)* — `mr.id` → `mr.model_id`
- [x] **Enforce evidence caps in parser** *(done 2026-02-28)* — H=1.0, M=0.7, L=0.4 enforced in `validateSlimEvalResponse`
- [x] **Fix volatility thresholds** *(done 2026-02-28)* — 0.15/0.35 → 0.10/0.25 per methodology spec
- [x] **Emit `model_divergence` events** *(already implemented)* — `updateConsensusScore` logs at spread >0.25
- [x] **Validate PT technique names** *(done 2026-02-28)* — unknown techniques now contribute 0 (not 1)
- [x] **Add missing event type colors** *(done 2026-02-28)* — 9 event types given distinct colors on /status/events
- [x] **Show `archive_url` on item page** *(done 2026-02-28)* — "archived" link when Wayback URL exists
- [x] **Disclose `archive_used` on item page** *(done 2026-02-28)* — "from archive" note in eval metadata
- [x] **Surface `consensus_spread`** *(done 2026-02-28)* — "Contested" badge when spread >0.3 + 2+ models
- [x] **Link section scores to `/article/[n]`** *(done 2026-02-28)* — ArticleDetail section labels now clickable
- [x] **Render `dominant_sentiment` on HTML pages** *(done 2026-02-28)* — 4th distribution chart on /sources
- [x] **Link observatory propaganda table domain column** *(done 2026-02-28)* — domain text → `/domain/[domain]` link

### Round 4.7 — Data Model Cleanup
*From data-model audit (2026-02-28). Full plan: `.claude/plans/data-model-audit-2026-02-28.md`*

- [x] **Drop orphaned `batches` table** *(already done — migration 0042)*
- [x] **Surface write-only sub-fields on item page** *(already done — EQ 4-bar chart + TD boolean pills)*
### Round 5 — Data Expansion

- [ ] **Enhanced comments**
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (lite prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

### Round 5.5 — Submission Mirror *(done 2026-02-28)*

- [x] **user_aggregates materialization** *(done 2026-02-28)* — migration 0054; replaces CTE double full-table scan on /users; 4 refresh triggers (eval write × 3 + crawl-path INSERT). KV cache 60s per sort+minStories key.
- [x] **Two editorial lenses** — `avg_editorial_full` (Claude, section-aggregate) vs `avg_editorial_lite` (Llama, holistic); r=0.44 validated distinct constructs. Divergence callout on /user/[username].
- [x] **Submission coverage** — `submitted_count` from HN API stored in `hn_users`; shown on /user/[username] as "We've seen N of ~M submissions".
- [x] **/user/[username] redesign** — Coverage → Deep Read → Quick Scan → Divergence → Fingerprint → SETL → feed. No gamification language.
- [x] **/users page updates** — karma column, EQ column, full/lite evals fraction, KV cache.
- [x] **sweepRefreshUserAggregates + sweepExpandFromSubmitted** — two new sweep endpoints.

### Round 6 — User-Facing Features

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

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

### Round 8 — Infrastructure Optimization

- [x] **Prerender static pages** *(done 2026-02-28)* — `/about`, `/data`, `/support` prerendered; `Astro.site` replaces `Astro.request.url`
- [x] **D1 Read Replication** *(done 2026-02-28)* — enabled in dashboard; `readDb()`/`writeDb()` session helpers in `db-utils.ts`; 23 pages + 14 API routes + 6 workers wrapped. Falls back to raw db if `withSession` unavailable (compat date `2024-09-23` may not support it — activates on compat date bump or Pages→Workers migration).
- [x] **Investigate Pages → Workers migration** *(researched 2026-02-28)* — not feasible: no Astro Workers adapter exists, `@astrojs/cloudflare` is Pages-only. Only `factions.astro` genuinely exceeds 10ms CPU (O(n²) clustering). Fix: cron pre-computation → KV blob (same pattern as status/models).

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
