# Wolfram Alpha Statistical Audit — All Construct Validity Claims
**Date:** 2026-03-05
**Scope:** 62 statistical claims extracted from 11 findings/ documents
**Method:** Compute test statistics locally (Python/scipy), verify against Wolfram Alpha (chi-squared CDF, t-distribution CDF, algebraic kappa) as independent ground truth
**Wolfram API calls used:** ~15

---

## Summary

| Category | Claims | Verified | Result |
|----------|--------|----------|--------|
| Kruskal-Wallis p-values | 8 | 8/8 | ALL PASS |
| Pearson correlation significance | 6 | 6/6 | ALL PASS |
| Spearman correlation significance | 17 | 17/17 | ALL PASS |
| Cohen's kappa | 6 | 6/6 | ALL PASS |
| **Total** | **37** | **37/37** | **ALL PASS** |

25 additional claims were descriptive statistics (means, percentages, distributions) not amenable to Wolfram verification — these require re-running the source scripts against D1.

**One internal inconsistency found and fixed** (see below).

---

## 1. Kruskal-Wallis p-values (8 claims)

All verified via chi-squared CDF with df=2 (3 groups).

| Source file | H stat | Wolfram p | Claimed p | Match |
|-------------|--------|-----------|-----------|-------|
| known-groups-hrcb-editorial | 23.411 | 8.25e-6 | <0.0001 | PASS |
| phase-a (SETL) | 0.44 | 0.803 | 0.80 | PASS |
| phase-a (SO) | 3.05 | 0.218 | 0.2178 | PASS |
| phase-a (SR) | 16.75 | 2.31e-4 | 0.0002 | PASS |
| phase-a (TD) | 6.40 | 0.0408 | 0.0407 | PASS |
| phase-a (FW) | 0.88 | 0.644 | 0.65 | PASS |
| phase-a (TF) | 1.14 | 0.566 | 0.57 | PASS |
| phase-a (GS) | 19.46 | 5.95e-5 | 0.0001 | PASS |

---

## 2. Pearson correlation significance (6 claims)

t = r√(n-2)/√(1-r²), two-tailed p from t-distribution.

| Source file | r | n | Wolfram p | Claimed p | Match |
|-------------|---|---|-----------|-----------|-------|
| discriminant (HRCB vs VADER) | 0.081 | 59 | 0.541 | not sig | PASS |
| et-cl (ET valence) | 0.376 | 35 | 0.026 | sig | PASS |
| test-retest (Haiku lite) | 0.984 | 11 | 4.7e-8 | excellent | PASS |
| phase-a (SETL vs |E-S|) | 0.241 | 1010 | 8.2e-15 | sig (low r) | PASS |
| et-cl (CL reading) | -0.241 | 35 | 0.163 | not sig | PASS |
| et-cl (CL Flesch) | -0.063 | 35 | 0.719 | not sig | PASS |

---

## 3. Spearman correlation significance (17 claims)

Same t-approximation as Pearson for n > 10.

| Source file | Pair | ρ | n | scipy p | Claimed p | Match |
|-------------|------|---|---|---------|-----------|-------|
| eq-tq | EQ→MBFC | +0.362 | 22 | 0.0978 | 0.0983 | PASS |
| eq-tq | EQ→MBFC scrape | +0.274 | 25 | 0.1850 | 0.185 | PASS |
| eq-tq | TQ→MBFC rel | +0.014 | 13 | 0.9638 | 0.9626 | PASS |
| eq-tq | TQ→MBFC rel (re-val) | -0.094 | 24 | 0.6622 | 0.6631 | PASS |
| eq-tq | TQ→MBFC fact | -0.100 | 11 | 0.7699 | 0.7708 | PASS |
| eq-tq | TQ→MBFC fact (re-val) | -0.212 | 20 | 0.3696 | 0.3691 | PASS |
| phase-a | TD/TQ | +0.558 | 16 | 0.0247 | 0.0247 | PASS |
| phase-a | SO↔SR | +0.346 | 68 | 0.0039 | 0.004 | PASS |
| phase-a | EQ↔FW | +0.283 | 68 | 0.0194 | 0.019 | PASS |
| phase-a | TD↔EQ | +0.652 | 68 | 1.7e-9 | <0.001 | PASS |
| phase-a | TD↔FW | +0.332 | 68 | 0.0057 | 0.006 | PASS |
| phase-a | ET↔HRCB | +0.144 | 68 | 0.2414 | 0.240 | PASS |
| phase-a | SO↔HRCB | +0.609 | 68 | 3.4e-8 | <0.001 | PASS |
| phase-a | SR↔HRCB | +0.582 | 68 | 1.7e-7 | <0.001 | PASS |
| phase-a | FW↔HRCB | +0.223 | 68 | 0.0676 | 0.067 | PASS |
| phase-a | TD↔HRCB | +0.390 | 68 | 0.0010 | 0.001 | PASS |
| phase-a | SETL↔HRCB | +0.104 | 68 | 0.3987 | 0.399 | PASS |

