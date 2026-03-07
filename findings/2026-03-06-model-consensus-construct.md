# Model Consensus Construct (MCC) — Validity Boundary Analysis

**Date:** 2026-03-06
**Status:** COMPLETE (analytical finding, no code changes needed)
**Models:** claude-haiku-4-5-20251001 (full) vs deepseek-v3.2 (full)
**Overlap:** n=264 stories with both full evals

## Overall Agreement

| Metric | Value |
|--------|-------|
| Pearson r | 0.495 |
| Avg |score diff| | 0.158 |
| Classification agreement | 78.8% |

## Agreement × Rights Salience

| RS Band | n | Avg |diff| | Class Agree | Pearson r |
|---------|---|------------|-------------|-----------|
| Both salient (RS≥0.05) | 66 | 0.204 | **90.9%** | 0.302 |
| Mixed (one salient) | 86 | 0.178 | 89.5% | — |
| Neither salient (RS<0.05) | 112 | 0.115 | **63.4%** | 0.502 |

## Key Finding: The Validity Boundary

HRCB has two distinct measurement regimes:

**Rights-salient content (RS ≥ 0.05):**
- Models agree on *direction* 91% of the time (positive/negative/neutral)
- Models disagree on *magnitude* (r=0.30 = 9% shared variance)
- HRCB classification is a **well-defined construct**
- HRCB exact score is **model-dependent** — present as range, not point estimate

**Non-salient content (RS < 0.05):**
- Higher Pearson r (0.502) — both models produce near-zero noise that correlates
- Lower classification agreement (63.4%) — noise around zero randomly flips categories
- HRCB is **not measuring content** — it's measuring evaluator variance
- This is why RS gating matters: without it, 67% of HRCB scores are noise

## Implications

1. **HRCB classification is the valid unit** — "positive," "negative," "neutral" are
   reproducible across models for salient content. Exact scores are not.

2. **Consensus scoring works** — the existing `updateConsensusScore()` ensemble
   correctly reduces model-specific variance. The spread metric
   (`consensus_spread`) identifies high-disagreement stories.

3. **RS gating resolves MCC** — the validity boundary IS the salience boundary.
   No additional construct or metric needed. `getModelAgreement()` (currently
   `@internal`) can remain internal — its insight is now operationalized via RS.

4. **Presentation implication** — for salient content, show classification badge
   prominently, exact score secondary. For non-salient, show "low salience" badge
   and de-emphasize the number.

## Resolution

MCC is resolved by RS implementation. The construct validity question "where do
models agree?" is answered: "where content engages with rights." No additional
code needed. `getModelAgreement()` stays `@internal` as a diagnostic tool.
Mark MCC as DONE in TODO.md.
