# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains the UN Universal Declaration of Human Rights (UDHR) text, an evolving methodology for evaluating websites' compatibility with it, and **a live Cloudflare-based pipeline** that automatically evaluates Hacker News stories. The methodology has progressed through three major versions (v1 → v2 → v3).

## Key Concepts

- **HCB (HR Compatibility Bias)**: The core measured construct (v3+). Measures the directional lean of web content relative to UDHR provisions. Scale: [-1.0, +1.0].
- **Signal Channels**: Editorial (E) = what content says; Structural (S) = what the site does. Scored independently, combined with content-type-specific weights.
- **Domain Context Profile (DCP)**: Inherited modifiers from domain-level policies (privacy, ToS, accessibility, mission, ownership, access model, ad/tracking).
- **SETL (Structural-Editorial Tension Level)**: Measures divergence between E and S channel scores. High SETL = "says one thing, does another."
- **Fair Witness**: Each scored section includes `witness_facts` (observable) and `witness_inferences` (interpretive), enforcing evidence transparency.
- **Supplementary Signals**: 9 additional dimensions beyond HRCB — epistemic quality, propaganda flags, solution orientation, emotional tone, stakeholder representation, temporal framing, geographic scope, complexity level, transparency/disclosure.

## Architecture

### Pipeline (Cloudflare Workers + D1 + KV + R2 + Queues)

All infrastructure code lives under `site/`.

```
Cron Worker (1min) → Queues → 3 Provider-Specific Consumer Workers → D1 + R2
                                        ↓ (on failure)
                                  DLQ Worker (hrcb-eval-dlq) → dlq_messages table

  hrcb-eval-queue (1 queue)     → hn-hrcb-consumer-anthropic
  8 OpenRouter queues           → hn-hrcb-consumer-openrouter
  hrcb-eval-workers-ai (1 queue)→ hn-hrcb-consumer-workers-ai
```

**Workers:**
- `site/functions/cron.ts` — HN crawling, score refresh, queue dispatch. Also serves `/trigger`, `/trigger?sweep=...`, `/calibrate`, `/calibrate/check`, `/health`. Pre-fetch step runs content gate + `hasReadableText` to skip non-evaluable content before queueing.
- `site/functions/consumer-shared.ts` — Shared types, helpers, content prep, and result writing for all 3 consumers. Uses `isFirstFullEval` (not `isPrimary`) for first-eval housekeeping (R2 snapshot, content hash, DCP cache, archive).
- `site/functions/consumer-anthropic.ts` — Anthropic queue handler. Inline fetch with prompt caching, proactive rate limit tracking, 429/529/credit handling, truncation retry.
- `site/functions/consumer-openrouter.ts` — OpenRouter queue handler (8 model queues). Light + full prompt modes. Uses `callOpenRouterApi` from providers.ts.
- `site/functions/consumer-workers-ai.ts` — Workers AI queue handler. Free tier, no API key. Uses `callWorkersAi` from providers.ts.
- `site/functions/dlq-consumer.ts` — Captures dead-lettered messages. Also serves `/replay` and `/replay/:id`.

**Wrangler configs:** `site/wrangler.toml` (Pages site — has DB + CONTENT_CACHE bindings), `site/wrangler.cron.toml`, `site/wrangler.consumer-anthropic.toml`, `site/wrangler.consumer-openrouter.toml`, `site/wrangler.consumer-workers-ai.toml`, `site/wrangler.dlq.toml`. Real D1/KV resource IDs are committed — they are infrastructure identifiers, not secrets (useless without Cloudflare API token). Each config has a `# Fork setup:` comment block explaining what to replace. Real secrets (API keys, TRIGGER_SECRET) stay in `.dev.vars` (gitignored).

**Storage:**
- **D1** (`hrcb-db`): stories, events, eval_history, domain_dcp, dlq_messages, calibration_runs, ratelimit_snapshots, domain_aggregates (materialized per-domain signal averages, updated at eval write time via `refreshDomainAggregate()`), daily_section_stats (per-day per-section score rollup, updated via `refreshDailySectionStats()`, used by `getArticleSparklines`), calibration_evals (longitudinal calibration snapshots — never deleted, accumulates every light cal run; UNIQUE on calibration_run+hn_id+eval_model+eval_provider; INSERT OR IGNORE deduplicates concurrent evaluator races), model_registry (D1 overlay for toggling models without deploys — migration 0037; `enabled`, `disabled_reason`, `updated_at`, `is_primary` (migration 0045 — DB flag for primary model designation); `getEnabledModelsFromDb(db)` intersects with MODEL_REGISTRY + falls back to static on DB error; `getPrimaryModelId(db)` queries `is_primary = 1`), domain_profile_snapshots (daily snapshots of domain_aggregates — migration 0039; PK `(domain, snapshot_date)`; `INSERT OR IGNORE` idempotent; cron writes at `minute === 5` with KV guard `snapshot:domain:${today}`; queried by `/api/v1/domain/[domain]/history`), eval_queue (pull-model dispatch table — migration 0041; consumers claim rows atomically via `claimFromEvalQueue()`; UNIQUE(hn_id, target_provider, target_model); stale claims auto-recovered after 5 min)
- **KV** (`CONTENT_CACHE`): content cache, DCP cache, rate limit state per model, query result cache (keys `q:*`, TTL 300-600s, invalidated after each primary eval), queue in-flight reservation (keys `queue:inflight:<provider>:<hn_id>`, TTL 300s — prevents concurrent evaluator instances from double-evaluating same stories), v1 API rate limit counters (keys `ratelimit:v1:<ip>`, TTL 3600s), daily domain snapshot guard (keys `snapshot:domain:${today}`, TTL 25h — ensures cron `minute===5` block runs once per day)
- **R2** (`hrcb-content-snapshots`): content snapshots for audit trail

