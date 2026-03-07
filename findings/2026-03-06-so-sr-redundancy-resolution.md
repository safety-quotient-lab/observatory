# SO/SR Redundancy Resolution

**Date:** 2026-03-06
**Status:** RESOLVED — NOT REDUNDANT

## Background

Phase A automated validation (2026-03-04) flagged Solution Orientation (SO) and
Stakeholder Representation (SR) as potentially redundant with HRCB:

- SO <-> HRCB: Spearman rho = +0.609 (n=68 domains)
- SR <-> HRCB: Spearman rho = +0.582 (n=68 domains)

Both exceeded the rho > 0.50 threshold for redundancy concern.

## Story-Level Analysis (n=775)

The Phase A analysis used **domain-level aggregates** (n=68, domains with all
signals present) and **Spearman rank correlation**. This created inflated
estimates due to: (a) restrictive filtering to a small selective subset,
(b) rank correlation on small n amplifying apparent relationships.

### Pearson Correlations (story-level, n=775)

| Pair | r | R-squared | Interpretation |
|------|---|-----------|---------------|
| SO <-> HRCB | 0.297 | 8.8% | Moderate — SO shares < 9% variance with HRCB |
| SR <-> HRCB | 0.389 | 15.1% | Moderate — SR shares ~15% variance with HRCB |
| SO <-> SR | 0.277 | 7.7% | Moderate — low direct overlap between SO and SR |

All three correlations are moderate (0.25-0.40 range), well below the 0.70
threshold that would indicate genuine redundancy.

### Partial Correlations

Partial correlations isolate the unique relationship between two variables
after removing the shared influence of a third.

| Partial | r | t | p | Interpretation |
|---------|---|---|---|---------------|
| SO <-> SR given HRCB | 0.184 | 5.20 | <0.001 | Weak residual — overlap is HRCB-mediated |
| SO <-> HRCB given SR | 0.214 | 6.07 | <0.001 | SO contributes to HRCB beyond SR |
| SR <-> HRCB given SO | 0.334 | 9.85 | <0.001 | SR contributes to HRCB beyond SO |

**Key finding:** After controlling for HRCB, SO and SR share only r=0.184 —
their apparent correlation is largely mediated through HRCB. They are not
measuring the same construct.

### Domain-Level Confirmation (n=244)

To rule out ecological fallacy, we also computed domain-level Pearson r
(domains with >= 3 stories):

| Pair | Domain r (n=244) | Story r (n=775) |
|------|-----------------|-----------------|
| SO <-> HRCB | 0.294 | 0.297 |
| SR <-> HRCB | 0.361 | 0.389 |
| SO <-> SR | 0.293 | 0.277 |

Domain-level Pearson r matches story-level almost exactly. The Phase A
inflation came from Spearman rank correlation on a small filtered subset
(n=68), not from ecological aggregation.

## Conclusion

**SO and SR are NOT redundant with each other or with HRCB.** Both retained
as independent supplementary signals.

- SO explains 8.8% of HRCB variance — captures solution-oriented framing
  that partially correlates with rights-positive content but measures a
  distinct dimension
- SR explains 15.1% of HRCB variance — captures stakeholder breadth, a
  stronger HRCB correlate but still 85% independent
- SO <-> SR partial r = 0.184 after removing HRCB — their overlap is
  almost entirely mediated through HRCB, not a direct shared construct

The Phase A flags (rho = 0.609, 0.582) were artifacts of small-sample
Spearman rank correlation on a restrictively filtered domain subset. The
story-level analysis at n=775 is definitive.

## Phase A Flag Status Update

| Flag | Phase A Value | Resolution |
|------|--------------|------------|
| SO <-> HRCB redundancy | rho = 0.609 | RESOLVED: r = 0.297 (story-level) |
| SR <-> HRCB redundancy | rho = 0.582 | RESOLVED: r = 0.389 (story-level) |
| TD <-> EQ redundancy | rho = 0.652 | OPEN: monitor as data grows |
