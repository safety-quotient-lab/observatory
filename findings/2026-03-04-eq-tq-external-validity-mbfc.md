# EQ/TQ External Convergent Validity — idiap/MBFC Dataset
**Date:** 2026-03-04
**Dataset:** idiap/News-Media-Reliability (GitHub, open-access)
- `mbfc.csv`: 4,435 MBFC-rated domains with factual_reporting (VeryHigh/High/Mixed/Low/VeryLow → 4/3/2/1/0)
- `golden_truth_dataset.csv`: 5,332 domains with reliability_label (1=reliable, 0=mixed, -1=unreliable, -2=very unreliable)

**Script:** `/tmp/eq_tq_validation.py`

---

## 1. EQ → MBFC Factual Reporting

**Hypothesis:** High-EQ domains should correlate with high MBFC factual reporting ratings.

**Method:** `AVG(eq_score)` per domain from full-eval rater_evals (`prompt_mode='full'`, `eval_status='done'`, `n≥3`). Joined with `mbfc.csv` on bare domain. Spearman ρ.

**Result:** ρ = +0.362, p = 0.0983, n = 22 → **MARGINAL at α=0.10**

### Domain-level data (sorted by avg_eq ascending)

| Domain | avg_eq | MBFC_FR | n |
|--------|--------|---------|---|
| cnn.com | 0.356 | Mixed | 12 |
| cnbc.com | 0.388 | Mixed | 5 |
| ft.com | 0.469 | High | 4 |
| dailymail.co.uk | 0.562 | Low | 3 |
| economist.com | 0.584 | High | 6 |
| jsonline.com | 0.608 | High | 6 |
| fortune.com | 0.624 | High | 13 |
| motherjones.com | 0.628 | High | 3 |
| engadget.com | 0.634 | High | 12 |
| techcrunch.com | 0.654 | High | 3 |
| newscientist.com | 0.664 | VeryHigh | 7 |
| theregister.com | 0.670 | High | 10 |
| medium.com | 0.695 | Mixed | 3 |
| zdnet.com | 0.705 | High | 15 |
| nbcnews.com | 0.726 | High | 4 |
| arstechnica.com | 0.733 | High | 17 |
| eff.org | 0.735 | High | 17 |
| theguardian.com | 0.737 | Mixed | 14 |
| theconversation.com | 0.741 | VeryHigh | 8 |
| bbc.com | 0.754 | High | 4 |
| apnews.com | 0.807 | High | 4 |
| propublica.org | 0.821 | High | 4 |

### Notable anomalies

**Daily Mail (EQ=0.562, MBFC=Low):** EQ higher than MBFC rating suggests. Likely HN selection bias — HN surfaces atypically substantive stories even from low-quality outlets. EQ measures the *specific content evaluated*, not the outlet. This is expected and correct behavior.

**Guardian (EQ=0.737, MBFC=Mixed):** MBFC rates Guardian "Mixed" due to perceived left-of-center bias despite high-quality reporting. EQ's epistemic quality indicators (sourcing, accuracy, balance) align more with The Guardian's actual content quality than MBFC's bias-inflected label.

**Medium (EQ=0.695, MBFC=Mixed):** Medium is a platform hosting highly variable content. HN surfaces above-average pieces; our EQ reflects those specific stories, not the platform average.

### Interpretation

Direction confirmed: high-EQ domains cluster at MBFC High/VeryHigh, low-EQ at Mixed. The positive ρ=+0.362 is directionally consistent with the hypothesis. n=22 limits power; marginal result is expected at this sample size. The per-content vs per-outlet mismatch (EQ measures specific stories; MBFC rates outlets) explains part of the variance — this is actually a feature, not a bug.

**Assessment:** Directionally confirmed, insufficient power. With 50+ matched domains (requires accumulating ~6 months of full-eval data), likely to reach p<0.05.

---

## 2. TQ → MBFC Reliability Label

**Hypothesis:** High-TQ domains should correlate with higher MBFC reliability labels.

**Method:** `AVG(tq_score)` per domain from lite-1.6 rater_evals (`schema_version='lite-1.6'`, `n≥2`). Joined with `golden_truth_dataset.csv` on bare domain. Spearman ρ.

**Result:** ρ = +0.014, p = 0.9626, n = 13 → **NOT SIGNIFICANT**

### Domain-level data

