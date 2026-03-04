# Wolfram Alpha — Capability Map for HRO

**Key:** `WOLFRAMALPHA_APP_ID` in `site/.dev.vars`
**Free tier:** 2,000 API calls/month (non-commercial). No per-minute limit documented.
**Best endpoint for us:** LLM API (`/api/v1/llm-api`) — plain text, structured, designed for programmatic consumption.

## What Wolfram Alpha Can Do (relevant to us)

### 1. Statistical Validation (HIGH value)

Wolfram Alpha is a computational engine, not a search engine. It can compute statistics from data we supply or validate mathematical claims.

**Levers we can pull:**
- **Kruskal-Wallis significance**: We claim H=23.4, p<0.0001 for known-groups. Wolfram can verify: `Kruskal-Wallis test H=23.4 df=2 p-value`
- **Correlation significance**: Our discriminant validity r=0.08 — query: `correlation r=0.08 n=800 significance test`
- **Cohen's kappa interpretation**: PTD κ=0.325 — query: `Cohen's kappa 0.325 interpretation`
- **Effect size calculations**: Convert our test statistics to standardized effect sizes
- **Distribution properties**: Query statistical properties of our score distributions (if we format them)

**Budget estimate:** ~20-50 calls for full validation sweep. Very efficient.

### 2. Readability / Linguistic Metrics (MEDIUM value)

- **Flesch-Kincaid**: `Flesch reading ease score for [text]` — but our texts are too long for query params
- **Word frequency**: `frequency of word "surveillance" in English` — context for jargon density baseline
- **Linguistic data**: Word origins, etymology — could enrich Article 26 (education) analysis

**Limitation:** Can't send full article text. Only useful for short computations or reference data.

### 3. Geographic / Demographic Data (MEDIUM value)

- **Country data**: `population of [country]`, `GDP of [country]`, `internet penetration [country]`
- **Geographic scope enrichment**: Our GS signal identifies geographic mentions — Wolfram can provide structured context (population, HDI, internet access) to weight geographic coverage quality
- **UN membership data**: `UN member states`, `countries that ratified UDHR`

**Budget estimate:** ~30-100 calls to build a geographic context reference table.

### 4. Mathematical Computations (LOW-MEDIUM value)

- **Golden ratio**: We use φ in factions clustering — can verify thresholds
- **PCA eigenvalue interpretation**: Validate our power iteration PCA results
- **Decay curves**: Verify our `exp(-hoursOld/24)` priority scoring decay
- **Information theory**: `entropy of [probability distribution]` — could quantify signal diversity

### 5. Domain/Entity Lookup (LOW value for us)

- **Company info**: `Cloudflare revenue`, `Anthropic founding date` — but we have this from content
- **Standards**: `RFC 5785`, `UDHR Article 19` — returns structured reference text

## What Wolfram Alpha CANNOT Do

- **No text analysis of long documents** — query length limited, not a text processor
- **No web scraping or URL fetching** — can't analyze our pages
- **No machine learning** — can't train on our data
- **No database queries** — can't query D1 directly
- **Not an LLM** — can't generate structured feedback like Gemini/OpenRouter models

## Recommended Use Cases (Priority Order)

### Tier 1 — Statistical Validation Oracle (budget: ~50 calls)
Use Wolfram as a ground-truth calculator for our construct validity claims:
- Verify p-values and effect sizes from our findings/
- Compute confidence intervals we haven't calculated
- Validate our correlation interpretations (weak/moderate/strong thresholds)
- Cross-check any novel statistical claim before publishing

### Tier 2 — Geographic Context Enrichment (budget: ~100 calls)
Build a reference table of country-level data for GS signal interpretation:
- Internet penetration rates (digital divide context for Article 19)
- HDI scores (development context for Article 25-26)
- Press freedom indices if available
- Cache results — these change slowly

### Tier 3 — Mathematical Verification (budget: ~20 calls)
Spot-check our computational choices:
- Clustering thresholds (1/φ, 1/φ²)
- Consensus weighting formulas
- Decay curve parameters

## Budget Allocation (2,000/month)

| Use case | Calls/month | Notes |
|----------|-------------|-------|
| Statistical validation | 50-100 | Burst during validation phases |
| Geographic enrichment | 50-100 | One-time build, then cache |
| Math verification | 10-20 | Ad hoc |
| Epistemic benchmark | 30-50 | If added as a dimension |
| Reserve | ~1,700 | Mostly unused — free tier is generous |

## Integration Pattern

```js
// LLM API — simplest endpoint
const url = `https://www.wolframalpha.com/api/v1/llm-api?input=${encodeURIComponent(query)}&appid=${APP_ID}`;
const res = await fetch(url);
const text = await res.text(); // plain text, not JSON
```

Short Answers API for single-value lookups:
```js
const url = `http://api.wolframalpha.com/v1/result?i=${encodeURIComponent(query)}&appid=${APP_ID}`;
```

## Next Steps

1. ~~Add as provider to `external-feedback.mjs`~~ ✓ DONE
2. Build `scripts/wolfram-validate.mjs` for statistical validation of findings/
3. ~~Document in MEMORY.md~~ ✓ DONE
