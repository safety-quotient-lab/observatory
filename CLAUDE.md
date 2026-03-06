# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mission

**Human rights pedagogy through utility.** Users learn UDHR provisions by encountering them naturally while doing something they already want to do — following tech news. The teaching is a side effect of the tool being useful.

The most mission-aligned features aggregate invisible patterns into visible statements about rights — "34% of stories identify their author" (transparency), "privacy and expression are anti-correlated in tech content" (rights tension), "average jargon density excludes non-experts" (accessibility). These transform the site from "a score per story" into a mirror for how the tech ecosystem relates to human rights. That's the pedagogical leap.

**Decision filter:** When evaluating features, prioritize work that helps users learn about UDHR provisions as a side effect of utility. Features that surface invisible rights patterns (Tier 1 in `IDEAS.md`) take priority over pure infrastructure (Tier 3) when effort is comparable.

## Overview

This repository contains the UN Universal Declaration of Human Rights (UDHR) text, an evolving methodology for evaluating websites' compatibility with it, and **a live Cloudflare-based pipeline** that automatically evaluates Hacker News stories. The methodology has progressed through three major versions (v1 → v2 → v3).

## Key Concepts

- **HRCB (HR Compatibility Bias)**: The core measured construct (v3+). Measures the directional lean of web content relative to UDHR provisions. Scale: [-1.0, +1.0].
- **Signal Channels**: Editorial (E) = what content says; Structural (S) = what the site does. Scored independently, combined with content-type-specific weights.
- **Domain Context Profile (DCP)**: Inherited modifiers from domain-level policies (privacy, ToS, accessibility, mission, ownership, access model, ad/tracking).
- **SETL (Structural-Editorial Tension Level)**: Measures divergence between E and S channel scores. High SETL = "says one thing, does another."
- **Fair Witness**: Each scored section includes `witness_facts` (observable) and `witness_inferences` (interpretive), enforcing evidence transparency.
- **Supplementary Signals**: 10 additional dimensions beyond HRCB — epistemic quality, propaganda flags, solution orientation, emotional tone, stakeholder representation, temporal framing, geographic scope, complexity level, transparency/disclosure, rights tensions (RTS).
- **RTS (Rights Tension Signature)**: Dedicated field in full eval output — up to 3 pairs of UDHR articles in genuine tension, with a label describing how the content resolves each. Full eval only (lite models excluded). Stored as JSON in `stories.rts_tensions_json`; count in `rater_evals.rts_tension_count`.

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
- `site/functions/sweeps.ts` — 15 sweep handlers (`sweepFailed/Skipped/Coverage/ContentDrift/AlgoliaBackfill/RefreshDomainAggregates/BackfillPtScore/SetlSpikes/RefreshUserAggregates/ExpandFromSubmitted/RefreshArticlePairStats/LiteReeval/RefreshConsensusScores/UpgradeLite/BrowserAudit`). Add new sweeps here + one entry in `SWEEP_HANDLERS` in `cron.ts`.
- `site/functions/consumer-shared.ts` — Shared types, content prep, result writing. Uses `isFirstFullEval` for first-eval housekeeping (R2 snapshot, content hash, DCP cache, archive).
- `site/functions/consumer-anthropic.ts` — Anthropic queue handler. Prompt caching, proactive rate limit tracking, 429/529/credit handling, truncation retry.
- `site/functions/consumer-openrouter.ts` — OpenRouter queue handler (8 model queues). Lite + full prompt modes.
- `site/functions/consumer-workers-ai.ts` — Workers AI queue handler. Free tier, no API key.
- `site/functions/dlq-consumer.ts` — Dead-letter capture. Serves `/replay` and `/replay/:id`.
- `site/functions/browser-audit.ts` — CF Browser Rendering queue handler. Puppeteer headless audit of domains: tracker counting (CDP network interception), security headers (HSTS/CSP), accessibility (lang/skip-nav/alt), consent patterns (cookie banners, dark patterns). Writes `domain_browser_audit` table, derives `br_*` DCP elements.

**Wrangler configs:** `site/wrangler.toml` (Pages — `compatibility_date` must stay `2024-09-23`), `site/wrangler.cron.toml`, `site/wrangler.consumer-{anthropic,openrouter,workers-ai}.toml`, `site/wrangler.dlq.toml`, `site/wrangler.browser-audit.toml`. Real D1/KV IDs committed (not secrets). Secrets stay in `.dev.vars` (gitignored).

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
npx wrangler deploy --config wrangler.browser-audit.toml   # Browser audit worker

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

# Sweep: detect SETL spikes (stories where editorial/structural channels diverge anomalously)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=setl_spikes"

# Sweep: bulk refresh all user_aggregates materialized rows (202 Accepted, runs in waitUntil)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=refresh_user_aggregates"

# Sweep: expand from submitted — insert missing story-type items from top-karma users' submitted arrays
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=expand_from_submitted"

# Sweep: re-evaluate lite-1.4 stories under lite-1.5 prompt (two-dimension scoring)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=lite_reeval&limit=50"

# Sweep: bulk recompute consensus scores for all stories with ≥2 done rater_evals (202 Accepted, runs in waitUntil)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=refresh_consensus_scores"

# Sweep: promote lite-only stories (no full eval yet) with hn_score >= min_score to pending for full eval (default min_score=50, limit=50)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=upgrade_lite&min_score=100&limit=50"

# Sweep: dispatch domains for headless browser audit (CF Browser Rendering)
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=browser_audit&limit=20"

# Sweep: audit a single domain
curl -s -H "Authorization: Bearer $(grep '^TRIGGER_SECRET=' site/.dev.vars | cut -d= -f2-)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=browser_audit&domain=example.com"

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

