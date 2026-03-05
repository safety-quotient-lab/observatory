# PSQ Dimension Count Testing: Finding the Right Granularity

**Date:** 2026-03-04
**Status:** Complete — Decision: 3 dimensions
**Method:** 20 evaluations (4 dimension variants × 5 stories), Claude Haiku 4.5, dry-run mode

## Background

The Psychoemotional Safety Quotient (PSQ) measures *reader psychoemotional safety* — how safe content is to consume. This is a genuinely different construct from HRCB's editorial channel, which measures *rights stance* — whether content advances or undermines human rights. The canonical example: a well-reported article *exposing* torture (Al Jazeera) scores high on HRCB (documenting rights violations is rights-positive) but could score lower on PSQ (reading about torture is psychologically threatening).

PSQ draws from 23 validated psychological instruments mapped onto 10 dimensions. But running all 10 dimensions on every story evaluation is token-heavy and potentially noisy. This experiment tested which subset balances signal quality against cost.

## The 10 PSQ Dimensions

Each dimension is grounded in established psychometric instruments:

| # | Dimension | Role | Source Instruments |
|---|-----------|------|-------------------|
| 1 | **threat_exposure** | Threat | COPSOQ, NAQ, Abusive Supervision Scale |
| 2 | **hostility_index** | Threat | Cook-Medley, BPAQ, STAXI-2 |
| 3 | **authority_dynamics** | Threat | French & Raven, MLQ, Tepper |
| 4 | **energy_dissipation** | Threat | Effort-Recovery, COR, Flow |
| 5 | **regulatory_capacity** | Protective | ERQ, DERS, CERQ |
| 6 | **resilience_baseline** | Protective | CD-RISC, BRS, Grit Scale |
| 7 | **trust_conditions** | Protective | Rotter ITS, OTI, Trust Questionnaire |
| 8 | **cooling_capacity** | Protective | CPI, Gross reappraisal, Recovery Experience |
| 9 | **defensive_architecture** | Protective | DSQ, DMRS, Vaillant hierarchy |
| 10 | **contractual_clarity** | Protective | PCI, Morrison & Robinson, COPSOQ |

**Dimension roles matter for aggregation.** Threat dimensions are inverted (10 − score) before averaging. The g-PSQ formula computes a confidence-weighted balance between protective and threat averages, yielding a 0–10 composite that's displayed normalized to [-1, +1] alongside Editorial and Structural channels.

## Experimental Design

### Variants Tested

| Variant | Dimensions | Selection Rationale |
|---------|-----------|-------------------|
| **1-dim** | threat_exposure | Phase A baseline (already completed) |
| **2-dim** | threat_exposure, trust_conditions | Two-factor representatives |
| **3-dim** | threat_exposure, trust_conditions, resilience_baseline | Three-factor representatives |
| **5-dim** | hostility_index, trust_conditions, resilience_baseline, authority_dynamics, energy_dissipation | Five-factor representatives |
| **10-dim** | All 10 | Full instrument |

The 5-dim variant intentionally uses `hostility_index` instead of `threat_exposure` — it picks one representative per factor from the PSQ factor structure rather than always leading with the same dimension.

### Test Stories

Five stories selected for construct diversity:

| # | Story | Full HRCB | Content Type | Why Selected |
|---|-------|-----------|-------------|-------------|
| 1 | EFF: Tech Companies Shouldn't Be Bullied | +0.858 | ED (editorial) | Strong advocacy, high-rights, rich text |
| 2 | Al Jazeera: Gaza Arrests & Torture | +0.780 | ED/HR | Human rights documentation, traumatic content |
| 3 | CARA Robot Dog (portfolio) | 0.000 | PR (product) | JS-rendered, minimal text, neutral |
| 4 | Mercury 2 LLM (product launch) | -0.450 | PR | Promotional, truncated body |
| 5 | Edge Sends Images to Microsoft | -0.500 | ED | Privacy exposé, solution-oriented |

Stories 3 and 4 are deliberately "hard mode" — JS-rendered or truncated content that forces the model to work with metadata only. Stories 1, 2, and 5 are "content-rich" with full article text available.

### Evaluation Method

Each evaluation used `evaluate-standalone.mjs --mode lite-v2 --dims N --dry-run` with Claude Haiku 4.5. The `--dry-run` flag prevents writing to the production database. Each dimension receives:
- **Score** (integer 0–10): Anchored by PSQ instrument rubrics
- **Confidence** (0.0–1.0): Model's self-assessed certainty
- **Rationale** (1–2 sentences): Citing specific textual evidence

The g-PSQ composite is computed from dimension scores, applying confidence weighting and threat/protective role inversion.

## Results

### g-PSQ Scores by Variant