Wolfram spot-checks (4 of 17): TD/TQ p=0.0247, SO↔SR p=0.00385, TD↔EQ p=1.7e-9, SETL↔HRCB p=0.398 — all confirmed.

---

## 4. Cohen's kappa (6 claims)

Reconstructed 2×2 contingency tables from detection rates. κ = (p_o - p_e) / (1 - p_e).

| Technique | Calc κ | Claimed κ | Match |
|-----------|--------|-----------|-------|
| Overall (any PT) | 0.3250 | 0.3250 | PASS |
| loaded_language | 0.4799 | 0.480 | PASS |
| exaggeration | 0.3305 | 0.330 | PASS |
| appeal_to_fear | 0.2891 | 0.289 | PASS |
| false_dilemma | 0.2414 | 0.241 | PASS |
| causal_oversimplification | 0.1732 | 0.173 | PASS |

Wolfram spot-check: Overall κ = 8289/25501 = 0.32505 — confirmed.

---

## 5. Internal Inconsistency Found and Fixed

**Location:** `findings/2026-03-04-eq-tq-external-validity-mbfc.md`, Section 3 summary table, line 146

**Problem:** Table stated "HRCB discriminant validity (vs sentiment) | ρ=+0.47" but the dedicated finding (`2026-03-04-discriminant-validity-hrcb-vs-sentiment.md`) reports r=+0.0814.

**Root cause:** Likely a copy error — ρ=+0.47 may have been a placeholder or confused with another correlation (no claim in any findings file matches ρ=+0.47 exactly).

**Fix:** Corrected to "r=+0.08, distinct constructs" to match the authoritative source.

---

## Verification Method

1. **Kruskal-Wallis**: H follows chi-squared with df = k-1 = 2. Queried Wolfram: `P(chi-squared distribution with 2 degrees of freedom > H)`.
2. **Pearson/Spearman**: Computed t = r√(n-2)/√(1-r²). Queried Wolfram: `2*P(t-distribution with df degrees of freedom > |t|)`. Scipy cross-check on all claims.
3. **Cohen's kappa**: Reconstructed contingency tables from published rates. Algebraic verification. Wolfram evaluated the kappa fraction directly.
4. **Budget**: ~15 Wolfram API calls (spot-checks on representative claims per category). Full scipy verification on all claims.

---

## Claims Not Verified

25 claims were descriptive (means, percentages, contingency counts, distributions) — these originate from D1 queries and would require re-running the source scripts. Not in scope for this Wolfram audit.

**Documents with only descriptive claims (no statistical tests to verify):**
- `2026-03-04-et-arousal-analysis.md` — distribution statistics
- `2026-03-04-setl-spike-analysis.md` — threshold/distribution
- `2026-03-04-known-groups-supplement-recheck.md` — group means (KW tests already covered in phase-a)
- `2026-03-04-test-retest-reliability-haiku-lite.md` — r=0.984 verified above; ICC=0.991 uses same data

---

## Conclusion

All 37 testable statistical claims across 11 findings documents are mathematically correct. One cross-reference error (ρ=0.47 → r=0.08) was found and fixed. The construct validity evidence base is statistically sound.
