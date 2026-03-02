# Llama Neutral-50 Bias — Diagnostic Findings

**Date:** 2026-03-02
**Severity:** High (affects ~65-70% of all lite evaluations)
**Status:** Diagnosed, fix deployed (2026-03-02)

## Summary

Both Llama models (llama-3.3-70b-wai and llama-4-scout-wai) default to `editorial: 50` (neutral) on the lite-1.4 integer 0-100 scale for approximately 65-70% of all stories evaluated. Cross-validation against Claude Haiku full evaluations shows 79% of these "neutral" stories have meaningful UDHR signal that Llama fails to detect.

## Root Cause

**Model comprehension gap, not a pipeline bug.** The integer-to-float conversion pipeline works correctly. Llama treats "human rights relevance" as requiring explicit rights vocabulary — it doesn't detect implicit UDHR signals (access, transparency, labor, privacy) that pervade tech content.

## Evidence

### Score Distribution (all-time, n≈6000 lite evals)

| Provider | Model | Mode | Count | Avg WM | Zeros | %Zero |
|----------|-------|------|-------|--------|-------|-------|
| workers-ai | llama-3.3-70b-wai | lite | 2986 | 0.092 | 2080 | 69.7% |
| workers-ai | llama-4-scout-wai | lite | 3005 | 0.100 | 1931 | 64.3% |
| claude-code-standalone | claude-haiku-4-5 | lite | 228 | 0.234 | 110 | 48.2% |
| anthropic | claude-haiku-4-5-20251001 | full | 281 | 0.198 | 4 | 1.4% |
| claude-code-standalone | claude-haiku-4-5-20251001 | full | 304 | 0.262 | 2 | 0.7% |

### Llama Score Histogram (llama-4-scout-wai)

```
  -0.8      3  (  0.1%)
  -0.6      6  (  0.2%)
  -0.4     16  (  0.5%)
  -0.2     43  (  1.4%)  #
  +0.0   1931  ( 64.3%)  ################################################################
  +0.1    325  ( 10.8%)  ##########
  +0.2    119  (  4.0%)  ###
  +0.3     92  (  3.1%)  ###
  +0.4    205  (  6.8%)  ######
  +0.6    176  (  5.9%)  #####
  +0.7     36  (  1.2%)  #
  +0.8     23  (  0.8%)
```

### Compare: Claude Haiku Full (n=585)

```
  -0.5      6  (  1.0%)  #
  -0.3     14  (  2.4%)  ##
  -0.1     19  (  3.2%)  ###
  +0.0     40  (  6.8%)  ######
  +0.1     95  ( 16.2%)  ################
  +0.2    142  ( 24.3%)  ########################
  +0.3     96  ( 16.4%)  ################
  +0.4     73  ( 12.5%)  ############
  +0.5     48  (  8.2%)  ########
  +0.6     28  (  4.8%)  ####
```

### Cross-Model Validation (same stories)

512 stories that Llama scored 0.0, also evaluated by Haiku:

| Metric | Value |
|--------|-------|
| Haiku avg score for Llama zeros | +0.178 |
| Haiku also near-zero (±0.05) | 110/512 (21%) |
| Haiku positive (>0.1) | 348/512 (68%) |
| Haiku strongly positive (>0.3) | 124/512 (24%) |
| Haiku negative (<-0.1) | 31/512 (6%) |

**79% of stories Llama calls neutral, Haiku detects meaningful UDHR signal.**

### Worst Divergences (Llama=0, Haiku scored)

| Haiku | Story |
|-------|-------|
| +0.750 | Amazon scooped up data from sellers to launch competing products |
| +0.712 | First Website |
| +0.700 | Do not download the app, use the website |
| +0.700 | Full Time (labor rights context) |
| +0.657 | Access to a Shared Unix Computer |
| +0.650 | Academic Torrents — Making 27TB of research data available |
| +0.650 | The unreasonable effectiveness of simple HTML |

### Reasoning Field Analysis

Llama neutral-50 reasoning samples:
- "Tech query, no rights stance"
- "tech blog no rights stance"
- "Editorial on Lean Startup, no human rights discussion"
- "Technical announcement list, no explicit rights discussion"
- "ED, neutral tech discussion"

**Pattern:** Llama requires EXPLICIT rights discussion to move off 50. It doesn't detect implicit rights signals that Haiku picks up via the UDHR framework.

### Confidence Analysis

Llama scores confidence 0.8-1.0 even for incorrect neutral scores — confidently wrong, not uncertain. This defeats the consensus weighting system, which uses confidence as a quality signal.

## Pipeline Verification

- **NOT a parsing bug** — confirmed via `hcb_json` inspection. The stored JSON shows post-conversion values. `editorial: 0` in `hcb_json` = post-conversion from integer 50.
- **NOT a scale confusion** — Llama non-zero values distribute correctly on the 0-100 integer scale (e.g., raw 55 → stored 0.1, raw 78 → stored 0.56).
- **Conversion logic is correct** — `eval-parse.ts:367-382` properly detects `lite-1.4` schema version and applies `(score - 50) / 50`.

## Remediation

### 1. Prompt Engineering (METHODOLOGY_LITE)

Add implicit rights signal examples to the lite prompt. The current prompt only shows explicit rights examples (NGO missions, surveillance). Llama needs to see that tech content about access, transparency, labor, and privacy maps to UDHR provisions at 55-65.

Add anti-50 instruction: "Score 48 or 52 when uncertain — reserve 50 for content with literally zero UDHR connection."

### 2. Validation Warning (eval-parse.ts)

Flag `editorial=50` (post-conversion 0.0) with high confidence as `suspect_lazy_neutral` in the repair log. Don't reject — but make the signal visible for audit.

### 3. Consensus Weighting (eval-write.ts)

Apply additional discount to lite evals that score exactly 0.0 with confidence > 0.7. The confident-neutral pattern is the specific failure mode — models that are genuinely uncertain should emit lower confidence instead.

### 4. Re-evaluation Sweep

After prompt fix deploys, run `sweep=failed` or a custom sweep to re-evaluate the ~4000 Llama zero stories with the improved prompt.

## Files Modified

| File | Change |
|------|--------|
| `site/src/lib/methodology-content.ts` | Expanded METHODOLOGY_LITE with implicit rights examples + anti-50 instruction |
| `site/src/lib/eval-parse.ts` | Added suspect_lazy_neutral warning for editorial=50 + high confidence |
| `site/src/lib/eval-write.ts` | Added neutral discount in consensus weighting for confident-zero lite evals |
| `scripts/evaluate-standalone.mjs` | Synced inlined lite prompt with methodology-content.ts changes |