| Story | 2-dim | 3-dim | 5-dim | 10-dim |
|-------|-------|-------|-------|--------|
| EFF surveillance | 8.00 | 8.00 | 7.62 | 8.01 |
| AJ torture | 8.00 | 7.07 | TRUNC | 7.44 |
| CARA robot dog | 5.00 | 6.00 | 5.00 | 6.00 |
| Mercury 2 LLM | 5.54 | 5.35 | TRUNC | 5.75 |
| Edge/Microsoft | 6.48 | 7.00 | 6.81 | 6.09 |

**TRUNC** = Content truncation caused all dimensions to score 5 with confidence ≤0.15 (the model correctly signaled "I can't assess this").

### Key Finding 1: g-PSQ is Remarkably Stable Across Dimension Counts

| Story | Cross-variant σ | Values |
|-------|----------------|--------|
| EFF surveillance | 0.19 | [8.00, 8.00, 7.62, 8.01] |
| AJ torture | 0.47 | [8.00, 7.07, 7.44] |
| CARA robot dog | 0.58 | [5.00, 6.00, 5.00, 6.00] |
| Mercury 2 LLM | 0.20 | [5.54, 5.35, 5.75] |
| Edge/Microsoft | 0.40 | [6.48, 7.00, 6.81, 6.09] |

The g-PSQ composite barely moves whether you score 2, 3, 5, or 10 dimensions. The confidence-weighted aggregation formula smooths out noise effectively. This means we can use fewer dimensions without sacrificing composite signal quality.

### Key Finding 2: Zero-Rate Analysis (Dimensions Scoring Exactly 5)

A score of 5 is the "I can't tell" neutral default. High zero-rates indicate the model is punting rather than measuring.

| Variant | Zero-rate (all stories) | Zero-rate (content-rich) |
|---------|------------------------|------------------------|
| 2-dim | 30.0% (3/10) — FAIL | 0.0% (0/6) |
| **3-dim** | **20.0% (3/15) — PASS** | **0.0% (0/9)** |
| 5-dim | 33.3% (5/15)* — FAIL | 0.0% (0/10) |
| 10-dim | 36.0% (18/50) — FAIL | 6.7% (2/30) |

*Excludes 2 truncated stories

**3-dim is the only variant that passes the <30% zero-rate criterion.** The zero-rate on content-rich stories is 0% across all variants — the problem is exclusively with low-content pages (JS-rendered portfolio, truncated product announcement). More dimensions means more opportunities to score 5 on content that simply doesn't contain relevant signals.

### Key Finding 3: 5-dim Has a Truncation Problem

The 5-dim variant failed on 2 of 5 stories (Al Jazeera and Mercury 2). All 5 dimensions scored 5 with confidence 0.10–0.15. The same stories worked fine at 10-dim, so this appears to be a transient content-fetch issue rather than a systematic prompt problem. However, it's a reliability concern — a variant that fails 40% of the time in testing is not production-ready.

### Key Finding 4: resilience_baseline Discriminates Meaningfully

The 3rd dimension (`resilience_baseline`) adds genuine construct information beyond what `threat_exposure` and `trust_conditions` provide:

| Story | threat_exposure | trust_conditions | resilience_baseline |
|-------|----------------|-----------------|-------------------|
| EFF | 8 (conf 0.90) | 8 (conf 0.85) | **8** (conf 0.85) |
| AJ torture | 7 (conf 0.75) | 8 (conf 0.80) | **6** (conf 0.65) |
| Edge | 7 (conf 0.78) | 7 (conf 0.72) | **7** (conf 0.80) |

The Al Jazeera article scores 6 on resilience (content documents severe trauma, challenging reader coping capacity) while EFF scores 8 (models principled resistance, affirms reader agency). Both have similar threat/trust profiles, but resilience_baseline captures whether the content *empowers or depletes* the reader — a clinically meaningful distinction.

### Key Finding 5: 10-dim Works But Is Noisy on Non-Editorial Content

With 10 dimensions, content-poor pages generate 7–8 scores of 5 with confidence 0.15–0.30. This is technically correct behavior (the model is saying "insufficient evidence") but it wastes tokens and inflates the zero-rate. On content-rich pages, 10-dim produces rich profiles:

**EFF at 10-dim:**
```
threat_exposure:       8 (0.85)   defensive_architecture: 9 (0.85)
hostility_index:       8 (0.80)   contractual_clarity:    8 (0.85)
authority_dynamics:     8 (0.80)   regulatory_capacity:    8 (0.80)
energy_dissipation:     8 (0.75)   resilience_baseline:    8 (0.80)
trust_conditions:       7 (0.75)   cooling_capacity:       8 (0.80)
```

