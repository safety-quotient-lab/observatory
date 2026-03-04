---
name: validate-stat
description: Verify statistical claims (p-values, effect sizes, correlation significance) against Wolfram Alpha as ground truth. Use on findings/ documents or any construct validity claim before publishing.
user-invocable: true
argument-hint: "<statistical claim to verify, e.g. 'H=23.4 df=2 p<0.0001' or path to findings/ file>"
allowed-tools: Read, Grep, Glob, Bash
---

# Statistical Validation via Wolfram Alpha

Verify statistical claims using Wolfram Alpha as an independent computational oracle.

## Step 1: Identify claims

If given a file path, read it and extract all statistical claims:
- p-values (e.g., p<0.0001)
- Test statistics (H, t, F, chi-squared)
- Correlation coefficients (r, rho, kappa)
- Effect sizes (Cohen's d, eta-squared)
- Sample sizes and degrees of freedom

If given a direct claim, parse it into components.

## Step 2: Formulate Wolfram queries

For each claim, construct the appropriate Wolfram Alpha query. Examples:

| Claim | Wolfram query |
|-------|---------------|
| H=23.4, df=2, p<0.0001 | `P(X > 23.4) for chi-squared distribution df=2` |
| r=0.08, n=800 | `significance of correlation r=0.08 n=800` |
| kappa=0.325 | `Cohen's kappa 0.325 interpretation` |
| Cohen's d from t=3.2, n=50 | `Cohen's d for t=3.2 n1=50 n2=50` |

## Step 3: Query Wolfram

Run each query using the external-feedback script:

```bash
node scripts/external-feedback.mjs --provider wolfram --prompt "<query>"
```

For single-value lookups, use `--model short`:
```bash
node scripts/external-feedback.mjs --provider wolfram --model short --prompt "<query>"
```

## Step 4: Compare and report

For each claim, report:
- **Claim**: what we stated
- **Wolfram result**: what Wolfram computed
- **Verdict**: CONFIRMED / CLOSE (within rounding) / DISCREPANT / UNVERIFIABLE

Present as a table. Flag any discrepancies immediately.

## Budget awareness

Each Wolfram query costs 1 of 2,000 free monthly calls. A typical validation run uses 5-20 calls. Report calls used at the end.
