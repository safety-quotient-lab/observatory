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
Cron Worker (1min) → Queue (hrcb-eval-queue) → Consumer Worker → D1 + R2
                                                      ↓ (on failure)
                                                DLQ Worker (hrcb-eval-dlq) → dlq_messages table
```

**Workers:**
- `site/functions/cron.ts` — HN crawling, score refresh, queue dispatch. Also serves `/trigger`, `/trigger?sweep=...`, `/calibrate`, `/calibrate/check`, `/health`.
- `site/functions/consumer.ts` — Fetches URL content, calls Claude API (Haiku), computes aggregates on CPU, writes to D1/R2. Proactive rate limit awareness via KV.
- `site/functions/dlq-consumer.ts` — Captures dead-lettered messages. Also serves `/replay` and `/replay/:id`.

**Wrangler configs:** `site/wrangler.cron.toml`, `site/wrangler.consumer.toml`, `site/wrangler.dlq.toml`

**Storage:**
- **D1** (`hrcb-db`): stories, scores, events, eval_history, fair_witness, domain_dcp, dlq_messages, calibration_runs, ratelimit_snapshots
- **KV** (`CONTENT_CACHE`): content cache, DCP cache, rate limit state per model
- **R2** (`hrcb-content-snapshots`): content snapshots for audit trail

### Site (Astro + Cloudflare Pages)

**Navigation:** `stories | rights | sources | trends | system | about` (6 hubs)

**Page taxonomy:**
- **Stories** (`/`): main feed, `/past` (archive by date), `/velocity`, `/dynamics`, `/item/[id]`
- **Rights** (`/rights`): hub → `/rights/observatory` (research dashboard), `/rights/articles`, `/rights/network`, `/article/[n]`
- **Sources** (`/sources`): hub → `/domains`, `/domain/[domain]`, `/users`, `/user/[username]`, `/factions`
- **Trends** (`/trends`): hub → `/seldon`
- **System** (`/system`): ops dashboard → `/models`
- **About** (`/about`)
- **Redirects** (301): `/dashboard`→`/system`, `/front`→`/past`, `/articles`→`/rights/articles`, `/network`→`/rights/network`, `/user-intel`→`/users`, `/domain-intel`→`/domains`

- `site/src/lib/db.ts` — Barrel re-export from `db-stories.ts`, `db-entities.ts`, `db-analytics.ts`, `db-multi-model.ts`
- `site/src/lib/db-stories.ts` — Story types, feed queries, dashboard stats, queue/failed stories
- `site/src/lib/db-entities.ts` — Domain/user queries, signal profiles, DCP, pipeline health, content gate stats, events re-exports
- `site/src/lib/db-analytics.ts` — Sparklines, histograms, scatter, velocity, daily HRCB, temporal patterns, observatory
- `site/src/lib/db-multi-model.ts` — Rater evals/scores/witness, model agreement, multi-model stories
- `site/src/lib/shared-eval.ts` — Barrel re-export from `eval-types.ts`, `models.ts`, `prompts.ts`, `eval-parse.ts`, `eval-write.ts`, `rater-health.ts`
- `site/src/lib/eval-types.ts` — Type definitions, interfaces, ALL_SECTIONS constant
- `site/src/lib/models.ts` — Model registry, provider types, queue bindings
- `site/src/lib/prompts.ts` — System prompts (full, slim, light)
- `site/src/lib/eval-parse.ts` — Response parsing, validation, content fetching
- `site/src/lib/eval-write.ts` — D1 write functions (eval results, DCP cache)
- `site/src/lib/rater-health.ts` — Per-model health tracking, auto-disable/re-enable
- `site/src/lib/events.ts` — Structured event logger with typed event taxonomy
- `site/src/lib/compute-aggregates.ts` — Deterministic aggregate computation (CPU-side)
- `site/src/lib/calibration.ts` — 15-URL calibration set + drift detection
- `site/src/lib/content-gate.ts` — Pre-eval content classification (paywall, captcha, bot protection, etc.)
- `site/src/lib/colors.ts` — Score/SETL/confidence/gate color mapping
- `site/src/components/` — Reusable Astro components (EvalCard, DcpTable, etc.)
- `site/functions/rate-limit.ts` — Rate limit state, capacity checks, credit pause
- `site/functions/providers.ts` — API call adapters (Anthropic, OpenRouter, Workers AI)

## Build & Deploy

All commands run from `site/`:

```bash
# Build site
npx astro build

# Deploy
npx wrangler pages deploy dist --project-name hn-hrcb     # site
npx wrangler deploy --config wrangler.cron.toml            # cron worker
npx wrangler deploy --config wrangler.consumer.toml        # consumer worker
npx wrangler deploy --config wrangler.dlq.toml             # DLQ worker

# Migrations
npx wrangler d1 migrations apply hrcb-db --remote

# Manual triggers (auth via .cron-secret)
curl -s -H "Authorization: Bearer $(cat .cron-secret)" https://hn-hrcb-cron.kashifshah.workers.dev/trigger
curl -s -X POST -H "Authorization: Bearer $(cat .cron-secret)" https://hn-hrcb-cron.kashifshah.workers.dev/calibrate
curl -s -X POST -H "Authorization: Bearer $(cat .cron-secret)" https://hn-hrcb-dlq.kashifshah.workers.dev/replay

