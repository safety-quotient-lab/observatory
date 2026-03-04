---
name: verify-math
description: Spot-check mathematical formulas, thresholds, and computations used in the codebase against Wolfram Alpha. Covers clustering thresholds (phi-based), decay curves, consensus weighting, and any novel formula.
user-invocable: true
argument-hint: "<formula or concept to verify, e.g. '1/phi threshold' or 'exp(-x/24) decay at 48 hours'>"
allowed-tools: Read, Grep, Glob, Bash
---

# Mathematical Verification via Wolfram Alpha

Spot-check our computational choices against Wolfram Alpha as ground truth.

## Step 1: Identify the formula

If given a concept name, locate it in the codebase:
- **Clustering thresholds**: `1/phi` and `1/phi^2` in `factions.astro` / `compute-aggregates.ts`
- **Decay curves**: `exp(-hoursOld/24)` in `eval_priority_score` (hn-bot.ts)
- **Consensus weighting**: `baseWeight * confidenceFactor * truncDiscount * neutralDiscount` in `eval-write.ts`
- **SETL computation**: editorial/structural divergence formula
- **PCA power iteration**: eigenvalue extraction in `SignalSpace.astro`

If given a direct formula, parse it.

## Step 2: Formulate Wolfram queries

Translate each formula into Wolfram-parseable queries:

| Formula | Wolfram query |
|---------|---------------|
| 1/phi | `1/golden ratio` |
| 1/phi^2 | `1/(golden ratio)^2` |
| exp(-48/24) | `e^(-48/24)` |
| SETL threshold 0.25 | `abs(0.6 - 0.1)` (verify with example values) |
| Shannon entropy | `entropy of {0.3, 0.3, 0.2, 0.1, 0.1}` |

## Step 3: Query Wolfram

```bash
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "<query>"
```

Use `--model short` for single-value answers, default `llm-api` for detailed breakdowns.

## Step 4: Report

For each formula:
- **What we use**: the value or formula in our code
- **Wolfram says**: the computed result
- **Match**: YES / CLOSE / NO
- **Impact if wrong**: what would break

## Common verifications

These are pre-built queries for our most-used math:

```bash
# Golden ratio thresholds (factions clustering)
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "1/golden ratio"
# Expected: 0.618034...

# Phi-squared threshold
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "1/(golden ratio)^2"
# Expected: 0.381966...

# Priority decay at 48 hours
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "e^(-48/24)"
# Expected: 0.135335...

# Volatility threshold (stddev)
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "standard deviation of {0.1, 0.3, -0.2, 0.15, -0.1}"
```

## Budget awareness

Math verification is lightweight: 1-5 calls per check. Typical session: 5-15 calls.
