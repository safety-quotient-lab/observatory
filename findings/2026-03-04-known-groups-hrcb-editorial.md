# Known-Groups Validity — HRCB Editorial Channel
**Date:** 2026-03-04
**Construct:** HRCB editorial channel (`hcb_editorial_mean`), full-eval, `prompt_mode='full'`
**Test:** Three pre-classified groups expected to differ on rights-orientation. Hypothesis: EP > EN > EC.

---

## Group Definitions

The HN corpus skews heavily toward tech content. True rights-negative sites (state propaganda, tabloids) are underrepresented with <2 full evals each, so the three-group design targets the realistic variation within the corpus:

- **EP** — Rights advocacy orgs + independent/investigative journalism (explicitly rights-positive mission)
- **EN** — Tech news, mainstream reference, neutral informational outlets
- **EC** — Corporate PR blogs, financial/business-first, product-focused outlets

Domain selection rationale: prior-classification using MBFC factual reporting, outlet mission statements, and ownership structure. All domains have ≥2 full evals in D1.

---

## Results

### EP — Rights Advocacy / Investigative (n=15 domains)

| Domain | avg_e | n | Classification |
|--------|-------|---|----------------|
| www.eff.org | 0.539 | 17 | Digital rights org |
| f-droid.org | 0.441 | 7 | Open source / user freedom |
| www.nbcnews.com | 0.415 | 4 | Mainstream public interest |
| www.motherjones.com | 0.407 | 3 | Investigative journalism |
| www.propublica.org | 0.390 | 4 | Investigative journalism |
| www.dropsitenews.com | 0.366 | 4 | Independent investigative |
| www.ifixit.com | 0.362 | 3 | Right to repair advocacy |
| www.404media.co | 0.349 | 6 | Independent tech journalism |
| www.thebignewsletter.com | 0.342 | 7 | Antitrust / power concentration |
| hacks.mozilla.org | 0.318 | 16 | Open web / digital rights |
| www.theguardian.com | 0.312 | 14 | Public interest journalism |
| archive.org | 0.310 | 7 | Digital preservation / open access |
| theconversation.com | 0.282 | 8 | Academic public interest |
| apnews.com | 0.244 | 4 | Wire service (factual) |
| www.bbc.com | 0.146 | 4 | Public broadcaster |

**Group mean: 0.348** (min=0.146, max=0.539)

### EN — Tech News / Neutral Reference (n=16 domains)

| Domain | avg_e | n | Classification |
|--------|-------|---|----------------|
| en.wikipedia.org | 0.329 | 7 | Encyclopedia |
| spectrum.ieee.org | 0.318 | 7 | Engineering/science news |
| www.engadget.com | 0.285 | 12 | Tech news |
| www.popsci.com | 0.248 | 2 | Science journalism |
| hackaday.com | 0.247 | 7 | Hardware/maker news |
| www.economist.com | 0.234 | 6 | Business/policy analysis |
| www.wsj.com | 0.233 | 2 | Financial/news |
| www.zdnet.com | 0.232 | 15 | Tech news |
| www.cnn.com | 0.225 | 9 | Mainstream news |
| arstechnica.com | 0.217 | 17 | Tech journalism |
| www.theregister.com | 0.206 | 10 | Tech journalism |
| www.newscientist.com | 0.182 | 7 | Science news |
| www.latimes.com | 0.163 | 2 | Mainstream news |
| arxiv.org | 0.124 | 7 | Preprint server |
| www.theverge.com | 0.042 | 2 | Tech news |
| www.politico.com | -0.004 | 2 | Political news |

**Group mean: 0.205** (min=-0.004, max=0.329)

### EC — Corporate / Commercial-First (n=13 domains)

| Domain | avg_e | n | Classification |
|--------|-------|---|----------------|
| www.blog.google | 0.290 | 2 | Google corporate blog |
| blogs.windows.com | 0.247 | 8 | Microsoft corporate blog |
| 9to5google.com | 0.168 | 11 | Google product news |
| 9to5mac.com | 0.165 | 14 | Apple product news |
| www.xda-developers.com | 0.151 | 6 | Device/product news |
| techcrunch.com | 0.140 | 3 | Startup/VC-focused |
| www.neowin.net | 0.139 | 6 | Product news |
| fortune.com | 0.128 | 13 | Business/commercial |
| nvidianews.nvidia.com | 0.122 | 4 | NVIDIA PR |
| blog.google | 0.091 | 9 | Google corporate blog |
| www.coindesk.com | 0.063 | 6 | Crypto/financial |
| twitter.com | 0.058 | 4 | Platform |
| www.cnbc.com | 0.015 | 3 | Financial news |