# Sweep: retry failed evaluations (default limit 50, max 200)
curl -s -H "Authorization: Bearer $(cat .cron-secret)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=failed"

# Sweep: backfill skipped stories with score >= 100 (default min_score 50, default limit 50)
curl -s -H "Authorization: Bearer $(cat .cron-secret)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=skipped&min_score=100&limit=30"

# Sweep: coverage-driven crawl (all strategies or a specific one)
curl -s -H "Authorization: Bearer $(cat .cron-secret)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=coverage"
curl -s -H "Authorization: Bearer $(cat .cron-secret)" \
  "https://hn-hrcb-cron.kashifshah.workers.dev/trigger?sweep=coverage&strategy=domain_min_coverage"

# Health check (no auth)
curl -s https://hn-hrcb-cron.kashifshah.workers.dev/health

# Query D1 directly
npx wrangler d1 execute hrcb-db --remote --command "SELECT ..."

# Tail logs
npx wrangler tail --config wrangler.consumer.toml --format pretty
```

## Event Types

The pipeline logs structured events: `eval_success`, `eval_failure`, `eval_retry`, `eval_skip`, `rate_limit`, `self_throttle`, `credit_exhausted`, `fetch_error`, `parse_error`, `cron_run`, `cron_error`, `crawl_error`, `r2_error`, `dlq`, `dlq_replay`, `calibration`, `coverage_crawl`, `trigger`.

## Methodology Files

### Source Text
- `unudhr.txt` — Full UDHR text (Preamble + Articles 1-30)

### Methodology (version chain: v1 → v2 → v3 → v3.3 → v3.4)
- `methodology-v3.4.txt` — **Current canonical reference**
- `methodology-v3.1.prompt.md` — Self-contained LLM prompt for running evaluations
- Earlier versions: `methodology-v1.txt`, `methodology-v2.txt`, `methodology-v3.txt`, `methodology-v3.3.txt`

### Calibration
- `calibration-v3.1-set.txt` — 15-URL calibration set with expected score ranges
- `calibration-v3.1-baselines.txt` — Actual baseline evaluations for 9 calibration URLs

## Factions Page

The factions page (`site/src/pages/factions.astro`) clusters domains by **editorial character** using 8 supplementary signal dimensions (EQ, SO, SR, TD, PT inverted, AR, VA, FW) rather than the 31-dimension UDHR fingerprint.

**Algorithm:** Z-normalize per dimension → cosine similarity on 8D vectors → agglomerative hierarchical clustering with average linkage at 1/φ threshold (fallback to 1/φ² if single giant cluster).

**Page sections (top→bottom):** Signal Landscape (histograms) → Parallel Coordinates → Differentiation (inter-cluster variance) → Cluster Cards (radar charts, members, liminal flags) → Affinity Matrix → Interesting Pairs → Outliers → Methodology Notes.

**Archetype naming:** ~22 pattern rules (e.g., high EQ + TD + low PT → "Rigorous Analysts"), fallback to readable "High X/Y · Low Z" names.

**Key data flow:** `getDomainSignalProfiles(db)` → build raw vectors → z-normalize → cluster → enrich with archetypes, insights, radar data → render. The `getDomainSignalProfiles` query includes `avg_setl` via a SETL subquery.

## Key Patterns

- **Astro template gotcha**: Cannot use TypeScript generics with angle brackets (`Record<string, string>`) inside JSX template expressions — extract to frontmatter constants instead.
- **Consumer hash functions**: `hashString()` = SHA-256 first 16 bytes as hex (32 chars). Used for methodology_hash (system prompt only) and prompt_hash (system + user).
- **Rate limiting**: Consumer reads `anthropic-ratelimit-*` headers proactively, self-throttles via KV state before hitting 429s. Circuit breaker at 3+ consecutive 429s.
- **Calibration IDs**: Synthetic hn_ids -1001 to -1015 for the 15 calibration URLs.
- **DCP caching**: 7-day TTL in KV per domain, also persisted to `domain_dcp` table in D1.
- **Light prompt mode**: Small/free models (Workers AI Llama 4 Scout 17B, Nemotron Nano 30B) use `METHODOLOGY_SYSTEM_PROMPT_LIGHT` — editorial-only single score + 4 supplementary scores (~200-400 output tokens vs ~4-5K for full). Schema `light-1.1`. Controlled by `ModelDefinition.prompt_mode: 'full' | 'light'`. No structural channel, no per-section scores, no DCP, no Fair Witness evidence. Results written to `rater_evals` with `prompt_mode = 'light'` (no `rater_scores`/`rater_witness`). DB column `prompt_mode` (migration 0023) enables filtering light vs full evals.
- **Workers AI response format**: `ai.run()` may return `{ response: "string" }` or `{ response: { ...object } }` — consumer handles both.
- **Content gate columns**: `stories.gate_category` (TEXT, nullable) and `stories.gate_confidence` (REAL, nullable) — migration 0024. NULL = content was accessible. Written by `markSkipped()` when content gate blocks a URL. Surfaced on `/domain/[domain]` (Access Barriers), `/domains` (Most Gatekept card), `/sources` (Gated Content card), `/system` (Content Gates box). Query functions: `getDomainGateStats`, `getMostGatekeptDomains`, `getGlobalGateStats` in `db-entities.ts`.
