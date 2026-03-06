# Lite Prompt Evolution: Lazy-Neutral Bias Analysis

**Date:** 2026-03-06
**Scope:** Longitudinal analysis of lite-1.4 → lite-1.5 → lite-1.6 prompt versions
**Related:** `2026-03-02-llama-neutral-50-bias.md` (original diagnosis)

## Summary

lite-1.5 (two-dimension editorial/structural split) was the most effective fix for Llama lazy-neutral bias, reducing zero-score rates from ~66% to ~2%. lite-1.6 (editorial 0-100 + TQ binary) partially regressed (18-29% zeros) but this is moot — the old lite HRCB models are now disabled, superseded by PSQ (lite-v2) variants.

The `upgrade_lite` sweep found **zero candidates** — all stories with `hn_score >= 50` already have full evals. The pipeline's natural full-eval coverage has absorbed all promotable stories.

## Per-Version Zero-Score Rates

All models, `prompt_mode = 'lite'`, `eval_status = 'done'`, `hn_id > 0`:

| Version | n | Zero% | Avg Score |
|---------|-----|-------|-----------|
| lite-1.0 | 61 | 52.5% | +0.085 |
| lite-1.1 | 183 | 64.5% | +0.001 |
| lite-1.2 | 127 | 55.1% | +0.263 |
| lite-1.3 | 333 | 67.6% | +0.180 |
| **lite-1.4** | **5,465** | **66.2%** | **+0.095** |
| **lite-1.5** | **948** | **2.2%** | **+0.095** |
| **lite-1.6** | **1,278** | **23.5%** | **-0.115** |

## Per-Model Breakdown (lite-1.4 through lite-1.6)

| Version | Model | n | Zero% | Avg Score |
|---------|-------|-----|-------|-----------|
| lite-1.4 | llama-3.3-70b-wai | 2,824 | 69.2% | +0.087 |
| lite-1.4 | llama-4-scout-wai | 2,573 | 63.3% | +0.104 |
| lite-1.4 | claude-haiku-4-5 | 68 | 52.9% | +0.109 |
| lite-1.5 | llama-3.3-70b-wai | 465 | 1.7% | +0.085 |
| lite-1.5 | llama-4-scout-wai | 469 | 2.3% | +0.104 |
| lite-1.5 | claude-haiku-4-5 | 14 | 14.3% | +0.145 |
| lite-1.6 | llama-3.3-70b-wai | 639 | 29.0% | -0.089 |
| lite-1.6 | llama-4-scout-wai | 638 | 17.9% | -0.142 |

## Key Findings

### 1. lite-1.5 fixed the lazy-neutral problem

The two-dimension split (editorial + structural as separate holistic scores) reduced Llama zero-score rates from ~66% to ~2%. This confirms the hypothesis from `2026-03-02-llama-neutral-50-bias.md`: Llama needed explicit score decomposition to engage with UDHR signals rather than defaulting to "50" (neutral).

### 2. lite-1.6 partially regressed

lite-1.6 (editorial 0-100 + TQ 5 binary indicators) shows 18-29% zeros. However:
- The avg scores shifted **negative** (-0.089 to -0.142), unlike lite-1.4's positive bias (+0.087 to +0.104)
- This suggests lite-1.6 zeros may represent a different phenomenon (genuine neutral assessment under a different rubric) rather than the original lazy-neutral failure mode
- 305 lite-1.6 zero-scored stories exist, but **none** have full evals for cross-validation
- HN score range of these zeros: 1-2345 (avg 135) — not concentrated in low-engagement stories

### 3. lite-1.6 regression is moot

Both `llama-3.3-70b-wai` and `llama-4-scout-wai` are **disabled** in model_registry (reason: "superseded by -psq variant"). Active WAI models (`llama-3.3-70b-wai-psq`, `llama-4-scout-wai-psq`, `qwen3-30b-a3b-wai-psq`) run PSQ (lite-v2), not lite HRCB. No new lite-1.6 evals are being produced.

### 4. upgrade_lite has zero candidates

Query: stories with `eval_status = 'done'`, `hn_score >= 50`, `gate_category IS NULL`, `url IS NOT NULL`, with lite evals but no full eval.

**Result: 0 stories.** Even removing the score filter: 0 stories. The pipeline's natural full-eval coverage (via Claude Haiku, OpenRouter models) has absorbed all stories. The upgrade_lite sweep remains available as infrastructure for future coverage gaps but currently has no work to do.

### 5. No paired longitudinal data

The `sweepLiteReeval` sweep UPSERTed `rater_evals` rows (overwriting lite-1.4 with lite-1.5 data) rather than preserving old scores alongside new ones. `eval_history` has no paired rows for before/after comparison. All analysis relies on aggregate statistics across different story populations, not per-story deltas.

## Remediation Status

| Mitigation | Status | Effect |
|-----------|--------|--------|
| Prompt engineering (lite-1.5) | Deployed | Zero% 66% → 2% |
| `editorial_uncertain` flag | Active | Marks confident zeros |
| Consensus neutral discount (x0.5) | Active | Prevents lazy-neutral from pulling consensus |
| Model retirement | Complete | Old lite models disabled |
| PSQ separation | Complete | WAI models now run PSQ, not lite HRCB |
| `upgrade_lite` sweep | Available | Zero candidates — no work needed |

## Conclusion

The lazy-neutral problem is resolved through a combination of prompt evolution (lite-1.5), consensus weighting adjustments, and model retirement. The lite HRCB pathway is effectively frozen — all new WAI model evals produce PSQ scores, not HRCB. Historical lite evals are preserved and contribute to consensus with appropriate discounting.

No code changes needed. Both TODO items (lite_reeval analysis, upgrade_lite sweep) are complete.