### Site (Astro + Cloudflare Pages)

**Navigation:** `stories | signals | sources | rights | status | about` (6 hubs). `/trends` exists but is not in the nav.

**Page taxonomy:**
- **Stories** (`/`): main feed, `/past` (archive by date), `/velocity`, `/dynamics`, `/item/[id]` (merged audit trail: eval_history + events)
- **Signals** (`/signals`): live data dashboard — 6 sections (Core HRCB summary, Global Averages bar chart + 4 distribution charts, Derived Metrics cards, Supplementary Signals reference cards, Fair Witness one-liner, Eval Modes one-liner). Every signal links to `/about#anchor` for reference details. Uses `getStatusCounts` + `getSignalOverview` for live data.
- **Rights** (`/rights`): hub → `/rights/observatory` (research dashboard), `/rights/articles`, `/rights/network`, `/article/[n]`
- **Sources** (`/sources`): live source intelligence dashboard — 6 sections (Source Universe one-liner, Source Metrics 4-card grid, Signal Leaders 8-card grid with top/bottom domains per dimension, Editorial Character 3 distribution charts, Source HRCB Distribution 7-band bar chart, Deep Dive hub cards). Data from `getDomainSignalProfiles(db)` (KV-cached). Sub-pages: `/domains`, `/domain/[domain]`, `/users`, `/user/[username]`, `/factions`
- **Trends** (`/trends`): hub → `/seldon`, `/velocity`, `/dynamics`
- **Status** (`/status`): pipeline health glance — Coverage Spectrum (Multi-Model/Full/Light/No Coverage funnel), Workers Health, Queue Breakdown, Operations (evals/day, active days, clearance estimate). Hub cards link to sub-pages. Sub-pages: `/status/models` (model registry + performance + measurement integrity — Evaluation Models, Multi-Model Raters, Evaluator Trust Index, Calibration, Signal Completeness, Model Drift, Content Type Validation, Score Distribution, Multi-Model Comparison, Section Divergences), `/status/events` (activity log + diagnostics — Pipeline Events, Recent Failures, Evaluation Queue, DLQ Details, API & Rate Limits, Cycle Performance, Throttle Impact, Eval Latency). All three pages use `cachedQuery` with KV (keys `sys:*`, TTLs 60-600s); ops-critical data stays uncached.
- **About** (`/about`): 3-tier progressive disclosure — Tier 1 (always visible: intro, HRCB, classification labels, sentiment labels), Tier 2 (`<details open>`: methodology — channels, content type weights + consensus vote, per-provision pipeline, SETL, Fair Witness + FW ratio, evidence + ND, directionality, volatility, consensus, eval modes comparison table), Tier 3 (`<details>`: supplementary signals, factions, DCP, content gate, version history, technical). All reference sections have anchor IDs (e.g., `#classification`, `#setl`, `#fair-witness`) for deep linking from `/signals`.
- **Data** (`/data`): stub page — live API endpoints table (active links to `/api/v1/stories`, `/api/v1/domains`, etc.) + greyed-out coming-soon export table (stories.csv, stories.jsonl, domains.csv, rater-evals.jsonl — all 501). License TBD (CC BY-NC-SA 4.0 recommended).
- **Support** (`/support`): donation page — PayPal + GitHub Sponsors buttons, project cost context, "mark as donated" bypass (7-day TTL). Footer "Donate" link points here.
- **Redirects** (301): `/dashboard`→`/status`, `/system`→`/status`, `/models`→`/status/models`, `/front`→`/past`, `/articles`→`/rights/articles`, `/network`→`/rights/network`, `/user-intel`→`/users`, `/domain-intel`→`/domains`