**Group mean: 0.137** (min=0.015, max=0.290)

---

## Statistical Tests

| Test | Statistic | p-value | Result |
|------|-----------|---------|--------|
| Kruskal-Wallis (3-way) | H=23.411 | p<0.0001 | **SIGNIFICANT** |
| Mann-Whitney EP > EN | U=214 | p=0.0001 | **SIGNIFICANT** |
| Mann-Whitney EN > EC | U=154 | p=0.0150 | **SIGNIFICANT** |
| Mann-Whitney EP > EC | U=187 | p<0.0001 | **SIGNIFICANT** |
| Ordering EP > EN > EC | 0.348 > 0.205 > 0.137 | — | **CONFIRMED** |

---

## Interpretation

**PASS.** HRCB editorial channel correctly discriminates across all three groups with high statistical confidence (p<0.0001 overall, all pairwise comparisons significant). The effect is robust:

- EP/EN separation is largest (Δ=0.143) and most significant (p=0.0001) — the primary discrimination the construct claims to make
- EN/EC separation is smaller (Δ=0.068) but still significant (p=0.015) — commercial-first outlets genuinely score lower than neutral journalism
- EP/EC gap is Δ=0.211 — over 20 HRCB points separating advocacy from corporate content

### Why this matters more than the EQ/MBFC result

Known-groups validation is methodologically stronger for a formative composite like HRCB than external dataset correlation, because:
1. The groups are pre-classified by *mission and ownership structure*, not by another measurement instrument — independent of LLM judgments
2. The hypothesis (EP > EN > EC) is derived from the construct definition, not from reverse-engineering from data
3. n=44 total domains provides adequate power; the result is robust to moderate misclassification of borderline cases

### Borderline cases that don't invalidate the result

- **BBC (EP, avg_e=0.146):** Lowest in EP group, overlaps with upper EN. BBC is a public broadcaster with both public-interest and commercial pressures. Reclassifying to EN would only strengthen the EP > EN separation.
- **blog.google / www.blog.google:** Two separate DB entries for the same outlet (domain variation). Both in EC — deduplication would not change group structure.
- **Wikipedia (EN, avg_e=0.329):** High for EN, overlapping with lower EP. Wikipedia's collaborative factual mandate and human rights article coverage generates genuine rights signal. Expected.
- **Politico (EN, avg_e=-0.004):** Lowest in EN, could be classified as EC (political-commercial media). Reclassifying to EC would only strengthen EN > EC separation.

### Corpus limitation

True rights-negative sites (RT, Global Times, PressTV, tabloids) have insufficient full-eval data (typically n<2) because they are underrepresented on HN. A fourth group (EX — state propaganda / misinformation) would be the ideal extension once enough stories from those domains accumulate, or via targeted backfill. Current three-group design is the maximum feasible given the corpus.

---

## Phase 0 Status Update

| Check | Result | Status |
|-------|--------|--------|
| Discriminant validity (vs VADER sentiment) | r=+0.08, p>>0.05 | ✓ PASS |
| Known-groups (EP vs EN vs EC) | H=23.4, p<0.0001, EP>EN>EC | **✓ PASS (strongest result)** |
| ET inter-rater reliability (Haiku vs Llama) | r=0.82, α=0.85 | ✓ PASS |
| CL convergent validity (CL vs Flesch) | ρ=-0.063 | ✗ FAIL (wrong validator) |
| EQ → MBFC factual_reporting | ρ=+0.362, p=0.098 | ~ MARGINAL |
| TQ → MBFC reliability | ρ=+0.014, p=0.96 | ✗ UNDERPOWERED |
| Test-retest reliability (same-day) | r=0.984, n=11 | ✓ PRELIMINARY |
