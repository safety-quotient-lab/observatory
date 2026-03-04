# HN-HRCB Data Flow
*Generated 2026-03-04. Source of truth: `site/functions/` + `site/src/lib/`.*

---

## Overview

The pipeline ingests Hacker News stories, evaluates each URL against the UDHR via LLMs, and serves results through a public web observatory and REST API. It runs entirely on Cloudflare infrastructure — no servers, no queues to manage manually.

```
  HN Firebase API
       │
       ▼
 ┌─────────────┐   every minute   ┌──────────────────────────────────────────┐
 │ Cron Worker │ ───────────────► │  Scheduled Tasks (cron.ts)               │
 │  (cron.ts)  │                  │                                          │
 └─────────────┘                  │  every min:   HN crawl + enqueue         │
                                  │  every 5min:  multi-model dispatch       │
                                  │               homepage blob              │
                                  │               coverage crawl             │
                                  │  every 10min: auto-retry failed          │
                                  │               model comparison blob      │
                                  │               flagged story check        │
                                  │  every 30min: domain aggregate self-heal │
                                  │  every 60min: DCP staleness alert        │
                                  │               DLQ auto-replay            │
                                  │  weekly:      auto-calibration           │
                                  └──────────────────────────────────────────┘
```

---

## Phase 1 — Ingestion

```
HN Firebase API (top/best/new)
  │
  ├── GET /v0/topstories.json    ─┐
  ├── GET /v0/beststories.json    ├─► runCrawlCycle() [hn-bot.ts]
  └── GET /v0/newstories.json    ─┘
           │
           ▼
    Diff against D1 stories table
    (already known? → score refresh only)
           │
      new stories
           │
           ▼
    enqueueForEvaluation() [hn-bot.ts]
    ┌─────────────────────────────────────────────────────┐
    │  1. Fetch content (or pull from KV content cache)   │
    │  2. Content gate check [content-gate.ts]            │
    │     → paywall / bot_protection / age_gate / etc.    │
    │     → gated? → mark skipped, write gate_category    │
    │  3. INSERT OR IGNORE into stories                   │
    │  4. Guard: gate_category IS NULL                    │
    │  5. INSERT OR IGNORE into eval_queue                │
    │     (UNIQUE on hn_id + provider + model)            │
    └─────────────────────────────────────────────────────┘
           │
           ▼
    eval_queue (D1 table)
    PK: (hn_id, target_provider, target_model)
    stale claims auto-recovered after 5 min
```

**Content gate taxonomy** (regex, no LLM):
```
paywall          bot_protection    captcha
login_wall       cookie_wall       geo_restriction
age_gate         app_gate          rate_limited
error_page       redirect_or_js_required
binary_content   js_rendered       no_content
hn_removed
```

---

## Phase 2 — Queue Dispatch

```
eval_queue (D1)
    │
    ├── Anthropic stories ──────────────────► hrcb-eval-queue (CF Queue)
    │   (primary model, full prompt)          │
    │                                         ▼
    │                               hn-hrcb-consumer-anthropic
    │
    ├── OpenRouter stories ──────────────────► 8 model-specific queues (CF Queues)
    │   (8 models, full prompt)               │
    │                                         ▼
    │                               hn-hrcb-consumer-openrouter
    │
    └── Workers AI stories ─────────────────► hrcb-eval-workers-ai (CF Queue)
        (llama-4-scout + llama-3.3-70b,       │
         lite prompt, FREE)                   ▼
                                    hn-hrcb-consumer-workers-ai

                                         on failure
                                             │
                                             ▼
                                    hrcb-eval-dlq → dlq_messages (D1)
```

**Dispatch cadence:**
- Primary model (Anthropic Haiku): every cron tick via `runCrawlCycle()`
- Free models (Workers AI): every 5 min via `dispatchFreeModelEvals()` — up to 50 per model per cycle
- Multi-model (OpenRouter): also dispatched from `dispatchFreeModelEvals()`

---

## Phase 3 — Evaluation (per consumer)

All three consumers share the same core logic via `consumer-shared.ts`:

```
CF Queue message arrives
    │
    ▼
claimFromEvalQueue()        ← pull-model: claim row from eval_queue,
    │                          set claimed_at. Stale >5min auto-recovered.
    ▼
prepareEvalContent()        ← fetch URL content, truncate to model.max_input_chars
    │                          content-gate safety check (second pass)
    ▼
Build system prompt
    ├── full prompt (Haiku, OpenRouter):  METHODOLOGY_SYSTEM_PROMPT
    └── lite prompt (Workers AI):         METHODOLOGY_SYSTEM_PROMPT_LITE

    ▼
LLM API call
    ├── Anthropic: callClaude() [evaluate.ts] — 90s AbortController timeout
    │             prompt caching (system prompt cached)
    │             429/529 → rate limit state → KV → self-throttle
    │             credit_exhausted → credit_pause:anthropic KV (10 min)
    │
    ├── OpenRouter: 8 queues × 1 model = parallel model coverage
    │              15s AbortController timeout [providers.ts]
    │
    └── Workers AI: ai.run() — free tier, no API key
                   response: { response: "string" } or { response: {...} }

    ▼
validateEvalResponse() / validateLiteEvalResponse() [eval-parse.ts]
    │
    ├── full: validateSlimEvalResponse()
    │         evidence-level score caps (H≤1.0, M≤0.7, L≤0.4)
    │         schema_version check (MAJOR.MINOR pattern)
    │
    └── lite-1.6 (isV16 block):
         editorial (0-100) → normalize to [-1, +1]
         5 TQ binaries: tq_author/date/sources/corrections/conflicts
         tq_score = sum / 5
         content-type guard → TQ structural proxy injection:
           ED/HR/MI/PO: ev.structural = tq_score * 2 - 1
           LP/AD/CO/PR/AC/ME/MX: ev.structural = undefined (editorial-only)

    ▼
isFirstFullEval check [consumer-shared.ts]
    ├── R2 snapshot (audit trail)
    ├── content_hash written (for drift detection)
    └── DCP cache population
```

---

## Phase 4 — Writing Results

```
writeRaterEvalResult() [eval-write.ts]
    │
    ├── INSERT OR REPLACE INTO rater_evals
    │   (hn_id, eval_model, schema_version, editorial, structural,
    │    tq_author, tq_date, tq_sources, tq_corrections, tq_conflicts,
    │    tq_score, eq_score, pt_score, pt_flags_json, reasoning, ...)
    │
    ├── INSERT INTO rater_scores (per-section scores)
    │   (hn_id, eval_model, section_name, score, evidence_level, ...)
    │
    ├── INSERT INTO rater_witness (fair witness pairs)
    │   (hn_id, eval_model, section_name, witness_facts, witness_inferences)
    │
    ├── INSERT INTO eval_history (append-only audit trail)
    │   (hn_id, eval_model, hcb_editorial, hcb_structural, hcb_weighted_mean, ...)
    │
    ├── updateConsensusScore() → UPDATE stories
    │   weight = baseWeight × confidenceFactor × truncDiscount × neutralDiscount
    │   baseWeight: full=1.0, lite=0.5
    │   neutralDiscount: 0.5 for Llama lazy-neutral (editorial=0.0 + conf≥0.7)
    │   filters: model_registry.enabled=1 only
    │
    └── writeEvalResult() → UPDATE stories
        (hcb_weighted_mean, hcb_editorial_mean, hcb_structural_mean,
         eval_status='done', eval_model, eval_time, ...)
```

**Lite eval path** (`writeLiteRaterEvalResult`):
```
COALESCE fill-in UPDATE to stories (nulls only)
Does NOT promote eval_status to 'done'
Does NOT overwrite a full eval's scores
```

---

## Phase 5 — Aggregation & Serving

```
D1 (hrcb-db)
    │
    ├── Materialized tables (pre-computed aggregates)
    │   ├── domain_aggregates  — avg_hrcb, evaluated_count, story_count
    │   │   refresh: every 30min self-heal + sweep=refresh_domain_aggregates
    │   ├── user_aggregates    — avg_editorial_full, avg_editorial_lite
    │   │   refresh: on write + sweep=refresh_user_aggregates
    │   └── domain_profile_snapshots — daily snapshots per domain
    │       trigger: once/day per domain (KV guard)
    │
    ├── KV (CONTENT_CACHE) — pre-computed blobs
    │   ├── sys:homepage        ← computeHomepageBlob()  every 5min
    │   ├── sys:models:comparison ← computeModelComparisonBlob() every 10min
    │   ├── sys:factions        ← computeFactionsData()  120s TTL
    │   ├── sys:sourceMetrics   ← computeSourceMetrics() 120s TTL
    │   ├── sys:tdSignalAggregates    300s TTL
    │   ├── sys:complexityAggregates  600s TTL
    │   └── sys:temporalFramingAggregates 600s TTL
    │
    └── Astro SSR Pages (CF Pages)
        ├── readDb(db) → nearest replica (Sessions API, first-unconstrained)
        │   used on all read-only page routes
        └── writeDb(db) → primary (first-primary, read-after-write consistency)
            used on ingest, calibrate, trigger endpoints

Public REST API: observatory.unratified.org/api/v1/
    stories, story/[id], domains, domain/[domain], domain/[domain]/history,
    signals, users, user/[username]
    → CORS *, 200 req/hr IP rate limit, RFC 7807 error responses
```

