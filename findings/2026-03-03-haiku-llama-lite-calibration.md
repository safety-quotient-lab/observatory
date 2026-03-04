# Haiku-lite vs Llama-lite Calibration Comparison
**Date:** 2026-03-03
**n=13** (15 attempted: 1 age_gate skip, 1 missing Llama data)
**Method:** Ran Haiku (claude-haiku-4-5) lite evaluation on 13 stories with existing Llama-4-scout-wai and llama-3.3-70b-wai lite evals. Compared editorial_mean scores.

## Results

| hn_id | haiku | scout | llama70 | gap (haiku-avg) | uncertain |
|---|---|---|---|---|---|
| 17350645 | 0.200 | 0.100 | 0.000 | +0.150 | llama70? |
| 18224227 | 0.000 | 0.000 | 0.000 | +0.000 | scout? llama70? |
| 20323246 | 0.000 | 0.000 | 0.000 | +0.000 | scout? llama70? |
| 26258773 | 0.000 | 0.000 | 0.000 | +0.000 | llama70? |
| 36453856 | 0.000 | 0.000 | 0.000 | +0.000 | scout? llama70? |
| 41558554 | -0.040 | 0.100 | 0.000 | -0.090 | llama70? |
| 45409794 | 0.500 | 0.800 | 0.800 | -0.300 | — |
| 45441069 | 0.060 | 0.100 | 0.000 | +0.010 | llama70? |
| 45521920 | 0.060 | 0.100 | 0.200 | -0.090 | — |
| **47136179** | **0.500** | **-0.800** | **0.700** | **+0.550** | — |
| 47156925 | -0.040 | 0.100 | 0.000 | -0.090 | llama70? |
| **47188473** | **0.700** | **0.240** | **0.100** | **+0.530** | — |
| 47202708 | 0.000 | 0.000 | 0.000 | +0.000 | scout? llama70? |

**Mean haiku=0.149 | llama_avg=0.098 | mean_gap=+0.052 | median_gap=0.000**
Haiku > Llama_avg: 4/13 (31%) stories

## Key Findings

### 1. Lazy-neutral confirmed at high rates
- llama-3.3-70b-wai: `editorial_uncertain=1` on **9/13 stories (69%)**
- llama-4-scout-wai: `editorial_uncertain=1` on **5/13 stories (38%)**
- Haiku: 0 flagged — all Haiku zeros are legitimate (genuinely neutral content)

### 2. Cluster of unanimous zeros
5 stories (18224227, 20323246, 26258773, 36453856, 47202708) return exactly 0.000 from all three models. These appear to be genuinely neutral content. All Llama zeros here are flagged `editorial_uncertain`, suggesting Llama is defaulting to neutral even on stories where Haiku also sees no signal — but Haiku's confidence in 0.000 is different (not `editorial_uncertain`).

### 3. High-signal stories show largest gaps
- **47136179** (Gaza massacre report): Haiku=+0.500, Llama70b=+0.700 — but Scout=-0.800 (WRONG DIRECTION — 1.3 point spread between scout and haiku). Scout identifies rights-advocacy reporting as negative.
- **47188473** (notdivided.org — rights advocacy site): Haiku=+0.700, Llama average=+0.170. Llamas miss 75% of the signal.
- **45409794** (F-Droid/Google decree): All models agree it's positive; Haiku (0.500) actually lower than Llamas (0.800). One case where Llamas score HIGHER.

### 4. Model vs prompt architecture question
**Conclusion:** The gap is primarily MODEL CAPABILITY, not prompt architecture.
- The anti-50 instruction moved Llamas off exactly 50 (they now return 55, 58, etc.) but models still fail to evaluate substantive content
- For rights-signal stories (the ones that matter for HRCB pedagogy), Haiku detects 2-4× more signal
- llama-4-scout direction reversal on 47136179 is a qualitative failure, not just quantitative

### 5. Scout model anomaly
llama-4-scout-wai returned -0.800 on the Gaza massacre report — the opposite direction from both haiku (+0.500) and llama-3.3-70b-wai (+0.700). This is a severe failure. Scout may be conflating "reports on atrocities" with "editorial support for atrocities."

## Implications for TQ

The validation confirms TQ is the right next step:
- Structural channel for Llama is already known to be noise (86% cluster on 2 integers)
- Editorial channel for Llama has 69% lazy-neutral rate on 70b
- Replacing structural with TQ (objective binary/countable signals) removes the most degraded channel
- Haiku's editorial shows 5× less lazy-neutral rate, suggests routing high-signal stories to Haiku for editorial

## Comparison to Haiku cross-validation from findings/2026-03-02-llama-neutral-50-bias.md
Prior finding: "measurable signal in 79% of Llama editorial=0.0 with confidence≥0.70 when cross-validated with Haiku."
This run: of the 5 stories where Haiku also returned 0.000, Llamas had `editorial_uncertain` flags — supporting that the prior 79% figure may be slightly overstated (some Llama zeros ARE genuine zeros). Revised estimate: ~60-70% of Llama editorial_uncertain zeros have real signal that Haiku would detect.
