# Database Schema

D1 database `hrcb-db`. 55 migrations applied. Tables listed by function.

## Core Evaluation

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `stories` | HN story metadata + consensus scores | `hn_id` PK, `hcb_weighted_mean`, `hcb_editorial_mean`, `hcb_structural_mean`, `hcb_setl`, `eval_status`, `gate_category` |
| `rater_evals` | Per-model evaluation results | `hn_id`, `eval_model`, `eval_provider`, `prompt_mode`, `hcb_*` scores, supplementary signals (`eq_score`, `so_score`, `sr_score`, `td_score`, `pt_score`, `et_*`), UNIQUE(hn_id, eval_model) |
| `rater_scores` | Per-section per-model UDHR provision scores | `hn_id`, `section`, `eval_model`, `editorial`, `structural`, `evidence`, `witness_facts`, PK(hn_id, section, eval_model) |
| `rater_witness` | Fair Witness evidence (facts + inferences) | `hn_id`, `eval_model`, `section`, `fact_type` ('observable'\|'inference'), `fact_text` |

## Aggregates (materialized views)

| Table | Purpose | Refresh trigger |
|-------|---------|-----------------|
| `domain_aggregates` | Per-domain signal averages | On eval write + sweep |
| `user_aggregates` | Per-user contribution statistics | On eval write + sweep |
| `domain_profile_snapshots` | Daily domain trend snapshots | Daily cron, PK(domain, snapshot_date) |
| `daily_section_stats` | Per-day per-provision score rollups | On eval write, PK(day, section) |

## Pipeline Infrastructure

| Table | Purpose |
|-------|---------|
| `eval_queue` | Pull-model dispatch, UNIQUE(hn_id, target_provider, target_model) |
| `events` | Structured event log (eval_success, rate_limit, cron_run, etc.) |
| `dlq_messages` | Dead letter queue for failed evaluations |
| `model_registry` | Toggle models via D1 without code deploys |
| `ratelimit_snapshots` | Rate limit state monitoring |
| `batches` | Anthropic Batch API submission tracking |

## Reference Data

| Table | Purpose |
|-------|---------|
| `hn_users` | HN user profile cache (karma, created, submitted_count) |
| `domain_dcp` | Domain Context Profile cache (7-day TTL) |
| `story_feeds` | Which HN feeds each story appeared on |
| `calibration_runs` | Calibration session metadata and results |
| `calibration_evals` | Longitudinal per-slot calibration scores |

## Scoring Modes

| Mode | Schema version | Scale | Channels | Supplementary signals |
|------|---------------|-------|----------|----------------------|
| Full | `3.7` | [-1.0, +1.0] | Editorial + Structural | All 9 |
| Lite | `lite-1.4` | 0-100 integer (50=neutral) | Editorial only | Subset (EQ, SO, TD, tone) |

Consensus: `hcb_weighted_mean` = confidence-weighted average across enabled models.
SETL: `abs(editorial - structural)` — "says one thing, does another."

## Versioning

Schema changes are managed via numbered migrations in `site/migrations/`.
All changes are additive (new columns, new tables) — no destructive migrations.