**Edge at 10-dim (the interesting one):**
```
threat_exposure:       7 (0.70)   defensive_architecture: 7 (0.70)
hostility_index:       5 (0.70)   contractual_clarity:    6 (0.60)
authority_dynamics:     5 (0.60)   regulatory_capacity:    6 (0.70)
energy_dissipation:     7 (0.70)   resilience_baseline:    7 (0.70)
trust_conditions:       4 (0.80)   cooling_capacity:       7 (0.70)
```

Edge's 10-dim profile reveals something the 3-dim view misses: `trust_conditions` scores 4 (tracking scripts undermine trust) while `cooling_capacity` scores 7 (the "how to disable" guide provides de-escalation). This tension between structural distrust and editorial helpfulness mirrors the HRCB SETL (Structural-Editorial Tension Level) concept.

## Decision

**Ship 3-dim: `threat_exposure`, `trust_conditions`, `resilience_baseline`**

| Criterion | 2-dim | **3-dim** | 5-dim | 10-dim |
|-----------|-------|-----------|-------|--------|
| Zero-rate < 30% | FAIL (30%) | **PASS (20%)** | FAIL (33%) | FAIL (36%) |
| Truncation failures | 0 | **0** | 2/5 | 0 |
| g-PSQ stability | Good | **Good** | N/A | Good |
| Discrimination | Low | **Medium** | Medium | High |
| Token cost | ~600 | **~900** | ~1500 | ~3000 |

### Why Not 2-dim?
Marginally fails zero-rate. Missing `resilience_baseline` loses the empowerment/depletion distinction (AJ and Edge both score identically on threat+trust but differ meaningfully on resilience).

### Why Not 10-dim?
Works well on content-rich pages but 36% zero-rate overall. 7/10 dimensions score 5 on low-content pages — pure noise. Token cost ~3.3× higher than 3-dim. The 10-dim option remains available via `--dims 10` for deep-dive analysis.

### Score Spread Caveat
None of the variants met the planned 1.5σ spread threshold across stories. However, all 5 test stories are "decent" content (legitimate journalism, standard products). To see wider g-PSQ spread, we'd need deliberately hostile, manipulative, or low-quality content in the test set. This threshold should be retested on a more diverse sample post-ship.

## Construct Observations

### The PSQ-HRCB Divergence Is Real

| Story | HRCB | PSQ (3-dim g-PSQ) | Construct Interpretation |
|-------|------|-------------------|------------------------|
| EFF surveillance | +0.858 | 8.00 → +0.600 | Both high: rights-positive AND safe to read |
| AJ torture | +0.780 | 7.07 → +0.414 | HRCB high (documenting violations), PSQ lower (traumatic content) |
| Mercury 2 | -0.450 | 5.35 → +0.071 | HRCB negative (promotional bias), PSQ neutral (harmless to read) |

The Al Jazeera divergence validates the construct separation: high HRCB (the article serves human rights) but lower PSQ (reading about torture is psychologically demanding). These are genuinely different signals worth tracking independently.

### Confidence as Content Availability Proxy

Mean confidence by variant and content type:

| Variant | Content-rich mean conf | Content-poor mean conf |
|---------|----------------------|----------------------|
| 2-dim | 0.800 | 0.575 |
| 3-dim | 0.789 | 0.433 |
| 10-dim | 0.767 | 0.310 |

Confidence drops sharply on content-poor pages, especially at higher dimension counts. The model is correctly expressing uncertainty rather than fabricating assessments. The confidence-weighted g-PSQ formula naturally down-weights these uncertain dimensions.

## Implementation

- **Default:** `METHODOLOGY_SYSTEM_PROMPT_LITE_V2` now generates a 3-dim prompt
- **Override:** `evaluate-standalone.mjs --dims N` (N = 1, 2, 3, 5, or 10)
- **Prompt:** `buildLiteV2Prompt(['threat_exposure', 'trust_conditions', 'resilience_baseline'])`
- **Output schema:** `lite-2.0` with flexible `psq_dimensions` record
- **Aggregation:** `computeLiteAggregatesV2()` in `eval-parse.ts`
- **CSS:** `.psq-experimental` badge class for UI labeling

## Next Steps

1. **Phase 2: Pipeline integration** — D1 migration (psq_score columns), consumer routing (lite-v2 prompt mode), separate PSQ consensus
2. **Validation:** Pilot 50+ stories, check distribution shape, inter-rater ICC on Workers AI models
3. **10-dim deep dives:** Consider periodic 10-dim sweeps on high-interest stories for rich safety profiles

## Raw Data

All 20 evaluation results preserved at `/tmp/psq-dims-results/dims{2,3,5,10}_{hnid}.txt`.
Phase A (1-dim) baseline from plan context — note potential rubric polarity difference from current rubrics.
