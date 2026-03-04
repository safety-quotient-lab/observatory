---
name: geo-enrich
description: Look up country-level data from Wolfram Alpha (HDI, internet penetration, population, press freedom) to enrich Geographic Scope (GS) signal context and build reference data for Article 19/25/26 framing.
user-invocable: true
argument-hint: "<country or region name, or 'build-table' to generate reference data for all common GS mentions>"
allowed-tools: Read, Grep, Glob, Bash, Write
---

# Geographic Enrichment via Wolfram Alpha

Enrich our Geographic Scope (GS) supplementary signal with structured country-level data.

## Mode 1: Single country lookup

Given a country name, query Wolfram Alpha for:

1. **Population**: `node scripts/external-feedback.mjs --provider wolfram --model short --prompt "population of <country>"`
2. **Internet penetration**: `--prompt "internet users in <country>"`
3. **HDI**: `--prompt "human development index <country>"`
4. **GDP per capita**: `--prompt "GDP per capita <country>"`

Present results in a compact table.

## Mode 2: Build reference table (`build-table`)

1. Read our corpus to find the most common geographic mentions:
   ```bash
   # Query D1 for geographic scope distribution
   npx wrangler d1 execute hrcb-db --remote --command "SELECT gs_primary_region, COUNT(*) as c FROM rater_evals WHERE gs_primary_region IS NOT NULL GROUP BY gs_primary_region ORDER BY c DESC LIMIT 30"
   ```

2. For each region/country, query Wolfram for population + internet users + HDI

3. Write results to `.claude/plans/memorized/geo-reference-data.json`:
   ```json
   {
     "generated_at": "...",
     "wolfram_calls_used": 90,
     "countries": {
       "United States": { "population": "...", "internet_users": "...", "hdi": "...", "gdp_per_capita": "..." }
     }
   }
   ```

4. This reference table enables:
   - Article 19 (expression): digital divide context — what % of a country's population can access the content?
   - Article 25 (standard of living): HDI framing for economic rights stories
   - Article 26 (education): internet access as prerequisite for digital education rights
   - GS signal enrichment: weight coverage gaps by population (missing India ≠ missing Liechtenstein)

## Budget awareness

Single lookup: 3-4 calls. Full table build: 60-120 calls (plan accordingly within 2,000/month free tier). Reference data is slow-changing — rebuild monthly at most.
