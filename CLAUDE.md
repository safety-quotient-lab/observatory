# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains the UN Universal Declaration of Human Rights (UDHR) text, an evolving methodology for evaluating websites' compatibility with it, and **a live Cloudflare-based pipeline** that automatically evaluates Hacker News stories. The methodology has progressed through three major versions (v1 → v2 → v3).

## Key Concepts

- **HRCB (HR Compatibility Bias)**: The core measured construct (v3+). Measures the directional lean of web content relative to UDHR provisions. Scale: [-1.0, +1.0].
- **Signal Channels**: Editorial (E) = what content says; Structural (S) = what the site does. Scored independently, combined with content-type-specific weights.
- **Domain Context Profile (DCP)**: Inherited modifiers from domain-level policies (privacy, ToS, accessibility, mission, ownership, access model, ad/tracking).
- **SETL (Structural-Editorial Tension Level)**: Measures divergence between E and S channel scores. High SETL = "says one thing, does another."
- **Fair Witness**: Each scored section includes `witness_facts` (observable) and `witness_inferences` (interpretive), enforcing evidence transparency.
- **Supplementary Signals**: 9 additional dimensions beyond HRCB — epistemic quality, propaganda flags, solution orientation, emotional tone, stakeholder representation, temporal framing, geographic scope, complexity level, transparency/disclosure.

## Architecture

### Pipeline (Cloudflare Workers + D1 + KV + R2 + Queues)

All infrastructure code lives under `site/`. See **`site/CLAUDE.md`** for full file inventory, storage schema, page taxonomy, and key patterns.

```
Cron Worker (1min) → Queues → 3 Provider-Specific Consumer Workers → D1 + R2
                                        ↓ (on failure)
                                  DLQ Worker (hrcb-eval-dlq) → dlq_messages table

  hrcb-eval-queue (1 queue)     → hn-hrcb-consumer-anthropic
  8 OpenRouter queues           → hn-hrcb-consumer-openrouter
  hrcb-eval-workers-ai (1 queue)→ hn-hrcb-consumer-workers-ai
```

**Workers:**
- `site/functions/cron.ts` — HN crawling, score refresh, queue dispatch. Serves `/trigger`, `/trigger?sweep=...`, `/calibrate`, `/calibrate/check`, `/health`. Dispatches sweeps via `SWEEP_HANDLERS` map in `sweeps.ts`.
- `site/functions/sweeps.ts` — 7 sweep handlers (`sweepFailed/Skipped/Coverage/ContentDrift/AlgoliaBackfill/RefreshDomainAggregates/BackfillPtScore`). Add new sweeps here + one entry in `SWEEP_HANDLERS` in `cron.ts`.
- `site/functions/consumer-shared.ts` — Shared types, content prep, result writing. Uses `isFirstFullEval` for first-eval housekeeping (R2 snapshot, content hash, DCP cache, archive).
- `site/functions/consumer-anthropic.ts` — Anthropic queue handler. Prompt caching, proactive rate limit tracking, 429/529/credit handling, truncation retry.
- `site/functions/consumer-openrouter.ts` — OpenRouter queue handler (8 model queues). Lite + full prompt modes.
- `site/functions/consumer-workers-ai.ts` — Workers AI queue handler. Free tier, no API key.
- `site/functions/dlq-consumer.ts` — Dead-letter capture. Serves `/replay` and `/replay/:id`.

**Wrangler configs:** `site/wrangler.toml` (Pages — `compatibility_date` must stay `2024-09-23`), `site/wrangler.cron.toml`, `site/wrangler.consumer-{anthropic,openrouter,workers-ai}.toml`, `site/wrangler.dlq.toml`. Real D1/KV IDs committed (not secrets). Secrets stay in `.dev.vars` (gitignored).

**Storage:** D1 (`hrcb-db`), KV (`CONTENT_CACHE`), R2 (`hrcb-content-snapshots`). See `site/CLAUDE.md` for full table/key schema.

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

# Sweep: bulk refresh all domain_aggregates materialized rows (202 Accepted, runs in waitUntil)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=refresh_domain_aggregates"

# Sweep: backfill pt_score from pt_flags_json for stories missing it (default limit 500, max 2000)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=backfill_pt_score&limit=2000"

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

The pipeline logs structured events: `eval_success`, `eval_failure`, `eval_retry`, `eval_skip`, `rate_limit`, `self_throttle`, `credit_exhausted`, `fetch_error`, `parse_error`, `cron_run`, `cron_error`, `crawl_error`, `r2_error`, `dlq`, `dlq_replay`, `calibration`, `coverage_crawl`, `trigger`, `auto_retry`, `dlq_auto_replay`, `auto_calibration`, `rater_auto_disable`, `dcp_stale`, `r2_cleanup`, `story_flagged`, `content_drift`, `model_divergence`, `setl_spike` (warn — domain avg_setl >0.3 AND jumped >0.15 vs yesterday; emitted by `sweep=setl_spikes`).

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

## Local Scripts

- `scripts/hn-hrcb-evaluate` — CLI evaluator: fetches pending stories from D1 (gate_category IS NULL guard), evaluates with `claude -p`, posts to `/api/ingest`. Flags: `--pending N`, `--failed N`, `--parallel N`, `--model MODEL`, `--domain D`, `--min-score N`, `--dry-run`, `--status`. Default model: `claude-haiku-4-5-20251001`. Rate limit detection resets story to pending + touches `.rate_limited` sentinel so daemon pauses 30 min. Per-eval 5-min timeout.
- `scripts/hn-hrcb-daemon` — Continuous evaluator: auto-launches tmux `hrcb-daemon`, loops the evaluator. **Adaptive parallelism** (default): auto-tunes `--parallel` based on stdout signals — ramp-up on all-ok, fast retreat on rate limits/failures, reset on empty queue. `--fixed` disables. Stop: `touch site/.daemon-stop`. Circuit breaker: 5 consecutive errors. Monitor: `grep "ADAPTIVE:" site/daemon.log`.
- `scripts/evaluate-standalone.mjs` — Fetch queue from `/api/queue`, evaluate with `claude -p`, post to `/api/ingest`. Modes: `--mode full` (default) or `--mode lite`. Must unset `ANTHROPIC_API_KEY` in spawn env (uses OAuth subscription). `--dry-run --url ... --hn-id ...` for spot-checking without server write.

**Lite calibration workflow:**
1. `curl -X POST .../calibrate?mode=lite` — inserts hn_ids -2001..-2015 as pending
2. `node scripts/evaluate-standalone.mjs --mode lite` — evaluates and posts to /api/ingest
3. `curl -X POST .../calibrate/check?mode=lite` — reads rater_evals, runs check, writes to calibration_runs