---

## Full System Map

```
                        HN Firebase API
                              │
                    ┌─────────▼──────────┐
                    │   Cron Worker      │  every minute
                    │  (cron.ts)         │  wrangler.cron.toml
                    └────────────────────┘
                         │         │
              new stories│         │multi-model (every 5min)
                         ▼         ▼
              ┌──────────────────────────────────────────┐
              │              eval_queue (D1)             │
              │  UNIQUE(hn_id, target_provider, model)   │
              └───────────┬──────────┬───────────────────┘
                          │          │                │
                 Anthropic│   OpenRouter (8 queues)   │Workers AI
                          ▼          ▼                ▼
              ┌───────────┐  ┌───────────┐  ┌────────────────┐
              │ consumer  │  │ consumer  │  │  consumer      │
              │ anthropic │  │ openrouter│  │  workers-ai    │
              │ (haiku)   │  │ (8 models)│  │ (llama-scout   │
              │ full prompt│  │full prompt│  │  llama-70b)    │
              │ $$ API    │  │ $$ API    │  │  lite prompt   │
              └─────┬─────┘  └─────┬─────┘  └───────┬────────┘
                    │              │                  │
                    └──────────────┴──────────────────┘
                                   │
                    on failure      │
                    ┌──────────────►│◄── DLQ auto-replay (hourly)
                    │  dlq_messages │
                    │              ▼
                    │      ┌───────────────────────────────────┐
                    │      │        D1: hrcb-db                │
                    │      │                                   │
                    │      │  stories  rater_evals  rater_scores│
                    │      │  rater_witness  eval_history      │
                    │      │  domain_aggregates user_aggregates│
                    │      │  model_registry  calibration_runs │
                    │      └───────────────┬───────────────────┘
                    │                      │
                    │            ┌─────────┴──────────┐
                    │            │    KV pre-compute   │
                    │            │  (blobs every 5-10m)│
                    │            └─────────┬───────────┘
                    │                      │
                    └──────────────────────┼───────────────────
                                           ▼
                              ┌─────────────────────────┐
                              │  Astro SSR (CF Pages)   │
                              │  observatory.unratified  │
                              │  .org                   │
                              │                         │
                              │  /  /stories /signals   │
                              │  /sources /rights /about│
                              │  /status /search        │
                              │  /api/v1/ (public REST) │
                              └─────────────────────────┘
```

---

## Sweep Catalog (manual triggers)

All sweeps are HTTP-triggered (`/trigger?sweep=<name>`) or called from cron on schedule.

| Sweep | Purpose | Automated? | When to run manually |
|-------|---------|-----------|---------------------|
| `failed` | Retry failed evals (score≥50, <7 days) | Yes — every 10min | Force-retry specific batch |
| `skipped` | Backfill gated stories by score threshold | No | Ad hoc |
| `coverage` | Coverage-driven Algolia crawl | Yes — every minute (rotates strategies) | Force specific strategy |
| `content_drift` | Re-eval stories whose content changed | No | After major site redesigns |
| `algolia_backfill` | Historical HN stories by score | No | Onboarding new date ranges |
| `refresh_domain_aggregates` | Recompute domain_aggregates table | Yes — every 30min self-heal | After schema migration |
| `backfill_pt_score` | Fill pt_score from pt_flags_json | No | One-time migration |
| `setl_spikes` | Flag structural/editorial divergence | No | Ad hoc analysis |
| `refresh_user_aggregates` | Recompute user_aggregates table | On write triggers | After bulk imports |
| `expand_from_submitted` | Insert stories from top-karma user histories | No | Coverage gaps |
| `refresh_article_pair_stats` | Update article co-occurrence pairs | No | Ad hoc |
| `lite_reeval` | **Upgrade lite-1.4 stories to current schema** | **No — migration only** | Until 0 candidates returned |
| `refresh_consensus_scores` | Recompute weighted ensemble scores | No | After model enable/disable |
| `upgrade_lite` | Queue lite-only stories for full Haiku eval | No | Coverage improvement |

