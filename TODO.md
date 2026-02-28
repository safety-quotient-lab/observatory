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

- [ ] **Add try/catch to unguarded DB query functions** *(audit step 10, HIGH)*
  - ~8 functions lack error handling: `getFilteredStoriesWithScores` (score subquery),
    `getDomainIntelligence`, `getAllDomainStats`, `getUserIntelligence`,
    `getArticleCoverage`, `getArticleRanking`, `getArticleDetailedStats`, `getQueueStories`
  - Pattern: wrap in try/catch, log `console.error`, return safe default ([] or null)

- [ ] **Log silent catch blocks** *(audit step 24, MED)*
  - `getFairWitnessForStory`, `getEvalHistoryForStory` (db-stories.ts),
    `getDlqTrend`, `getSelfThrottleImpact` (db-analytics.ts) — bare `catch { return ...; }`
  - Add `console.error('[fnName]', err)` before the return

- [ ] **Wrap KV writes in try/catch in consumer-shared.ts** *(audit step 33, MED)*
  - Rater health KV puts (4 locations) propagate on failure
  - KV reads are already guarded; writes should match

- [ ] **Fix diverged `CONTENT_MAX_CHARS` in content-drift.ts** *(audit step 38, MED)*
  - `content-drift.ts` defines `CONTENT_MAX_CHARS = 50000` locally
  - `shared-eval.ts` canonical value is `20_000`
  - Either import from shared-eval or rename the local to `DRIFT_FETCH_MAX_CHARS`

- [ ] **Cap `getRegionDistribution` LIMIT** *(audit step 21, MED)*
  - Currently `LIMIT 50000` — reduce to a reasonable cap (e.g., 5000)
  - `getStakeholderOverview` has `LIMIT 10000` — review if that's also too high

- [ ] **Guard Promise.all on users.astro and domains.astro** *(audit steps 42+43, LOW)*
  - Add `.catch(() => [])` on individual promises to prevent full page crash

- [ ] **Clean up `as any` casts** *(audit steps 2+7, LOW)*
  - `eval-parse.ts`: `parsed: any` params in validators — add proper type
  - `ingest.ts` line 128: `...(slim as any)` spread — type the conversion
  - `ingest.ts`: redundant `UPDATE stories SET eval_status = 'done'` after
    `writeRaterEvalResult` (which already handles promotion)

- [ ] **Replace `SELECT *` with explicit columns** *(audit step 13, LOW)*
  - `getStory()`: `SELECT * FROM rater_scores` → named columns
  - `getHnUser()`: `SELECT * FROM hn_users` → named columns
  - `getTopSetlStories`/`getBottomSetlStories`: `s.*` → `STORY_LIST_COLS`

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

### Round 4 — Analytics (runs on existing data, no migrations needed)

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

- [ ] **Surface write-only supplementary signal columns** *(data model finding DM-2)*
  - 16 columns written but never displayed: eq_uncertainty_handling,
    eq_purpose_transparency, eq_claim_density, so_framing, so_reader_agency,
    td_author_identified, td_conflicts_disclosed, td_funding_disclosed,
    sr_voice_balance, sr_perspective_count, tf_primary_focus, tf_time_horizon,
    cl_jargon_density, cl_assumed_knowledge, gs_regions_json, so_framing
  - Option A: surface high-value ones on `/item/[id]` detail panel
  - Option B: mark as "available via API, not displayed in UI"
  - `eq_source_quality` and `eq_evidence_reasoning` are already surfaced

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

- [ ] **Drop orphaned `batches` table** *(data model DM-1+12)*
  - Table has zero code references. `eval_batch_id` column on stories is
    actively written (links to cron cycle) but the `batches` table itself
    is dead. Either drop table, or repurpose it to store batch metadata.

- [ ] **Prune orphaned query functions** *(data model DM-3)*
  - ~16 exported functions never called — keep as future dashboard candidates
    but consider marking with `/** @internal future use */` JSDoc
  - `getCostStats` already wired to status page; `getTopPositiveStories`/
    `getTopNegativeStories` useful for article deep dive (Round 6)

- [ ] **Materialize `getUserIntelligence`** *(audit step 14, LOW)*
  - Currently a live CTE scan over full stories table
  - Create `user_aggregates` materialized table (like `domain_aggregates`)
  - Update on eval write, query from materialized data

- [ ] **Drop legacy `scores`/`fair_witness` tables** *(deferred from unify work)*
  - All reads already migrated to `rater_scores`/`rater_witness`
  - Writes still go to both (rollback safety)
  - After confirming production stability for 2+ weeks, remove legacy writes
    and drop tables via migration

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
