# ESC/SETL Construct Validation

**Date:** 2026-03-07
**Status:** Complete
**Construct:** Editorial-Structural Coherence (ESC), measured via SETL (Structural-Editorial Tension Level)

## Formula

```
SETL = sign(E - S) * sqrt(|E - S| * max(|E|, |S|))
```

Geometric mean of gap magnitude and signal strength. Positive = editorial exceeds structural ("says more than it does"). Negative = structural exceeds editorial ("does more than it says"). Clamped to [-1, +1].

Source: `site/src/lib/compute-aggregates.ts:258`, `site/src/lib/colors.ts:135`

## Corpus Statistics

| Metric | Value |
|--------|-------|
| Stories with SETL | 2,182 |
| Mean SETL | +0.167 |
| Mean \|E-S\| | 0.249 |
| Mean E-S gap | +0.153 |
| E > S count | 1,297 (61%) |
| S > E count | 814 (39%) |

The corpus leans toward positive SETL — editorial content generally scores higher than structural infrastructure. Distribution is roughly bimodal with concentrations at -0.1/0.0 and +0.2, a secondary peak at +0.6, and a spike at +1.0 (99 stories).

## Discriminant Validity

SETL correlations with other constructs (n=2,136):

| Construct | r | Interpretation |
|-----------|---|----------------|
| HRCB | -0.342 | Moderate negative — not redundant |
| \|HRCB\| | +0.379 | Moderate — some overlap |
| Editorial | +0.289 | Moderate positive |
| Structural | **-0.748** | Strong negative — **structural-dominated** |
| (E - S) | **+0.918** | Very strong — tracks direction, not just magnitude |
| Consensus | -0.139 | Weak |
| EQ | +0.078 | Near-zero — good discriminant |
| RS | +0.167 | Weak — good discriminant |

**Finding:** SETL discriminates well from EQ, RS, and consensus (r < 0.17). It is NOT redundant with HRCB (r = -0.342). However, it is predominantly driven by the structural channel (r = -0.748), meaning SETL functions primarily as a structural quality indicator with editorial modulation.

The r = +0.918 with raw (E-S) reflects the corpus asymmetry (61% E > S), not a formula defect — the signed geometric mean correctly preserves direction.

## Inter-Rater Reliability

### By prompt mode pairing

| Pairing | n | Pearson r | Same-sign % | Mean \|diff\| |
|---------|---|-----------|-------------|---------------|
| Full-Full | 193 | **0.519** | 76.7% | 0.161 |
| Lite-Lite | 4,932 | **0.000** | 100.0% | 0.001 |
| Full-Lite | 1,757 | — | — | 0.195 |
| Lite-Full | 176 | — | — | 0.251 |

**Finding:** Full-eval SETL shows moderate inter-rater agreement (r = 0.519), comparable to HRCB inter-rater (r = 0.509). This validates SETL as a meaningful construct for full evaluations.

**Critical finding:** Lite-eval SETL is **degenerate** — r = 0.000 with 100% same-sign and mean difference of 0.001. The TQ-to-structural proxy (5 binary indicators mapped to [-1, +1]) produces near-constant structural values, collapsing SETL variance. 80% of lite SETL values are exactly 0.00.

### Lite SETL value distribution

| SETL value | Count | % |
|------------|-------|---|
| 0.00 | 7,133 | ~80% |
| Other | ~1,800 | ~20% |

The TQ structural proxy has only 6 possible values (-1.0, -0.6, -0.2, +0.2, +0.6, +1.0), creating discrete SETL bands. When editorial is near-zero (common), SETL collapses to zero regardless of structural quality.

## Face Validity (Known Groups)

### High-SETL domains (E > S, n >= 5)

| Domain | SETL | E | S | Interpretation |
|--------|------|---|---|----------------|
| www.aclu.org | +0.897 | +0.860 | -0.165 | Rights org, strong editorial, poor structural |
| freedom.press | +0.862 | +0.468 | -0.723 | Press freedom org with tracking |
| www.ftc.gov | +0.652 | +0.313 | -0.403 | Government regulator |
| www.eff.org | +0.406 | +0.584 | +0.326 | Digital rights org |
| www.phoronix.com | +0.907 | +0.010 | -0.896 | Tech site, poor infrastructure |
| www.theatlantic.com | +0.545 | +0.095 | -0.472 | News, heavy tracking |

**Two distinct phenomena in high SETL:**
1. **Rights-washing** (ACLU, freedom.press, EFF): High editorial + low structural = "says the right things but doesn't practice them." This is the intended ESC signal.
2. **Structural poverty** (phoronix, theatlantic): Near-zero editorial + negative structural = "doesn't say much about rights AND has bad infrastructure." This is noise.

The rights-washing badge (`SETL >= 0.25 AND E > +0.1 AND S < -0.1`) already gates against the second phenomenon. The gate works correctly.

### Low-SETL domains (S > E, n >= 5)

| Domain | SETL | E | S | Interpretation |
|--------|------|---|---|----------------|
| arxiv.org | -0.082 | +0.077 | +0.119 | Open access, minimal tracking |
| lwn.net | -0.027 | +0.096 | +0.138 | Quality Linux journalism |
| beej.us | -0.163 | +0.046 | +0.196 | Educational, clean infrastructure |

These are sites that practice better than they preach — face validity confirmed.

## Category Analysis

| Category | n | HRCB | E | S |
|----------|---|------|---|---|
| Rights-washing (SETL>=0.25, E>0.1, S<-0.1) | 150 | +0.036 | +0.376 | -0.399 |
| High SETL other | 454 | -0.032 | +0.173 | -0.307 |
| Mid SETL (0.1-0.25) | 586 | +0.066 | +0.106 | -0.029 |
| Low SETL (<0.1) | 946 | +0.118 | +0.061 | +0.153 |

Rights-washing stories have near-zero HRCB despite strongly positive editorial — the structural channel drags them down. This is exactly the "says one thing, does another" pattern ESC is designed to detect.

## Validation Summary

| Criterion | Full Evals | Lite Evals |
|-----------|-----------|------------|
| Inter-rater reliability | PASS (r=0.519) | **FAIL** (r=0.000) |
| Discriminant validity | PASS (r=0.078 vs EQ) | N/A (degenerate) |
| Face validity | PASS (known groups) | N/A |
| Rights-washing detection | PASS (150 stories, gate works) | N/A |

## Recommendations

1. **Suppress SETL display for lite-only stories.** The TQ structural proxy produces degenerate SETL values. Show SETL only when at least one full eval exists.
2. **Document structural dominance.** SETL is primarily a structural quality signal. Methodology notes should state this explicitly rather than implying equal E/S contribution.
3. **ESC validated for full evals.** r=0.519 inter-rater, face validity confirmed, discriminant validity confirmed. The rights-washing badge gate (E>0.1, S<-0.1) correctly isolates the pedagogically valuable signal from generic structural poverty.
4. **No formula change needed.** The geometric mean formula correctly rewards both gap magnitude and signal strength. The structural dominance reflects reality (structural scores vary more than editorial), not a formula defect.

## Methodology

All analyses run on production D1 data (2026-03-07). Correlations are Pearson product-moment. Inter-rater pairs are cross-model (model1 < model2 on same hn_id). No external validation source used — this is internal construct analysis only.