- `site/src/lib/db.ts` — Barrel re-export from `db-stories.ts`, `db-entities.ts`, `db-analytics.ts`, `db-multi-model.ts`
- `site/src/lib/db-stories.ts` — Story types, feed queries, dashboard stats, queue/failed stories, `getStory()` (reads from `rater_scores`), `getFairWitnessForStory()` (reads from `rater_witness`)
- `site/src/lib/db-entities.ts` — Domain/user queries, signal profiles, DCP, pipeline health, content gate stats, events re-exports
- `site/src/lib/db-analytics.ts` — Sparklines, histograms, scatter, velocity, daily HRCB, temporal patterns, observatory, `getProviderStats` (per-worker eval activity), `getModelQueueStats` (per-queue in-flight + throughput), `getDlqTrend` (14-day daily counts + backlog direction), `getSelfThrottleImpact` (7-day wasted seconds per model), `getEvalLatencyStats` (P50/P95/P99 per model), `getSignalCompleteness` (per-model % non-null per supplementary signal), `getModelTrustHistory` + `groupTrustByModel` (14-day trust snapshots for Evaluator Trust Index on /status/models), `getDomainKarmaMap` (per-domain avg poster karma for /domains scatter + /factions enrichment), `getKarmaHrcbCorrelation` (karma-vs-HRCB scatter + Pearson r on /users), `getContentTypeValidation` + `getContentTypeDisagreement` + `getMisclassificationSummary` (content type misclassification detection for /status/models Measurement Integrity), `getVelocityStats` (rolling 7-day eval rate from rater_evals — evals24h, evals7d, evalsPerDay)
- `site/src/lib/db-multi-model.ts` — Rater evals/scores/witness, model agreement, multi-model stories
- `site/src/lib/shared-eval.ts` — Barrel re-export from `eval-types.ts`, `models.ts`, `prompts.ts`, `eval-parse.ts`, `eval-write.ts`, `rater-health.ts`
- `site/src/lib/eval-types.ts` — Type definitions, interfaces, ALL_SECTIONS constant
- `site/src/lib/models.ts` — Model registry, provider types, queue bindings, `QUEUE_CONFIG` export (derived list of enabled model-to-queue mappings), `getEnabledModelsFromDb(db)` (D1 overlay — intersects DB-enabled list with MODEL_REGISTRY, falls back to static on error)
- `site/src/lib/api-v1.ts` — Shared helpers for v0 and v1 public API routes: `corsHeaders()`, `checkRateLimit(kv, ip)` (200 req/hour KV counter), `jsonResponse()`, `errorResponse()`, `listCacheHeaders()`, `itemCacheHeaders()`
- `site/src/pages/api/v0/` — HN Firebase API-compatible endpoints: `topstories.json.ts` (by HN score), `beststories.json.ts` (by HRCB weighted_mean), `newstories.json.ts` (by submit time), `item/[id].json.ts` (HN item format + `hcb` extension object with eval scores)
- `site/src/pages/api/v1/domain/[domain]/history.ts` — `GET /api/v1/domain/{domain}/history?days=30` (max 365). Returns `{ domain, days, snapshots[] }` from `domain_profile_snapshots`. 404 if domain not in `domain_aggregates`.
- `site/src/pages/api/v1/export/` — Stub export endpoints returning 501 Not Implemented: `stories.csv.ts`, `stories.jsonl.ts`, `domains.csv.ts`, `rater-evals.jsonl.ts`. Message advises using `/api/v1/stories` for paginated access.
- `site/src/lib/prompts.ts` — System prompts (full, slim, light)
- `site/src/lib/eval-parse.ts` — Response parsing, validation, content fetching
- `site/src/lib/eval-write.ts` — D1 write functions (eval results, DCP cache). `writeEvalResult()` updates the `stories` table only (legacy `scores`/`fair_witness` tables dropped — migration 0047). `writeRaterEvalResult()` writes to `rater_evals` + `rater_scores` + `rater_witness` + `eval_history`, then calls `writeEvalResult()` for story promotion. `updateConsensusScore()` called at end of both write paths — computes weighted mean across all done rater_evals (full=1.0 weight, light=0.5), updates stories.consensus_score/count/spread. `requestArchive(db, kv, hnId, url)` — KV-rate-limited (10s TTL) fire-and-forget Wayback Machine preservation, stores memento URL in stories.archive_url. `writeLightRaterEvalResult()` does COALESCE fill-in UPDATE to stories after writing rater_evals (fills eq_score, so_score, td_score, et_primary_tone, et_valence, et_arousal where null), then calls `refreshDomainAggregate`.
- `site/src/lib/rater-health.ts` — Per-model health tracking, auto-disable/re-enable
- `site/src/lib/events.ts` — Structured event logger with typed event taxonomy
- `site/src/lib/compute-aggregates.ts` — Deterministic aggregate computation (CPU-side)
- `site/src/lib/calibration.ts` — Full-model `CALIBRATION_SET` (hn_ids -1001..-1015) + light-model `LIGHT_CALIBRATION_SET` (hn_ids -2001..-2015) + per-model thresholds + parameterized `runCalibrationCheck(scores, calSet?, thresholds?)`
- `site/src/lib/content-gate.ts` — Pre-eval content classification (paywall, captcha, bot protection, etc.)
- `site/src/lib/content-drift.ts` — Content change detection: `computeContentHash()` + `checkContentDrift()` for re-evaluating stories whose content changed since last eval
- `site/src/lib/colors.ts` — Score/SETL/confidence/gate color mapping
- `site/src/lib/db-utils.ts` — `SETL_CASE_SQL(alias)` SQL fragment helper, `cachedQuery<T>(kv, key, fn, ttl)` KV-backed query cache, `safeBatch()` D1 batch chunker (≤100 statements)
- `site/src/components/` — Reusable Astro components (Breadcrumb, EvalCard, DcpTable, etc.)
- `site/functions/rate-limit.ts` — Rate limit state, capacity checks, credit pause (KV TTL: 600s)
- `site/functions/providers.ts` — API call adapters (Anthropic, OpenRouter, Workers AI) with 15s AbortController timeout

