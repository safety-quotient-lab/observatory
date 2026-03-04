# PTD Inter-Rater Reliability: Cohen's Kappa on Propaganda Technique Detection
**Date:** 2026-03-04
**n=331 stories** with 2 distinct full-eval models (dominant pair)
**Models:** claude-haiku-4-5-20251001 vs deepseek-v3.2
**Method:** Binary technique presence per story per model. Cohen's κ for pairwise agreement.

## Result

**Overall κ (any technique detected) = 0.3250 — Fair agreement**

Standard kappa benchmarks: <0.2=slight, 0.21–0.40=fair, 0.41–0.60=moderate, 0.61–0.80=substantial, >0.80=almost perfect.

**Critical finding: Detection rate asymmetry is the dominant problem.**
- Haiku: detects PT in 149/331 stories = **45.0%**
- DeepSeek: detects PT in 51/331 stories = **15.4%**
- Both detect: 48 stories (14.5%)
- Neither detects: 179 stories (54.1%)

The asymmetry (3× gap in detection rate) is the primary driver of low κ. Models are not calibrated to the same threshold — Haiku is far more willing to flag marginal or subtle techniques.

## Per-Technique Agreement

| Technique | κ | Haiku rate | DeepSeek rate | Both | Notes |
|---|---|---|---|---|---|
| loaded_language | **0.480** | 28.4% | 13.6% | 40 | Best agreement — most concrete technique |
| exaggeration | **0.330** | 4.5% | 5.4% | 6 | Rates similar; moderate agreement |
| appeal_to_fear | 0.289 | 15.1% | 3.3% | 10 | Asymmetric |
| false_dilemma | 0.241 | 1.5% | 0.9% | 1 | Too rare for reliable estimate |
| causal_oversimplification | 0.173 | 7.0% | 2.1% | 3 | Asymmetric |
| bandwagon | 0.138 | 3.9% | 0.3% | 1 | Asymmetric |
| flag_waving | 0.124 | 3.9% | 0.6% | 1 | Asymmetric |
| name_calling | 0.149 | 0.3% | 3.6% | 1 | DeepSeek higher — opposite asymmetry |
| repetition | 0.097 | 0.9% | 4.5% | 1 | DeepSeek higher |
| appeal_to_authority | 0.019 | 13.6% | 1.2% | 1 | Near-zero agreement |
| appeal_to_efficiency/emotion/framing/obfuscation/whataboutism | 0.000 | <3% | 0% | 0 | No co-detections |
| slogans / thought_terminating_cliche | ≈0.000 | <1% | <1% | 0 | Too rare |

## Implications

### 1. Only `loaded_language` has usable inter-rater reliability (κ=0.48)
This makes intuitive sense: loaded language is the most concrete and lexically grounded technique (specific word choices). All other techniques require more contextual judgment where models diverge.

### 2. Haiku is a more aggressive PT detector (same pattern as editorial)
Haiku flags PT in 45% of stories; DeepSeek in 15%. This mirrors the editorial channel finding (`findings/2026-03-03-haiku-llama-lite-calibration.md`): Haiku detects more signal. For PTD, however, it's not clear which model is "right" — Haiku may be over-detecting or DeepSeek under-detecting.

### 3. Multi-model PTD consensus is not reliable enough for publication
Current `pt_score` is an aggregate across models but with this detection asymmetry, the score is predominantly driven by whichever model has higher coverage in a given story's eval set. Without a calibration reference, PTD cannot be meaningfully published.

### 4. TODO.md implications
The PTD item in TODO.md Phase 0 reads:
> "Multi-model agreement on technique presence (binary) is tractable for inter-rater reliability"

This claim is **partially wrong**. Agreement is only tractable for `loaded_language` (κ=0.48). For all other techniques, agreement is below the minimum threshold for reliability. Updating TODO.md to reflect this.

## Path Forward

**Option A — Reduce to 3 categories**: Consolidate 17 techniques into 3 broad families with clearer operational definitions:
- `Emotive manipulation` (loaded_language + appeal_to_fear + appeal_to_emotion + name_calling)
- `Logical fallacy` (false_dilemma + causal_oversimplification + appeal_to_authority)
- `Rhetorical device` (flag_waving + bandwagon + repetition + slogans)

With consolidation, per-category κ would likely reach 0.40–0.55 (moderate). This is the recommended path.

**Option B — Haiku-only PTD**: Drop multi-model consensus for PTD. Use Haiku as the sole rater since it's the best-performing model overall. Single-rater score has no "inter-rater" property but is at least consistent.

**Option C — Defer PTD from published constructs**: Given consequential ethics concerns (PTD is weaponizable as a political label — see `TODO.md` Perspective 4) and the low inter-rater reliability, PTD remains an internal research construct only. Not published. This is already the current position.

**Recommendation: Option C short-term, Option A for eventual publication.** The ethical caution on PTD publication is independent of reliability. Fix the technique consolidation problem when/if the decision is made to publish PTD.

## Comparison to Prior Findings

The overall κ=0.325 (fair) for PTD contrasts with:
- Discriminant validity r=0.08 (PASS) — HRCB is not sentiment
- Haiku editorial lazy-neutral rate: 0% — vs Llama 69%

Pattern: **Haiku is the most consistently calibrated model across all channels**. DeepSeek shows similar calibration issues to Llama (lower detection rates, higher neutral rates) when paired with Haiku on the same content.
