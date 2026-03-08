# Test-Retest Reliability — HRCB Same-Model Re-Evaluation

**Date:** 2026-03-07
**Method:** Same-model (Haiku 4.5) re-evaluation of stories originally evaluated by Haiku 4.5
**n = 85** completed pairs (13 failed due to fetch/content issues, 2 uncollected)
**Model:** claude-haiku-4-5-20251001 (both original and retest)
**Time gap:** Variable (stories span 2024–2026; minimum days between evals not enforced for this batch)

## Summary Statistics

| Metric | Value |
|--------|-------|
| n (pairs) | 85 |
| MAE (HRCB) | 0.1416 |
| RMSE (HRCB) | 0.2006 |
| Pearson r | 0.397 |
| Mean original | +0.249 |
| Mean retest | +0.206 |
| Mean bias | −0.043 (slight negative drift) |
| Min |Δ| | 0.001 |
| Max |Δ| | 0.877 |

## Per-Channel MAE

| Channel | MAE |
|---------|-----|
| Editorial | 0.138 |
| Structural | 0.134 |
| SETL | 0.179 |
| HRCB (combined) | 0.142 |

SETL shows highest instability — expected given it amplifies channel divergence via geometric mean.

## Stability Band Distribution

| Band | n | % |
|------|---|---|
| Excellent (|Δ| < 0.05) | 28 | 32.9% |
| Good (0.05–0.10) | 14 | 16.5% |
| Acceptable (0.10–0.20) | 25 | 29.4% |
| Marginal (0.20–0.30) | 9 | 10.6% |
| Poor (> 0.30) | 9 | 10.6% |

**78.8% of pairs fall within ±0.20** — acceptable for a formative composite scored by a single LLM.

## Classification Agreement

| Metric | Value |
|--------|-------|
| Same classification (pos/neut/neg) | 63/85 (74.1%) |
| Changed classification | 22/85 (25.9%) |
| Same sign (pos/pos or neg/neg) | 73/85 (85.9%) |
| Sign flip | 7/85 (8.2%) |
| Zero involved | 5/85 (5.9%) |

## Largest Divergences (Top 5)

| hn_id | Original | Retest | |Δ| | Notes |
|-------|----------|--------|-----|-------|
| 32864997 | +0.361 | −0.516 | 0.877 | Sign flip — largest divergence |
| 27331075 | +0.309 | −0.239 | 0.548 | Sign flip |
| 47160226 | +0.858 | +0.315 | 0.543 | Same sign, magnitude shift |
| 33484185 | +0.237 | +0.673 | 0.436 | Same sign, large positive shift |
| 47151233 | +0.038 | +0.466 | 0.428 | Near-zero to moderate positive |

## Interpretation

**Test-retest r = 0.397 is low for a psychometric instrument** but expected for:
1. **Formative composite** — HRCB aggregates 31 section scores into a weighted mean. Small per-section drift compounds.
2. **Content sensitivity** — full eval fetches live content; dynamic pages may change between evaluations.
3. **No DCP cache control** — DCP cache misses on retest (45 hits, 40 misses) mean different domain context modifiers may apply.
4. **Single model** — no ensemble averaging to dampen noise.

**Comparison to inter-rater reliability:**
- Inter-rater (cross-model, n=278): r = 0.509, 72.3% classification agreement
- Test-retest (same-model, n=85): r = 0.397, 74.1% classification agreement

The classification agreement is comparable (74% vs 72%), but the correlation is lower. This suggests HRCB scores have **moderate ordinal stability** (same bucket) but **limited cardinal precision** (exact score varies). This is consistent with treating HRCB as ordinal — which aligns with the PSQ caveat just shipped.

## Recommendations

1. **Report HRCB as ordinal** — classification (positive/neutral/negative) is more stable than exact score. Already reflected in UI (classification badges prominent, scores secondary).
2. **Multi-model consensus reduces noise** — stories with 3+ rater evals have tighter consensus spread. Test-retest on consensus scores (not single-model) would likely show higher r.
3. **Investigate outliers** — the 9 poor-band pairs (>0.30 diff) may reveal content drift, DCP instability, or prompt sensitivity. Worth spot-checking.
4. **Consider confidence-weighted test-retest** — weight pairs by model confidence to see if high-confidence evals are more stable.
5. **SETL instability** — SETL MAE (0.179) exceeds HRCB MAE (0.142). The geometric mean amplification makes SETL sensitive to small per-section shifts. Consider reporting SETL stability separately.
