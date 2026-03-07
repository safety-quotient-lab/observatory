# Inter-Rater Reliability Analysis

**Date:** 2026-03-06
**Status:** COMPLETE (inter-rater); TEST-RETEST PENDING

## Summary

Analyzed 278 cross-model evaluation pairs to assess inter-rater reliability
of HRCB scoring. All pairs are between different models (no same-model
re-evaluations exist in the dataset), making this an inter-rater study,
not a test-retest study.

## Data

- **n = 278** story-level pairs
- **Model pairs:** Haiku x DeepSeek (273 pairs), DeepSeek x Scout (5 pairs)
- **Time gap:** 0-3 days (median 0d) — all evaluated within same crawl cycle
- **Prompt mode:** Full evaluations only

## Results

| Metric | Value | Interpretation |
|--------|-------|---------------|
| Pearson r | 0.509 | Moderate agreement |
| MAE | 0.158 | On [-1,+1] scale |
| RMSE | 0.214 | - |
| Classification agreement | 72.3% | (P+/N-/Neutral buckets, threshold 0.1) |

### Classification Breakdown

| Agreement | Count |
|-----------|-------|
| Both positive (>0.1) | 178 |
| Both neutral (|x|<=0.1) | 22 |
| Both negative (<-0.1) | 1 |
| **Total agree** | **201 / 278 = 72.3%** |

### Model Systematic Bias

| Model | Mean HRCB (as first rater) | Mean HRCB (as second rater) |
|-------|---------------------------|----------------------------|
| Haiku | 0.272 | 0.300 |
| DeepSeek | 0.243 | 0.215 |

Haiku scores systematically ~0.055 higher than DeepSeek. This is a known
model bias — the consensus scoring system already mitigates this by
averaging across raters.

## Context

Human inter-rater reliability in content analysis typically ranges from
0.40-0.80 (Krippendorff's alpha). Our Pearson r of 0.509 falls in the
lower-middle of this range, which is expected given:

1. **Different model architectures** (Haiku vs DeepSeek) — more divergent
   than two humans with shared training
2. **Holistic judgment task** — HRCB requires integrating 31 UDHR articles
   across editorial and structural channels
3. **No calibration anchoring** — models do not see each other's prior scores

The 72.3% classification agreement is more practically meaningful than the
raw correlation, as it shows models agree on the direction (rights-positive
vs rights-negative vs neutral) nearly three-quarters of the time.

## Connection to Rights Salience (RS)

The model consensus construct (MCC) analysis found 91% classification
agreement on salient content (RS >= 0.05) vs 63% on non-salient. This
confirms that inter-rater reliability improves substantially when content
has genuine rights signal, and that RS gating is an effective validity
boundary.

## Test-Retest: Not Yet Available

**No same-model re-evaluations exist in the dataset.** Every story was
evaluated by a different model each time. The preliminary r=0.984 (n=11)
referenced in earlier notes appears to have been from a different analysis
(likely calibration set scores, not production re-evaluations).

### Recommendation

Create a `test_retest` sweep that:
1. Selects ~50 stories evaluated >= 14 days ago by a specific model
2. Re-evaluates them with the same model
3. Computes same-model test-retest r

This would measure temporal stability (does the same model give the same
score to the same content over time?), which is orthogonal to inter-rater
reliability (do different models agree?).

## Phase A Flag Status

| Flag | Status |
|------|--------|
| SO/SR redundancy | RESOLVED (separate finding) |
| Inter-rater reliability | RESOLVED — r=0.509, 72.3% agreement |
| Test-retest formal | OPEN — requires same-model re-evaluation sweep |
