// SPDX-License-Identifier: Apache-2.0
/**
 * Geographic reference data for GS signal enrichment.
 * Source: Wolfram Alpha (2023 estimates), generated 2026-03-05.
 * 22 countries, 30 Wolfram calls. Refresh annually.
 */

export interface GeoCountry {
  population: number;
  internet_penetration: number;
  hdi: number;
  corpus_mentions: number;
}

/** Countries mentioned in corpus with Wolfram-sourced demographics */
export const GEO_COUNTRIES: Record<string, GeoCountry> = {
  'United States':  { population: 343_000_000, internet_penetration: 0.931, hdi: 0.920, corpus_mentions: 300 },
  'United Kingdom': { population:  68_700_000, internet_penetration: 0.963, hdi: 0.910, corpus_mentions:  48 },
  'China':          { population: 1_420_000_000, internet_penetration: 0.920, hdi: 0.738, corpus_mentions:  25 },
  'Japan':          { population: 124_000_000, internet_penetration: 0.870, hdi: 0.903, corpus_mentions:  19 },
  'Germany':        { population:  84_500_000, internet_penetration: 0.935, hdi: 0.926, corpus_mentions:  15 },
  'Canada':         { population:  39_300_000, internet_penetration: 0.940, hdi: 0.920, corpus_mentions:  14 },
  'France':         { population:  66_400_000, internet_penetration: 0.887, hdi: 0.897, corpus_mentions:  13 },
  'Australia':      { population:  26_500_000, internet_penetration: 0.971, hdi: 0.939, corpus_mentions:  12 },
  'Israel':         { population:   9_260_000, internet_penetration: 0.882, hdi: 0.899, corpus_mentions:  11 },
  'Netherlands':    { population:  18_100_000, internet_penetration: 0.970, hdi: 0.924, corpus_mentions:  10 },
  'Iran':           { population:  90_600_000, internet_penetration: 0.796, hdi: 0.774, corpus_mentions:   9 },
  'India':          { population: 1_440_000_000, internet_penetration: 0.559, hdi: 0.624, corpus_mentions:   9 },
  'Ukraine':        { population:  37_700_000, internet_penetration: 0.824, hdi: 0.743, corpus_mentions:   7 },
  'Russia':         { population: 145_000_000, internet_penetration: 0.944, hdi: 0.804, corpus_mentions:   7 },
  'Brazil':         { population: 211_000_000, internet_penetration: 0.845, hdi: 0.754, corpus_mentions:   6 },
  'Spain':          { population:  47_900_000, internet_penetration: 0.958, hdi: 0.884, corpus_mentions:   5 },
  'South Korea':    { population:  51_700_000, internet_penetration: 0.979, hdi: 0.901, corpus_mentions:   5 },
  'Vietnam':        { population: 100_000_000, internet_penetration: 0.842, hdi: 0.683, corpus_mentions:   5 },
  'Iraq':           { population:  45_100_000, internet_penetration: 0.817, hdi: 0.649, corpus_mentions:   4 },
  'Turkey':         { population:  87_300_000, internet_penetration: 0.873, hdi: 0.767, corpus_mentions:   4 },
  'Poland':         { population:  38_800_000, internet_penetration: 0.886, hdi: 0.855, corpus_mentions:   4 },
  'Italy':          { population:  59_500_000, internet_penetration: 0.892, hdi: 0.887, corpus_mentions:   4 },
};

export const WORLD_POPULATION = 8_100_000_000;

/** Large-population countries with zero corpus mentions */
export const UNDERREPRESENTED = [
  { country: 'Indonesia',  population: 277_000_000 },
  { country: 'Pakistan',   population: 240_000_000 },
  { country: 'Nigeria',    population: 224_000_000 },
  { country: 'Bangladesh', population: 173_000_000 },
  { country: 'Ethiopia',   population: 126_000_000 },
];

/** Compute GS enrichment insights from reference data */
export function computeGeoInsights() {
  const countries = Object.entries(GEO_COUNTRIES);
  const totalMentions = countries.reduce((s, [, c]) => s + c.corpus_mentions, 0);
  const totalPopCovered = countries.reduce((s, [, c]) => s + c.population, 0);
  const coveragePct = Math.round((totalPopCovered / WORLD_POPULATION) * 100);

  // US dominance
  const usMentions = GEO_COUNTRIES['United States']?.corpus_mentions ?? 0;
  const usMentionPct = totalMentions > 0 ? Math.round((usMentions / totalMentions) * 100) : 0;

  // Underrepresented population
  const underrepPop = UNDERREPRESENTED.reduce((s, c) => s + c.population, 0);

  // Weighted average HDI of covered countries (by mentions)
  let hdiSum = 0, hdiWeight = 0;
  for (const [, c] of countries) {
    hdiSum += c.hdi * c.corpus_mentions;
    hdiWeight += c.corpus_mentions;
  }
  const avgHdiCovered = hdiWeight > 0 ? hdiSum / hdiWeight : null;

  return {
    totalMentions,
    totalPopCovered,
    coveragePct,
    usMentionPct,
    underrepPop,
    underrepCountries: UNDERREPRESENTED.length,
    avgHdiCovered,
  };
}