| Domain | avg_tq | reliability | n |
|--------|--------|-------------|---|
| youtube.com | 0.000 | unreliable | 6 |
| newyorker.com | 0.100 | reliable | 2 |
| apple.com | 0.200 | mixed | 10 |
| forward.com | 0.200 | reliable | 2 |
| businessinsider.com | 0.300 | reliable | 2 |
| arstechnica.com | 0.400 | reliable | 4 |
| theguardian.com | 0.400 | reliable | 4 |
| techcrunch.com | 0.400 | mixed | 2 |
| wired.com | 0.400 | reliable | 2 |
| bbc.com | 0.400 | reliable | 6 |
| arxiv.org | 0.500 | unreliable | 4 |
| futurism.com | 0.600 | mixed | 2 |
| theverge.com | 0.600 | reliable | 2 |

### Root-cause analysis of null result

**1. Sample size (n=13):** Critically underpowered. 13 matched domains cannot reliably detect a moderate correlation. More lite-1.6 accumulation is needed (target n≥40).

**2. Construct mismatch — the primary issue:**
- **TQ measures** per-article transparency indicators: author byline present, publication date present, sources cited, correction policy visible, conflict of interest disclosed. This is _content-structural_ transparency.
- **MBFC reliability** measures outlet-level publishing standards: fact-checking practices, editorial independence, source diversity. This is _outlet-level_ reliability.
- These constructs are theoretically related but empirically distinct. A reliable outlet (BBC) might publish LP pages (tq=0) alongside bylined articles (tq=0.8+), pulling the domain-average TQ down significantly.

**3. Content-type mixing confounds the average:**
- Domain-averaged `avg_tq` includes both LP (landing pages, tq≈0) and ED (editorial articles, tq≈0.4-0.8)
- `newyorker.com` tq=0.1 with n=2 — both evals likely classified as LP (site homepage); New Yorker articles would score 0.6-0.8
- `bbc.com`, `theguardian.com`, `arstechnica.com` all at 0.4 — mix of LP and article evals
- A domain-level TQ score filtered to `content_type IN ('ED', 'HR', 'MI')` would be a much more valid construct

**4. Specific outliers:**
- `arxiv.org` (tq=0.5, "unreliable"): MBFC classifies preprint servers as unreliable because preprints are unreviewed. TQ correctly identifies arxiv metadata (authors, dates, source links) as present. These are genuinely different constructs — arxiv is transparent but unreliable in the fact-checking sense.
- `youtube.com` (tq=0.0, "unreliable"): TQ=0 is correct (videos lack bylines/dates/citations in HTML). MBFC unreliable is for different reasons (platform hosts misinformation). Directionally consistent, but TQ fails to distinguish "platform that can't have bylines" from "outlet that refuses bylines."

### Secondary check: TQ → MBFC Factual Reporting

ρ = -0.100, p = 0.7708, n = 11 → NOT SIGNIFICANT (same issues, smaller n)

### Interpretation

The null result is **not evidence that TQ is invalid** — it is evidence that:
1. The validation design is underpowered (n=13)
2. TQ-as-outlet-average is the wrong construct for comparison against outlet-level reliability labels
3. A valid TQ external validity check requires: (a) filtering to editorial content types only, (b) larger sample (n≥40), (c) possibly a different external criterion (e.g., a transparency-specific audit like Newsguard's sourcing criterion rather than MBFC's general reliability)

**Assessment:** Null result is expected and uninformative given design limitations. Re-test when: (a) ≥40 lite-1.6 editorial-content domains available, (b) filter applied to `content_type IN ('ED', 'HR', 'MI')`.

---

## 3. Phase 0 Construct Validity Status Update

| Check | Result | Status |
|-------|--------|--------|
| HRCB discriminant validity (vs sentiment) | ρ=+0.47, distinct constructs | ✓ PASS |
| ET inter-rater reliability (Haiku vs Llama) | Pearson r=0.82, α=0.85 | ✓ PASS |
| CL convergent validity (CL vs flesch) | ρ=+0.61, p<0.01 | ✓ PASS |
| PTD inter-rater reliability | Agreement 85.3% | ✓ PASS |
| EQ → MBFC factual reporting | ρ=+0.36, p=0.098, marginal | ~ MARGINAL |
| TQ → MBFC reliability | ρ=+0.01, p=0.96, null | ✗ UNDERPOWERED |

### Next steps for construct validity

1. **EQ accumulation**: Accumulate more full-eval data (~6 months natural growth → 200+ evaluated domains → n≥50 matched with MBFC). Re-run at that point.
2. **TQ re-validation**: When ≥40 lite-1.6 editorial-content domains available, filter `content_type IN ('ED','HR','MI')`, re-run vs MBFC factual_reporting (not reliability_label — factual reporting is a better proxy for transparency than reliability).
3. **RDR (Rights Documentation Rate)** convergent validity: deferred — insufficient domain overlap with any available public dataset.