The pipeline logs structured events: `eval_success`, `eval_failure`, `eval_retry`, `eval_skip`, `rate_limit`, `self_throttle`, `credit_exhausted`, `fetch_error`, `cron_run`, `cron_error`, `crawl_error`, `r2_error`, `dlq`, `dlq_replay`, `calibration`, `coverage_crawl`, `trigger`, `rater_validation_warn`, `rater_validation_fail`, `rater_auto_disable`, `rater_auto_enable`, `auto_retry`, `dlq_auto_replay`, `auto_calibration`, `dcp_stale`, `r2_cleanup`, `story_flagged`, `content_drift`, `model_divergence`, `setl_spike`.

## Methodology Files

### Source Text
- `unudhr.txt` — Full UDHR text (Preamble + Articles 1-30)

### Methodology (version chain: v1 → v2 → v3 → v3.3 → v3.4)
- `methodology-v3.4.txt` — **Current canonical reference**
- `methodology-v3.1.prompt.md` — Self-contained LLM prompt for running evaluations
- `site/public/.well-known/methodology.json` — Machine-readable scoring spec (weights, SETL formula, evidence caps, PTC-18 tiers). Also served at `/api/v1/methodology`.
- Earlier versions: `methodology-v1.txt`, `methodology-v2.txt`, `methodology-v3.txt`, `methodology-v3.3.txt`

### Calibration
- `calibration-v3.1-set.txt` — 15-URL calibration set with expected score ranges (full model)
- `calibration-v3.1-baselines.txt` — Actual baseline evaluations for 9 calibration URLs

## Local Scripts

- `scripts/hn-hrcb-evaluate` — CLI evaluator: fetches pending stories from D1 (gate_category IS NULL guard), evaluates with `claude -p`, posts to `/api/ingest`. Flags: `--pending N`, `--failed N`, `--parallel N`, `--model MODEL`, `--domain D`, `--min-score N`, `--dry-run`, `--status`. Default model: `claude-haiku-4-5-20251001`. Rate limit detection resets story to pending + touches `.rate_limited` sentinel so daemon pauses 30 min. Per-eval 5-min timeout.
- `scripts/hn-hrcb-daemon` — Continuous evaluator: auto-launches tmux `hrcb-daemon`, loops the evaluator. **Adaptive parallelism** (default): auto-tunes `--parallel` based on stdout signals — ramp-up on all-ok, fast retreat on rate limits/failures, reset on empty queue. `--fixed` disables. Stop: `touch site/.daemon-stop`. Circuit breaker: 5 consecutive errors. Monitor: `grep "ADAPTIVE:" site/daemon.log`.
- `scripts/evaluate-standalone.mjs` — Fetch queue from `/api/queue`, evaluate with `claude -p`, post to `/api/ingest`. Modes: `--mode full` (default) or `--mode lite`. Must unset `ANTHROPIC_API_KEY` in spawn env (uses OAuth subscription). `--dry-run --url ... --hn-id ...` for spot-checking without server write.
- `scripts/external-feedback.mjs` — External AI feedback tool (REPL + non-interactive). Sends site context (agent-card, manifest, architecture summary), receives structured JSON feedback, fact-checks against known truths. Providers: `--provider openrouter` (default, free models), `--provider gemini`, `--provider wolfram` (computational queries, 2K free/mo), `--provider kagi` (FastGPT AI search with citations; `--model summarize` for URL/text summarization). Non-interactive: `--prompt "..."` outputs JSON to stdout for Claude Code to parse. REPL commands: `.save`, `.context`, `.eval`, `.model`, `.quit`. Flags: `--provider`, `--model`, `--prompt`, `--dry-run`, `--resume FILE`, `--save NAME`, `--follow-up`. Rate limit retry (once). Saves to `.claude/plans/memorized/gemini-exchanges/`. Keys: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `WOLFRAMALPHA_APP_ID`, or `KAGI_API_KEY` in `site/.dev.vars`.
- `scripts/epistemic-benchmark.mjs` — Epistemic fitness benchmark for free LLM models. Tests 3 dimensions: confabulation (4 probes with site context), eval quality (3 calibration stories), structured output compliance (JSON schema validation). Discovers free models from OpenRouter API. Flags: `--models`, `--dim 1|2|3|all`, `--dry-run`, `--skip-workers-ai`, `--skip-d1`, `--limit-models N`, `--verbose`. Output: ASCII table + JSON report (`findings/epistemic-benchmark-*.json`) + D1 longitudinal table (`model_epistemic_fitness`). Composite score: 0.4×confab + 0.3×eval + 0.3×output. Grades: A≥0.80 (ready), B≥0.60 (review), C≥0.40 (caution), D≥0.20 (poor), F<0.20 (unfit). Key: `OPENROUTER_API_KEY` in `site/.dev.vars`.
- `scripts/detect-cogarch-win.mjs` — Cogarch win detector: reads latest session JSONL, extracts thinking blocks + tool calls + user messages, runs Haiku analysis to identify moments where a cognitive trigger produced a measurably better outcome. Writes scaffold to `.claude/plans/memorized/blog/cogarch-wins/`, appends to `~/.claude/.../memory/cogarch-wins-log.jsonl`. Dedup by trigger+mechanism, 30-day window. Flags: `--session <path>`, `--dry-run`, `--threshold <n>`. Run at cycle end (step 12.5).

**Lite calibration workflow:**
1. `curl -X POST .../calibrate?mode=lite` — inserts hn_ids -2001..-2015 as pending
2. `node scripts/evaluate-standalone.mjs --mode lite` — evaluates and posts to /api/ingest
3. `curl -X POST .../calibrate/check?mode=lite` — reads rater_evals, runs check, writes to calibration_runs
