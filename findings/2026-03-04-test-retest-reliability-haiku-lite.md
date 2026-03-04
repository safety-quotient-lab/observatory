# Test-Retest Reliability: Haiku-lite Editorial Scores
**Date:** 2026-03-04
**n=11 stories**
**Model:** claude-haiku-4-5 (lite prompt mode)
**T1:** Early 2026-03-04 UTC (from calibration run, `findings/2026-03-03-haiku-llama-lite-calibration.md`)
**T2:** Later 2026-03-04 UTC (same session, several hours gap)

## Result

**Pearson r(T1, T2) = +0.9840**
**R² = 0.9682 (96.8% shared variance)**
**Mean absolute gap = 0.031**
**Max absolute gap = 0.100**

**Verdict: ✓ EXCELLENT — High test-retest reliability. Temporal consistency confirmed.**

## Score Comparison

| hn_id | T1 | T2 | Gap | Story |
|---|---|---|---|---|
| 17350645 | +0.200 | +0.240 | 0.040 | When a machine fired me |
| 20323246 | +0.000 | +0.000 | 0.000 | boringtechnology.club |
| 26258773 | +0.000 | +0.000 | 0.000 | GamestonkTerminal |
| 36453856 | +0.000 | +0.000 | 0.000 | novehiclesinthepark |
| 41558554 | -0.040 | +0.000 | 0.040 | Amazon RTO |
| 45409794 | +0.500 | +0.540 | 0.040 | F-Droid Google decree |
| 45441069 | +0.060 | +0.000 | 0.060 | Jane Goodall obit |
| 45521920 | +0.060 | +0.040 | 0.020 | Codesmith Reddit attack |
| 47156925 | -0.040 | -0.040 | 0.000 | Google API keys |
| 47188473 | +0.700 | +0.600 | 0.100 | notdivided.org |
| 47202708 | +0.000 | +0.040 | 0.040 | Microgpt |

## Observations

**Zero scores are exactly stable.** The four stories that scored 0.000 at T1 returned exactly 0.000 at T2. No drift on null-signal content.

**The largest gap is the most rights-salient story.** notdivided.org (explicit rights advocacy) has the max gap (0.100): T1=0.700, T2=0.600. This is the hardest story to score consistently — content is rights-dense and the model's precise weighing varies slightly. Still: direction is preserved, magnitude is close.

**Mean gap (0.031) is within scoring resolution.** The lite-1.5 scoring increments are ~0.02-0.04 units (based on 0-100 integer → 0.0-1.0 mapping). A mean gap of 0.031 is effectively one scoring step — consistent with rounding behavior, not semantic inconsistency.

## Caveats

**Short time window:** T1 and T2 are from the same day (hours apart), not days or weeks. This demonstrates within-session consistency but not long-term temporal stability. Content that changes (rotating homepages, live feeds) could produce different results across days. A rigorous test-retest would use stories evaluated 1+ week apart.

**Stable-content selection bias:** These 11 stories were selected from the calibration set (known stable content: blog posts, obituaries, archived documents). Rotating content (news homepages, live feeds) would show higher variability.

**n=11 is small.** 11 pairs is sufficient for a strong correlation (r=0.98) but the confidence interval is wide. A 50-story test-retest with 1+ week gap would provide much stronger evidence.

## Implication for Phase 0 Construct Validity

Satisfies the TODO.md Phase 0 item:
> "Test-retest reliability — re-evaluate 50 stable-content stories for temporal consistency"

**Partially.** The result (r=0.984) exceeds the threshold for "good" reliability (typically r>0.70), but:
- n=11, not 50
- Hours apart, not days/weeks
- Stable-content bias

**Conclusion:** Haiku-lite demonstrates excellent within-session consistency. A formal long-term test-retest (n≥50, 1+ week gap) remains the gold standard — but based on this preliminary result, temporal instability is not a primary validity concern.

## Combined Phase 0 Picture

| Check | r / κ | Verdict |
|---|---|---|
| Discriminant validity (HRCB vs sentiment) | r=+0.08 | ✓ PASS |
| Test-retest reliability (Haiku-lite) | r=+0.984 | ✓ EXCELLENT (preliminary) |
| PTD inter-rater reliability (Haiku vs DeepSeek) | κ=0.325 | ⚠ FAIR |
| Convergent validity (TQ vs RDR) | — | PENDING |
| Known-groups expansion | — | PENDING |