## Build & Deploy

All commands run from `site/`:

```bash
# Build site
npx astro build

# Deploy
npx wrangler pages deploy dist --project-name hn-hrcb     # site
npx wrangler deploy --config wrangler.cron.toml            # cron worker
npx wrangler deploy --config wrangler.consumer-anthropic.toml   # Anthropic consumer
npx wrangler deploy --config wrangler.consumer-openrouter.toml  # OpenRouter consumer
npx wrangler deploy --config wrangler.consumer-workers-ai.toml  # Workers AI consumer
npx wrangler deploy --config wrangler.dlq.toml             # DLQ worker

# Migrations
npx wrangler d1 migrations apply hrcb-db --remote

# Manual triggers (auth via TRIGGER_SECRET in .dev.vars)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" https://hn-hrcb-cron.kashifshah.workers.dev/trigger
curl -s -X POST -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" https://hn-hrcb-cron.kashifshah.workers.dev/calibrate
curl -s -X POST -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" https://hn-hrcb-dlq.kashifshah.workers.dev/replay

# Sweep: retry failed evaluations (default limit 50, max 200)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=failed"

# Sweep: backfill skipped stories with score >= 100 (default min_score 50, default limit 50)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=skipped&min_score=100&limit=30"

# Sweep: coverage-driven crawl (all strategies or a specific one)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=coverage"
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=coverage&strategy=domain_min_coverage"

# Sweep: Algolia historical backfill (default min_score 500, days_back 365)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=algolia_backfill&min_score=500&limit=50"

# Sweep: content drift detection (re-evaluates stories whose content changed)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=content_drift&limit=20"

# Health check (no auth)
curl -s https://hn-hrcb-cron.kashifshah.workers.dev/health

# Query D1 directly
npx wrangler d1 execute hrcb-db --remote --command "SELECT ..."

# Tail logs
npx wrangler tail hn-hrcb-consumer-anthropic --format pretty
npx wrangler tail hn-hrcb-consumer-openrouter --format pretty
npx wrangler tail hn-hrcb-consumer-workers-ai --format pretty
```

## Event Types

The pipeline logs structured events: `eval_success`, `eval_failure`, `eval_retry`, `eval_skip`, `rate_limit`, `self_throttle`, `credit_exhausted`, `fetch_error`, `parse_error`, `cron_run`, `cron_error`, `crawl_error`, `r2_error`, `dlq`, `dlq_replay`, `calibration`, `coverage_crawl`, `trigger`, `auto_retry`, `dlq_auto_replay`, `auto_calibration`, `rater_auto_disable`, `dcp_stale`, `r2_cleanup`, `story_flagged`, `content_drift`.

## Methodology Files

### Source Text
- `unudhr.txt` — Full UDHR text (Preamble + Articles 1-30)

### Methodology (version chain: v1 → v2 → v3 → v3.3 → v3.4)
- `methodology-v3.4.txt` — **Current canonical reference**
- `methodology-v3.1.prompt.md` — Self-contained LLM prompt for running evaluations
- Earlier versions: `methodology-v1.txt`, `methodology-v2.txt`, `methodology-v3.txt`, `methodology-v3.3.txt`

### Calibration
- `calibration-v3.1-set.txt` — 15-URL calibration set with expected score ranges (full model)
- `calibration-v3.1-baselines.txt` — Actual baseline evaluations for 9 calibration URLs

### Local scripts (run with `node scripts/...`)
- `scripts/evaluate-standalone.mjs` — Fetch queue from `/api/queue`, evaluate with `claude -p`, post to `/api/ingest`. Modes: `--mode light` (default) or `--mode full`. Spawns claude with `{ CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined }` — both must be unset or the subprocess either refuses (CLAUDECODE) or uses depleted API credits instead of the OAuth subscription (ANTHROPIC_API_KEY). Failure mode: exit 1, "Credit balance is too low" on stdout, empty stderr.
- `scripts/backfill-daemon.sh` — Batch loop with 15s sleep. Self-launches into `tmux new-session -d -s backfill` if not already in tmux. Stop with `touch .backfill-stop`.
- `scripts/validate-light.mjs` — 15-URL calibration validator for `light-1.2` model. Passes 15/15 against final calibration set (EP-1..5, EN-1..5, EX-1..5). Run: `node scripts/validate-light.mjs [--concurrency N]`.
- `scripts/validate-light-dcp.mjs` — Two-step DCP-enhanced validator (root page → DCP profile → editorial eval). Passes 15/15. Adds ~17s per URL overhead. DCP limitation: archive.org profiled as "utility" (misses digital rights mission).

**Light calibration workflow:**
1. `curl -X POST .../calibrate?mode=light` — inserts hn_ids -2001..-2015 as pending
2. `node scripts/evaluate-standalone.mjs --mode light` — evaluates and posts to /api/ingest
3. `curl -X POST .../calibrate/check?mode=light` — reads rater_evals, runs check, writes to calibration_runs

## Factions Page

The factions page (`site/src/pages/factions.astro`) clusters domains by **editorial character** using 8 supplementary signal dimensions (EQ, SO, SR, TD, PT inverted, AR, VA, FW) rather than the 31-dimension UDHR fingerprint.

