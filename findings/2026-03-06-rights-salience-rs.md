# Rights Salience (RS) — Construct Implementation & Validation

**Date:** 2026-03-06
**Status:** IMPLEMENTED (migration 0067, backfilled 1,111 full evals)

## Definition

Rights Salience (RS) measures whether content genuinely engages with human rights,
gating HRCB validity. A three-factor multiplicative score:

```
RS = breadth × depth × intensity

breadth   = signal_sections / 31       (fraction of UDHR articles touched)
depth     = mean(evidence_weight)      (H=1.0, M=0.7, L=0.4)
intensity = mean(|final|)              (substantive engagement strength)
```

**Key properties:**
- Layer 1 (objective, no LLM judgment — derived from evidence metadata)
- Fully reproducible (deterministic computation)
- Zero in any dimension → zero RS (multiplicative form)
- Only computed for full evals (lite/PSQ have no per-section scores)

## Distribution (n=1,111 full evals)

| Band | Count | % | Avg |HRCB| | Avg Confidence |
|------|-------|---|-------------|----------------|
| Zero (0.00) | 65 | 5.9% | 0.000 | — |
| Very low (0.00-0.01) | 140 | 12.6% | — | — |
| Low (0.01-0.05) | 536 | 48.2% | — | — |
| Moderate (0.05-0.10) | 195 | 17.6% | — | — |
| High (0.10-0.15) | 84 | 7.6% | — | — |
| Very high (0.15-0.20) | 42 | 3.8% | — | — |
| Exceptional (0.20+) | 49 | 4.4% | — | — |

### By RS band (aggregated)

| Band | Stories | Avg |HRCB| | Avg Confidence |
|------|---------|-------------|----------------|
| High (≥0.15) | 91 | **0.493** | **0.408** |
| Moderate (0.05-0.15) | 279 | 0.351 | 0.246 |
| Low (<0.05) | 741 | **0.192** | **0.136** |

RS cleanly separates high-confidence rights content from noise.

## Face Validity

**Highest RS stories:**
- Gaza torture report (RS=0.463, HRCB=0.780) — 20/31 articles, 94% H/M evidence
- ICE deportation of US citizens (RS=0.441, HRCB=0.826)
- Identity surveillance machine (RS=0.354, HRCB=0.598)

**Lowest RS stories (non-zero):**
- Fry's Electronics nostalgia (RS=0.001, HRCB=0.030)
- Forth programming (RS=0.001, breadth=1.0! but intensity=0.003)
- PA Bench evaluations (RS=0.001, HRCB=0.030)

The Forth programming example validates the three-factor design: breadth=1.0
(all 31 sections scored) but intensity=0.003 (near-zero engagement). Breadth
alone would have rated this maximally salient.

## Anchoring Contamination Evidence

Coverage band analysis revealed full-coverage stories (26-31 sections) have:
- Lowest avg |HRCB| (0.130) across all bands
- Lowest avg evidence weight (0.413)
- The LLM spreads thin across all articles, finding weak connections

This confirms the anchoring contamination hypothesis from the construct validity
analysis. RS correctly penalizes this pattern through the multiplicative form.

## Gating Threshold

**RS < 0.03 → "low salience" badge**

Below this threshold, content has minimal rights engagement and HRCB scores
likely reflect noise. 66.7% of full evals fall below 0.05; 0.03 is the natural
break where both confidence and intensity drop to near-baseline levels.

## Storage

- `stories.rs_score`, `rs_breadth`, `rs_depth`, `rs_intensity` (story-level, primary eval)
- `rater_evals.rs_score`, `rs_breadth`, `rs_depth`, `rs_intensity` (per-model)
- Migration 0067. Index on `stories(rs_score) WHERE rs_score IS NOT NULL`.
- Backfill sweep: `sweep=backfill_rs` (computes from existing rater_scores)
- Live computation: `computeRightsSalience()` in `compute-aggregates.ts`

## Implications for HRCB

RS resolves the "decompose or keep" decision:
- HRCB persists as convenience composite **with RS gating**
- High RS → HRCB is measuring genuine rights signal
- Low RS → HRCB is measuring LLM noise (display caveat)
- This is not cosmetic framing — it's an empirical validity gate