---

## On Automating `lite_reeval`

**Short answer: not needed, and not appropriate.**

`lite_reeval` is a one-time migration sweep. It finds stories where `rater_evals.schema_version IN ('lite-1.4', 'lite', 'light-1.4')` and re-enqueues them for Workers AI under the current lite schema (lite-1.6).

Once all historical stories are re-evaluated, the sweep returns `{ dispatched: 0, note: 'No lite-1.4 evals found' }` and is a no-op.

**New stories already get lite evals automatically:**

```
Every 5 minutes in cron cycle:
    dispatchFreeModelEvals(db, env, 50)
        │
        ▼
    For each enabled Workers AI model:
        SELECT pending/failed stories not yet in eval_queue
        INSERT OR IGNORE into eval_queue
        → Workers AI consumer picks up and evaluates
```

The `lite_reeval` sweep exists because of a schema upgrade (lite-1.5 → lite-1.6 added TQ binaries). Once the backlog of old-schema stories is cleared, the sweep is done. Monitor with:

```bash
npx wrangler d1 execute hrcb-db --remote --command \
  "SELECT schema_version, COUNT(*) as n FROM rater_evals \
   WHERE prompt_mode='lite' GROUP BY schema_version ORDER BY n DESC"
```

When `lite-1.4` count reaches 0, the sweep is complete.

---

## Score Lifecycle

```
story.eval_status:
  pending → queued → (evaluating*) → done | failed | skipped | rescoring

                                    *SSE trigger path only

scores on stories table:
  hcb_weighted_mean    ← consensus score (multi-model weighted average)
  hcb_editorial_mean   ← primary model editorial channel
  hcb_structural_mean  ← primary model structural channel

  Full eval:  all three populated. eval_status = 'done'.
  Lite eval:  hcb_editorial_mean only (COALESCE fill-in).
              eval_status NOT promoted.
              displayScore = hcb_weighted_mean ?? hcb_editorial_mean

consensus weight formula:
  weight = baseWeight × confidenceFactor × truncDiscount × neutralDiscount
  baseWeight:        full=1.0  lite=0.5
  confidenceFactor:  max(0.2, COALESCE(confidence, 0.5))
  truncDiscount:     1 - truncPct × 0.5
  neutralDiscount:   0.5 if Llama lazy-neutral (editorial=0.0 + conf≥0.7)
                     1.0 otherwise
```

---

## Calibration Flow

```
Full model calibration (weekly auto-calibration, Sunday 03:00 UTC):
  POST /calibrate
    → deletes eval_history + rater_* for hn_ids -1001..-1015
    → re-enqueues via EVAL_QUEUE (Anthropic Haiku)
    → consumer evaluates, writes to DB
  POST /calibrate/check
    → reads rater_evals for cal hn_ids
    → runCalibrationCheck() vs CALIBRATION_SET + DRIFT_THRESHOLDS
    → writes to calibration_runs table
    → returns pass/warn/fail + per-URL results

Lite model calibration (manual):
  POST /calibrate?mode=lite
    → deletes lite rater_evals for hn_ids -2001..-2015
    → inserts pending stories
  node scripts/evaluate-standalone.mjs --mode lite
    → fetches queue from /api/queue
    → evaluates with claude-haiku (local, unset ANTHROPIC_API_KEY in spawn env)
    → posts to /api/ingest
  POST /calibrate/check?mode=lite
    → reads rater_evals (prompt_mode='lite') for cal hn_ids
    → runCalibrationCheck() vs LITE_CALIBRATION_SET + LITE_DRIFT_THRESHOLDS
    → writes calibration_run, returns results
```

---

*Full source: `site/functions/cron.ts`, `site/functions/sweeps.ts`, `site/functions/consumer-{anthropic,openrouter,workers-ai}.ts`, `site/src/lib/eval-parse.ts`, `site/src/lib/eval-write.ts`, `site/src/lib/hn-bot.ts`*