**Algorithm:** Z-normalize per dimension → cosine similarity on 8D vectors → agglomerative hierarchical clustering with average linkage at 1/φ threshold (fallback to 1/φ² if single giant cluster).

**Page sections (top→bottom):** Signal Landscape (histograms) → Parallel Coordinates → **Signal Space** (2D PCA scatter + 3D Three.js orbit toggle) → Differentiation (inter-cluster variance) → Cluster Cards (radar charts, members, sentiment/karma/HRCB distribution, liminal flags) → Affinity Matrix → Interesting Pairs → Outliers → Methodology Notes.

**Archetype naming:** ~22 pattern rules (e.g., high EQ + TD + low PT → "Rigorous Analysts"), fallback to readable "High X/Y · Low Z" names.

**Key data flow:** `getDomainSignalProfiles(db)` → build raw vectors → z-normalize → cluster → enrich with archetypes, insights, radar data → render. `getDomainSignalProfiles` reads from `domain_aggregates` (simple table scan, ~50ms vs old correlated-subquery ~2-5s). Results cached in KV (`q:domainSignalProfiles`, 5-min TTL). Note: `Map<string, DomainSignalProfile>` is not JSON-serializable — factions.astro caches `DomainSignalProfile[]` and reconstructs the Map.

**Signal Space component** (`site/src/components/SignalSpace.astro`): Server-side PCA (power iteration, 3 components from 8D z-vectors). 2D SVG scatter (D3-free, cluster ellipse shadows, hover detail panel). 3D Three.js orbit (CDN lazy import via `<script is:inline define:vars>`, OrbitControls, Raycaster click). Toggle buttons for 2D/3D modes.

## Key Patterns

- **Astro template gotcha**: Cannot use TypeScript generics with angle brackets (`Record<string, string>`) inside JSX template expressions — extract to frontmatter constants instead.
- **Astro `.json.ts` routing**: Astro strips only the final `.ts` extension — so `topstories.json.ts` → `/api/v0/topstories.json`. Works for any compound extension. Dynamic `.json` routes like `[id].json.ts` → `/api/v0/item/{id}.json` where Astro captures the full `123.json` as `params.id` — strip `.json` suffix in the handler: `parseInt(params.id.replace(/\.json$/, ''), 10)`.
- **`compatibility_date` must stay at `2024-09-23`** in `site/wrangler.toml`. Bumping to 2026-02-01 breaks Astro SSR — every page returns `[object Object]` instead of HTML due to incompatible Response handling in newer Cloudflare compat flags.
- **Mobile responsiveness**: CSS utility classes in `global.css` handle mobile layout: `.insight-grid` (auto-fill grid → 2-col → 1-col), `.two-col` (2-col → stacked), `.stat-cards` (flex wrap → 50% → 100%). Nested table min-widths relaxed via `.hn-page table table { min-width: unset; }` (no `!important` — let inline styles win when needed). `word-break: break-word` scoped to `.titleline, .sitebit` only (never on scores/labels). Nav links use flex-wrap with plain text `' | '` separators (wrapping spans break flex layout). Breakpoints: 640px (mobile) and 400px (extra-small).
- **Progressive disclosure**: `.collapsible-section` class in `global.css` styles `<details>/<summary>` for 3-tier content. Used on About page (Tier 1 always visible, Tier 2 `<details open>`, Tier 3 `<details>` collapsed) and System page (primary always visible, secondary `<details open>`, tertiary `<details>` collapsed). Custom `▸` marker rotates on open.
- **Hub pages as navigation gateways**: Rights and Trends hubs are lean navigation gateways — minimal inline data, sub-page cards with descriptions. Sources (`/sources`) is now a live dashboard (like `/signals`) pulling from `getDomainSignalProfiles`. Redundant data that exists on sub-pages should not be duplicated on hub pages.
- **Consumer hash functions**: `hashString()` = SHA-256 first 16 bytes as hex (32 chars). Used for methodology_hash (system prompt only) and prompt_hash (system + user).
- **Rate limiting**: Consumer reads `anthropic-ratelimit-*` headers proactively, self-throttles via KV state before hitting 429s. Circuit breaker at 3+ consecutive 429s.
- **Content gate dual placement**: Runs in cron pre-fetch (primary — blocks before queueing, writes `gate_category`/`gate_confidence` to stories) AND consumer (safety net for KV cache misses). Pure regex, no LLM calls.
- **age_gate false positive pattern**: The `age_gate` regex triggers on article content that *discusses* age verification (e.g. theverge.com/pcgamer.com articles about age verification laws), not just on actual age gate UI elements. Confidence 0.6–0.9 on these false positives. Fix: tighten regex to require form elements or "enter your date of birth" / "are you 18?" phrases rather than matching topic keywords.
- **domain_aggregates column names**: The table uses `avg_hrcb` (not `avg_hcb`), `evaluated_count` (not `eval_count`), `story_count` (total crawled). When writing D1 queries against this table, use these names. `avg_hrcb` is null for domains where all evaluated stories had null `hcb_weighted_mean` (e.g. ghost stories) — self-corrects when stories re-evaluate.
- **D1 remote query complexity limit**: `ORDER BY` on `domain_aggregates` (2021 rows) times out when combined with JOINs or complex expressions. Workaround: filter first with `WHERE evaluated_count >= N` (uses index) then ORDER BY, or query without ORDER BY and sort in application. Simple `COUNT(*)` and PK-indexed lookups are fast.
- **Calibration IDs**: Full model: synthetic hn_ids -1001 to -1015 (`CALIBRATION_SET`). Light model: -2001 to -2015 (`LIGHT_CALIBRATION_SET`). Light cal enqueued via `POST /calibrate?mode=light` (inserts as pending for local evaluator), checked via `POST /calibrate/check?mode=light` (reads `rater_evals` with `prompt_mode='light'`). Both sets shown on `/status/models` (Calibration cards).
- **DCP caching**: 7-day TTL in KV per domain, also persisted to `domain_dcp` table in D1.
- **Light prompt mode**: Small/free models (Workers AI: `llama-4-scout-wai` + `llama-3.3-70b-wai` — both on `WORKERS_AI_QUEUE`; `llama-3.3-70b` on OpenRouter was disabled due to chronic 429s) use `METHODOLOGY_SYSTEM_PROMPT_LIGHT` — editorial-only single score + 5 supplementary signals (eq, so, td, valence, arousal) + primary_tone (~200-400 output tokens vs ~4-5K for full). Schema `light-1.4` (was `light-1.3`). **light-1.4 changes**: integer 0-100 scoring (50=neutral) instead of float [-1,+1] — eliminates bimodal 0.0/0.8 clustering; explicit tier anchors (90-100=NGO advocacy, 50=utility, 0-10=propaganda); `reasoning` field (max 10 words, placed before `editorial` in JSON template so model pre-commits before outputting digit). Parser detects v1.4 by `schema_version === 'light-1.4'` or value > 1.0, converts via `(score-50)/50`. Old light-1.3 scores cleared by migration 0046 (applied 2026-02-27 — 1,456 light-only stories reset to pending for re-evaluation). Field `executive_summary` renamed to `short_description` (max 20 words). Controlled by `ModelDefinition.prompt_mode: 'full' | 'light'`. No structural channel, no per-section scores, no DCP, no Fair Witness evidence, no SR, no PT (pt_flag_count = null — not measured). Results written to `rater_evals` with `prompt_mode = 'light'` (no `rater_scores`/`rater_witness`). After each light rater_evals write, `writeLightRaterEvalResult` does a COALESCE fill-in UPDATE to `stories` — fills eq/so/td/tone/valence/arousal + hcb_editorial_mean + theme/sentiment tags (nulls only). Light evals do NOT promote `eval_status` — stories remain pending/queued until a full eval runs. Light dispatch in `enqueueForEvaluation` sends ALL pending stories to Workers AI queue so they get fast ~lite editorial scores while awaiting full eval. Stuck-queued recovery in `enqueueForEvaluation` resets stranded `queued` stories (with no full eval) back to `pending` when Anthropic becomes available. `EvalCard.astro`: `hasEval` checks `hcb_weighted_mean !== null || hcb_editorial_mean !== null` (no `eval_status` check — shows scores even for pending stories with light evals); `isLightOnly = hcb_weighted_mean === null` suppresses S: channel display; lite evals show boxed `[L]` icon instead of `~lite` text. `displayScore = hcb_weighted_mean ?? hcb_editorial_mean` (weighted first — was incorrectly reversed before 2026-02-28).
- **Per-model content truncation**: `ModelDefinition.max_input_chars` (optional) limits content chars sent to small-context models. Applied in `prepareContent()` after global `cleanHtml(CONTENT_MAX_CHARS=20K)` truncation. Workers AI models: `llama-3.3-70b-wai` = 6000 chars, `llama-4-scout-wai` = 12000 chars. Other models leave undefined (use full 20K). Truncation percentage recorded in `rater_evals.content_truncation_pct` (migration 0040) — `0.0` = no truncation, `0.7` = 70% cut. Used as consensus weight discount: `weight *= (1 - truncPct * 0.5)`.
- **eval_queue pull model**: Consumers claim work from `eval_queue` table (migration 0041) instead of receiving full story payloads via CF Queues. Wake-up signals `{ trigger: 'new_work' }` sent to queue. `claimFromEvalQueue()`, `getStoryForClaim()`, `makeEvalQueueMsg()` in `consumer-shared.ts`. UNIQUE(hn_id, target_provider, target_model) + INSERT OR IGNORE = idempotent. Stale claims (>5 min) auto-recovered. `batch_id` column added to `eval_queue` (migration 0043) — set at dispatch time in `enqueueForEvaluation()`, flows through `EvalQueueClaim.batch_id` → `QueueMessage.batch_id` → `writeRaterEvalResult()`/`writeLightRaterEvalResult()` → `rater_evals.eval_batch_id`. Links all evals from the same cron cycle for regression isolation.
- **eval_priority_score**: Time-decayed composite dispatch priority (migration 0044). Formula: `(hn_score * decay) + (hn_comments * 0.5 * decay) + log10(karma) * 10 + feed_count * 5` where `decay = exp(-hoursOld / 24)`. Computed by `computePriorityScore()` + batch-written by `updatePriorityScores(db)` (non-fatal, runs at start of every `enqueueForEvaluation` call). JOINs `hn_users` (karma) + `story_feeds` (feed_count). Stored in `stories.eval_priority_score`; partial index `idx_stories_priority_pending` on `eval_status='pending'`. Both `enqueueForEvaluation` ORDER BY and `/api/queue` ORDER BY use `COALESCE(eval_priority_score, hn_score, 0) DESC` for graceful fallback before score is computed.
- **Workers AI response format**: `ai.run()` may return `{ response: "string" }` or `{ response: { ...object } }` — consumer handles both.
- **QueueMessage `prompt_mode`**: Non-primary model queue messages now include `prompt_mode: model.prompt_mode` (set at dispatch time in `hn-bot.ts` and `cron.ts`). Consumer uses this as fallback in `isLightMode` detection (alongside model registry lookup).
- **Cron KV distributed lock**: Scheduled handler acquires a `cron:lock` KV key (120s TTL) before running. If lock exists, cycle is skipped. Lock check failure is non-fatal (logged and continues). Prevents overlapping cron cycles.
- **Calibration cleanup**: `POST /calibrate` deletes eval_history, rater_witness, and rater_evals for calibration IDs before re-enqueue; prunes calibration_runs older than 30 days. `POST /calibrate?mode=light` deletes light rater_evals for -2001..-2015 and calibration_runs for 'light-1.3'/'light-1.4' before re-inserting — without this, the queue's NOT EXISTS filter skips already-evaluated calibration IDs.
- **Light calibration cloud vs standalone gap**: `POST /calibrate?mode=light` + cloud consumer tests actual production models (llama-4-scout-wai, llama-3.3-70b-wai). `evaluate-standalone.mjs --mode light` uses `claude -p claude-haiku-4-5` locally (validates prompt structure, not production models). Cloud consumer IPs (Cloudflare Workers egress) can get blocked by some cal targets — sites using **Cloudflare Bot Management** return a 157-char bot-protection page to Workers egress IPs, triggering `age_gate` content gate. Both booking.com and npmjs.com were replaced as EX-3 for this reason. Current EX-3 = **pypi.org** (Fastly CDN, confirmed accessible from Workers IPs). Standalone evaluator (local IP) gets the real page. EX-3 failing in cloud cal runs = content gate false positive, not model failure. Heuristic: sites with `cf-ray` response headers and Cloudflare Bot Management are likely to block Workers IPs.
- **calibration_evals longitudinal flow**: `POST /calibrate?mode=light` generates a unix timestamp (`calibration_run`), stores it in KV (`calibration:light:current_run`, 30-day TTL). `ingest.ts` reads this KV key when hn_id is a cal ID (-2015 to -2001), calls `writeCalibrationEval()` to append to `calibration_evals`. `writeCalibrationEval` uses `INSERT OR IGNORE` — if backfill daemon + manual evaluator run concurrently and both ingest the same cal ID, first write wins.
- **Unified read/write path via rater tables**: All per-section data lives in `rater_scores`/`rater_witness`. Legacy `scores`/`fair_witness` tables dropped (migration 0047). Single-story queries JOIN `sc.eval_model = s.eval_model`. Aggregate queries aggregate across all models with no model filter. `writeEvalResult()` updates `stories` only; `writeRaterEvalResult()` writes rater tables + calls `writeEvalResult()` for story promotion. `model_registry.is_primary` (migration 0045) makes primary model designation a DB flag. `getPrimaryModelId(db)` in models.ts queries it, falling back to `PRIMARY_MODEL_ID` constant.
- **Item page uses materialized columns, not hcb_json**: The item page (`/item/[id]`) reads supplementary signals, labels, and metadata from materialized `stories` columns. Aggregates computed from `rater_scores` via `computeAggregates()`. DCP from `domain_dcp` table. Fair Witness from `rater_witness`. `hcb_json` excluded from `getStory()` queries (~12-15KB savings per load). Default tab uses `story.eval_model` (not hardcoded PRIMARY_MODEL_ID).
- **eval-write FK guards**: All 3 write functions (`writeEvalResult`, `writeRaterEvalResult`, `writeLightRaterEvalResult`) do a `SELECT 1 FROM stories WHERE hn_id = ?` guard at entry — throws if story doesn't exist (stale queue message), preventing orphaned eval rows.
- **Consumer provider guards**: openrouter + workers-ai consumers check `prep.modelDef.provider` matches their expected provider — acks and skips if misrouted, prevents wrong-provider evals.
- **Llama `+` numeric prefix**: Llama models sometimes emit `"+0.5"` instead of `"0.5"` in JSON output. `extractJsonFromResponse` in eval-parse.ts strips leading `+` from numeric values via regex (`/:\s*\+(\d)/g`).
- **Consumer batch-level API key check**: Anthropic/OpenRouter consumers check API key at batch level (before message loop). Missing key → `msg.retry()` all messages and return (not silent ack → data loss).
- **DLQ consumer ack placement**: `msg.ack()` only fires after successful DB write + event log. If write fails, message is NOT acked (lets CF retry or expire naturally).
- **Content gate columns**: `stories.gate_category` (TEXT, nullable) and `stories.gate_confidence` (REAL, nullable) — migration 0024. NULL = content was accessible OR story is a pending ranking-skip (re-promotable). Written by `markSkipped()` when content gate blocks a URL. Surfaced on `/domain/[domain]` (Access Barriers), `/domains` (Most Gatekept card), `/sources` (Gated Content card), `/status/models` (Content Gates box). Query functions: `getDomainGateStats`, `getMostGatekeptDomains`, `getGlobalGateStats` in `db-entities.ts`.
- **Re-promotion guard**: The promotion query in `autoEvalIds()` (hn-bot.ts) must include `AND gate_category IS NULL` — otherwise permanently-gated stories (paywall, bot_protection, hn_removed, etc.) get re-promoted every cron cycle, causing infinite skip loops (confirmed bug: 835+ events/16h for bloomberg.com before fix). `url IS NOT NULL` is the wrong guard — it would block re-promotion of valid Ask HN posts.
- **gate_category taxonomy**: Regex-based (content-gate.ts): paywall, bot_protection, captcha, login_wall, cookie_wall, geo_restriction, age_gate, app_gate, rate_limited, error_page, redirect_or_js_required. Pipeline-level (hn-bot.ts + consumer-shared.ts): binary_content (Content-Type header check), js_rendered (fetch succeeded but no readable text), no_content (no URL + no self-text), hn_removed (dead/deleted/removed from HN API).
- **JSON-LD embedding pattern**: Build the JSON-LD object in Astro frontmatter, embed with `<script type="application/ld+json" set:html={JSON.stringify(jsonLd).replace(/</g, '\\u003c')} />`. Applied to: `index.astro` (ItemList, default view only), `item/[id].astro` (Article/NewsArticle), `article/[n].astro` (Article), `domain/[domain].astro` (Organization + AggregateRating), `domains.astro` (ItemList), `about.astro` (AboutPage + Dataset), `sources.astro` (CollectionPage). Guard with `const jsonLd = condition ? { ... } : null` and `{jsonLd && ...}`.
- **Public REST API** (`/api/v1/`): Astro routes under `src/pages/api/v1/` — stories, story/[id], domains, domain/[domain], domain/[domain]/history (from `domain_profile_snapshots`). Export stubs at `/api/v1/export/*` return 501. Public read-only (no auth), IP-based rate limit (200 req/hr via KV), CORS `*`, Cache-Control. Helpers in `api-v1.ts`. No separate wrangler config — deploys with the site.
- **Model registry D1 overlay**: `model_registry` table (migration 0037) lets you toggle models via `wrangler d1 execute` without a code deploy. `getEnabledModelsFromDb(db)` in models.ts intersects DB with MODEL_REGISTRY (belt-and-suspenders). Cron uses this at dispatch time.
- **checkFlaggedStories** (was `checkDeadStories`): Runs every 10th minute (minute % 10 === 3). Emits `story_flagged` event. Returns `{ checked, flagged }`. CrawlResult field is `flagged_check`. Three distinct eval_error strings: "Story removed from HN", "Story flagged/killed on HN", "Story deleted on HN" — all with gate_category='hn_removed'.
- **Content drift detection**: `content_hash` (SHA-256 first 16 bytes hex) written on primary eval via consumer-shared. `checkContentDrift()` in `content-drift.ts` re-fetches stories >7 days old, re-queues if hash changed. Triggered via `sweep=content_drift`. Self-posts excluded (user-mutable content).
- **Audit trail on item page**: `/item/[id]` merges `eval_history` + `events` into a unified chronological audit trail. Eval entries show model, score, token count, and **score drift** (delta badge when same model re-evaluated). `getEvalHistoryForStory()` in `db-stories.ts`.
- **Algolia backfill sweep**: `sweep=algolia_backfill` in cron.ts. Uses `searchAlgolia()` + `insertAlgoliaHits()` (now exported from `coverage-crawl.ts`). Parameters: `min_score` (default 500), `limit` (max 200), `days_back` (default 365).
- **Credit pause fallback**: When `credit_pause:anthropic` KV key is set, `enqueueForEvaluation` skips the Anthropic queue and dispatches to free model queues (Workers AI + free OpenRouter) instead. Light queue always fires regardless of credit state. `env` object passed through `runCrawlCycle` → `enqueueForEvaluation` to enable free-model fallback queue refs.
- **Feed filter/sort COALESCE**: `db-stories.ts` positive/negative/neutral filters and score_desc/asc sorts use `COALESCE(hcb_weighted_mean, hcb_editorial_mean)` so light-only stories surface correctly. Both score columns are semantically compatible for ordering (both editorial scale [-1,1]).
- **Score mode toggle**: `Base.astro` injects `body[data-score-mode]` (default `hrcb`, persisted in `localStorage('hrcb_score_mode')`). CSS rule `.tripartite-score .score-row[data-channel="hrcb"] .score-value` applies `font-size: var(--font-md); font-weight: bold` for the active channel. Buttons `.score-mode-btn[data-mode]` toggle the attribute. `index.astro` renders the HRCB | E | S toggle in the filter bar.
