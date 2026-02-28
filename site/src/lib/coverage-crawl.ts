/**
 * Coverage-driven crawl strategies.
 *
 * Identifies gaps in the evaluated dataset and uses the HN Algolia Search API
 * to find stories that fill them.
 */

import { extractDomain } from './shared-eval';

// --- Types ---

export interface AlgoliaHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number | null;
  num_comments: number | null;
  created_at_i: number;
  story_text: string | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
  page: number;
  nbPages: number;
}

export interface CoverageResult {
  strategy: string;
  inserted: number;
  skipped: number;
  details: Record<string, unknown>;
}

export type StrategyName =
  | 'domain_min_coverage'
  | 'hrcb_spectrum_gaps'
  | 'content_type_gaps'
  | 'high_setl_deep_dive'
  | 'submitter_network'
  | 'temporal_backfill'
  | 'article_gap_fill';

export const STRATEGY_NAMES: StrategyName[] = [
  'domain_min_coverage',
  'hrcb_spectrum_gaps',
  'content_type_gaps',
  'high_setl_deep_dive',
  'submitter_network',
  'temporal_backfill',
  'article_gap_fill',
];

export interface StrategyOptions {
  article?: string;
}

// --- Eager consumer: sleeper detector rules ---

export interface SleeperRule {
  /** Short identifier for this rule (used in eval_error tagging). */
  label: string;
  /** Maximum HN score (points) to qualify. Omit = no upper bound. */
  maxScore?: number;
  /** Minimum HN score (points) to qualify. Omit = no lower bound. */
  minScore?: number;
  /** Minimum comment count to qualify. Omit = no requirement. */
  minComments?: number;
  /** Maximum age in hours to qualify. Omit = no age limit. */
  maxAgeHours?: number;
}

/**
 * Pluggable rules for the eager search consumer.
 * Add/remove rules here without touching search.astro logic.
 * Each rule independently queries Algolia and inserts matching stories as pending.
 */
export const SLEEPER_RULES: SleeperRule[] = [
  { label: 'high_engagement', minScore: 100, maxAgeHours: 7 * 24 },
  { label: 'sleeper', maxScore: 10, minComments: 5, maxAgeHours: 12 },
];

/** Minute → strategy mapping (1x/hour each, staggered) */
export const STRATEGY_SCHEDULE: Record<number, StrategyName> = {
  3: 'domain_min_coverage',
  8: 'article_gap_fill',
  13: 'hrcb_spectrum_gaps',
  23: 'content_type_gaps',
  33: 'high_setl_deep_dive',
  43: 'submitter_network',
  53: 'temporal_backfill',
};

const ALGOLIA_DELAY_MS = 1100; // 1.1s between Algolia calls

// --- Algolia helper ---

interface AlgoliaSearchParams {
  query?: string;
  tags?: string;
  numericFilters?: string;
  hitsPerPage?: number;
  byDate?: boolean;
}

export async function searchAlgolia(params: AlgoliaSearchParams): Promise<AlgoliaHit[]> {
  const endpoint = params.byDate
    ? 'https://hn.algolia.com/api/v1/search_by_date'
    : 'https://hn.algolia.com/api/v1/search';

  const qs = new URLSearchParams();
  if (params.query) qs.set('query', params.query);
  if (params.tags) qs.set('tags', params.tags);
  if (params.numericFilters) qs.set('numericFilters', params.numericFilters);
  qs.set('hitsPerPage', String(params.hitsPerPage ?? 20));

  const res = await fetch(`${endpoint}?${qs.toString()}`);
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
  const data = (await res.json()) as AlgoliaResponse;
  return data.hits;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Story insert helper ---

interface InsertResult {
  inserted: number;
  skipped: number;
}

export async function insertAlgoliaHits(
  db: D1Database,
  hits: AlgoliaHit[],
  hnType: string,
  strategy: string,
): Promise<InsertResult> {
  let inserted = 0;
  let skipped = 0;

  // Batch inserts in groups of 50
  for (let i = 0; i < hits.length; i += 50) {
    const batch = hits.slice(i, i + 50);
    const stmts = batch
      .filter((h) => h.objectID && h.title)
      .map((h) => {
        const hnId = parseInt(h.objectID, 10);
        if (isNaN(hnId)) return null;
        const domain = h.url ? extractDomain(h.url) : null;
        return db
          .prepare(
            `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status, eval_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          )
          .bind(
            hnId,
            h.url || null,
            h.title,
            domain,
            h.points ?? null,
            h.num_comments ?? null,
            h.author || null,
            h.created_at_i || Math.floor(Date.now() / 1000),
            hnType,
            h.story_text || null,
            `coverage:${strategy}`,
          );
      })
      .filter((s): s is D1PreparedStatement => s !== null);

    if (stmts.length === 0) continue;

    const results = await db.batch(stmts);
    for (const r of results) {
      if (r.meta?.changes && r.meta.changes > 0) inserted++;
      else skipped++;
    }
  }

  return { inserted, skipped };
}

// --- Strategy implementations ---

async function strategyDomainMinCoverage(
  db: D1Database,
): Promise<CoverageResult> {
  // Find domains with only 1-2 evaluations, pick 5 random ones
  const { results: domains } = await db
    .prepare(
      `SELECT domain, COUNT(*) as cnt FROM stories
       WHERE eval_status = 'done' AND domain IS NOT NULL
       GROUP BY domain HAVING cnt <= 2
       ORDER BY RANDOM() LIMIT 5`,
    )
    .all<{ domain: string; cnt: number }>();

  let totalInserted = 0;
  let totalSkipped = 0;
  const domainResults: string[] = [];

  for (const d of domains) {
    try {
      const hits = await searchAlgolia({
        query: d.domain,
        tags: 'story',
        numericFilters: 'points>50',
        hitsPerPage: 10,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'domain_min_coverage');
      totalInserted += inserted;
      totalSkipped += skipped;
      domainResults.push(`${d.domain}:${inserted}/${hits.length}`);
    } catch (err) {
      console.error(`[coverage] domain_min_coverage failed for ${d.domain}:`, err);
    }
    await sleep(ALGOLIA_DELAY_MS);
  }

  return {
    strategy: 'domain_min_coverage',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { domains_queried: domains.length, domain_results: domainResults },
  };
}

async function strategyHrcbSpectrumGaps(
  db: D1Database,
): Promise<CoverageResult> {
  // Build histogram of HRCB scores in 0.2-width bins from -1.0 to +1.0
  // Find bins with <5 stories
  const { results: binCounts } = await db
    .prepare(
      `SELECT
         CAST(ROUND(hcb_weighted_mean / 0.2) * 0.2 AS REAL) as bin,
         COUNT(*) as cnt
       FROM stories
       WHERE eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       GROUP BY bin
       ORDER BY bin`,
    )
    .all<{ bin: number; cnt: number }>();

  // Full range of bins
  const allBins = [-1.0, -0.8, -0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const countMap = new Map<number, number>();
  for (const b of binCounts) countMap.set(Math.round(b.bin * 10) / 10, b.cnt);

  const sparseBins = allBins.filter((b) => (countMap.get(b) ?? 0) < 5);
  const targetBins = sparseBins.slice(0, 3); // Cap at 3 bins

  let totalInserted = 0;
  let totalSkipped = 0;
  const binResults: string[] = [];

  for (const bin of targetBins) {
    // Find domains whose avg score falls in this bin range
    const { results: domainRows } = await db
      .prepare(
        `SELECT domain FROM stories
         WHERE eval_status = 'done' AND hcb_weighted_mean IS NOT NULL AND domain IS NOT NULL
           AND hcb_weighted_mean >= ? AND hcb_weighted_mean < ?
         GROUP BY domain
         ORDER BY RANDOM() LIMIT 2`,
      )
      .bind(bin - 0.1, bin + 0.1)
      .all<{ domain: string }>();

    for (const d of domainRows) {
      try {
        const hits = await searchAlgolia({
          query: d.domain,
          tags: 'story',
          numericFilters: 'points>30',
          hitsPerPage: 10,
        });
        const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'hrcb_spectrum_gaps');
        totalInserted += inserted;
        totalSkipped += skipped;
        binResults.push(`bin=${bin},domain=${d.domain}:${inserted}`);
      } catch (err) {
        console.error(`[coverage] hrcb_spectrum_gaps failed for bin=${bin}, domain=${d.domain}:`, err);
      }
      await sleep(ALGOLIA_DELAY_MS);
    }
  }

  return {
    strategy: 'hrcb_spectrum_gaps',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { sparse_bins: sparseBins, targeted_bins: targetBins, bin_results: binResults },
  };
}

async function strategyContentTypeGaps(
  db: D1Database,
): Promise<CoverageResult> {
  // Check hn_type counts for ask/show/job
  const { results: typeCounts } = await db
    .prepare(
      `SELECT hn_type, COUNT(*) as cnt FROM stories
       WHERE eval_status = 'done' AND hn_type IN ('ask', 'show', 'job')
       GROUP BY hn_type`,
    )
    .all<{ hn_type: string; cnt: number }>();

  const countMap = new Map<string, number>();
  for (const t of typeCounts) countMap.set(t.hn_type, t.cnt);

  const tagMap: Record<string, string> = {
    ask: 'ask_hn',
    show: 'show_hn',
    job: 'job',
  };

  let totalInserted = 0;
  let totalSkipped = 0;
  const typeResults: string[] = [];

  for (const hnType of ['ask', 'show', 'job']) {
    const cnt = countMap.get(hnType) ?? 0;
    if (cnt >= 50) continue;

    try {
      const hits = await searchAlgolia({
        tags: tagMap[hnType],
        numericFilters: 'points>30',
        hitsPerPage: 20,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, hnType, 'content_type_gaps');
      totalInserted += inserted;
      totalSkipped += skipped;
      typeResults.push(`${hnType}:${inserted}/${hits.length}(was ${cnt})`);
    } catch (err) {
      console.error(`[coverage] content_type_gaps failed for ${hnType}:`, err);
    }
    await sleep(ALGOLIA_DELAY_MS);
  }

  return {
    strategy: 'content_type_gaps',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { current_counts: Object.fromEntries(countMap), type_results: typeResults },
  };
}

async function strategyHighSetlDeepDive(
  db: D1Database,
): Promise<CoverageResult> {
  // Find domains with avg |SETL| > 0.15 and only 1-3 evaluations
  // SETL = |editorial - structural| divergence, approximated from scores table
  const { results: domains } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as cnt,
              AVG(ABS(COALESCE(sc.editorial, 0) - COALESCE(sc.structural, 0))) as avg_setl
       FROM stories s
       JOIN rater_scores sc ON s.hn_id = sc.hn_id AND sc.eval_model = s.eval_model
       WHERE s.eval_status = 'done' AND s.domain IS NOT NULL
       GROUP BY s.domain
       HAVING COUNT(*) <= 3 AND AVG(ABS(COALESCE(sc.editorial, 0) - COALESCE(sc.structural, 0))) > 0.15
       ORDER BY avg_setl DESC
       LIMIT 5`,
    )
    .all<{ domain: string; cnt: number; avg_setl: number }>();

  let totalInserted = 0;
  let totalSkipped = 0;
  const domainResults: string[] = [];

  for (const d of domains) {
    try {
      const hits = await searchAlgolia({
        query: d.domain,
        tags: 'story',
        numericFilters: 'points>30',
        hitsPerPage: 10,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'high_setl_deep_dive');
      totalInserted += inserted;
      totalSkipped += skipped;
      domainResults.push(`${d.domain}(setl=${d.avg_setl.toFixed(2)}):${inserted}`);
    } catch (err) {
      console.error(`[coverage] high_setl_deep_dive failed for ${d.domain}:`, err);
    }
    await sleep(ALGOLIA_DELAY_MS);
  }

  return {
    strategy: 'high_setl_deep_dive',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { domains_found: domains.length, domain_results: domainResults },
  };
}

async function strategySubmitterNetwork(
  db: D1Database,
): Promise<CoverageResult> {
  // Find HN users with karma > 10k and <3 evaluated stories
  const { results: users } = await db
    .prepare(
      `SELECT u.username, u.karma,
              (SELECT COUNT(*) FROM stories s WHERE s.hn_by = u.username AND s.eval_status = 'done') as eval_cnt
       FROM hn_users u
       WHERE u.karma > 10000
         AND (SELECT COUNT(*) FROM stories s WHERE s.hn_by = u.username AND s.eval_status = 'done') < 3
       ORDER BY u.karma DESC
       LIMIT 5`,
    )
    .all<{ username: string; karma: number; eval_cnt: number }>();

  let totalInserted = 0;
  let totalSkipped = 0;
  const userResults: string[] = [];

  for (const u of users) {
    try {
      const hits = await searchAlgolia({
        tags: `story,author_${u.username}`,
        numericFilters: 'points>50',
        hitsPerPage: 10,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'submitter_network');
      totalInserted += inserted;
      totalSkipped += skipped;
      userResults.push(`${u.username}(karma=${u.karma}):${inserted}`);
    } catch (err) {
      console.error(`[coverage] submitter_network failed for ${u.username}:`, err);
    }
    await sleep(ALGOLIA_DELAY_MS);
  }

  return {
    strategy: 'submitter_network',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { users_found: users.length, user_results: userResults },
  };
}

async function strategyTemporalBackfill(
  db: D1Database,
): Promise<CoverageResult> {
  // Find weeks in the last 6 months with <10 evaluated stories
  const sixMonthsAgo = Math.floor(Date.now() / 1000) - 180 * 86400;

  const { results: weekCounts } = await db
    .prepare(
      `SELECT
         CAST(hn_time / 604800 AS INTEGER) as week_num,
         MIN(hn_time) as week_start,
         COUNT(*) as cnt
       FROM stories
       WHERE eval_status = 'done' AND hn_time >= ?
       GROUP BY week_num
       ORDER BY cnt ASC`,
    )
    .bind(sixMonthsAgo)
    .all<{ week_num: number; week_start: number; cnt: number }>();

  // Also find weeks with zero evals by checking expected week range
  const nowWeek = Math.floor(Date.now() / 1000 / 604800);
  const startWeek = Math.floor(sixMonthsAgo / 604800);
  const sparseWeeks: { week_num: number; start: number; end: number }[] = [];

  for (let w = startWeek; w <= nowWeek; w++) {
    const existing = weekCounts.find((wc) => wc.week_num === w);
    if (!existing || existing.cnt < 10) {
      sparseWeeks.push({ week_num: w, start: w * 604800, end: (w + 1) * 604800 });
    }
  }

  const targetWeeks = sparseWeeks.slice(0, 3); // Cap at 3 weeks

  let totalInserted = 0;
  let totalSkipped = 0;
  const weekResults: string[] = [];

  for (const w of targetWeeks) {
    try {
      const hits = await searchAlgolia({
        tags: 'story',
        numericFilters: `points>100,created_at_i>${w.start},created_at_i<${w.end}`,
        hitsPerPage: 20,
        byDate: true,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'temporal_backfill');
      totalInserted += inserted;
      totalSkipped += skipped;
      const weekDate = new Date(w.start * 1000).toISOString().slice(0, 10);
      weekResults.push(`${weekDate}:${inserted}/${hits.length}`);
    } catch (err) {
      console.error(`[coverage] temporal_backfill failed for week ${w.week_num}:`, err);
    }
    await sleep(ALGOLIA_DELAY_MS);
  }

  return {
    strategy: 'temporal_backfill',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: { sparse_weeks: sparseWeeks.length, targeted_weeks: targetWeeks.length, week_results: weekResults },
  };
}

// --- Article gap fill ---

const ARTICLE_SEARCH_TERMS: Record<number, string[]> = {
  0:  ['universal human rights declaration', 'human rights framework'],
  1:  ['human dignity equality', 'discrimination dehumanization'],
  2:  ['racial discrimination', 'gender discrimination rights'],
  3:  ['right to life', 'extrajudicial killing', 'death penalty'],
  4:  ['forced labor', 'human trafficking', 'modern slavery'],
  5:  ['torture', 'police brutality', 'cruel punishment'],
  6:  ['stateless person', 'legal personhood', 'undocumented rights'],
  7:  ['equal protection law', 'discrimination lawsuit', 'anti-discrimination'],
  8:  ['denied justice', 'judicial remedy', 'legal rights violation'],
  9:  ['arbitrary detention', 'political prisoner', 'wrongful arrest'],
  10: ['fair trial rights', 'judicial independence', 'due process'],
  11: ['presumption innocence', 'wrongful conviction', 'criminal justice reform'],
  12: ['privacy violation', 'surveillance', 'data protection'],
  13: ['freedom of movement', 'travel ban', 'immigration restriction'],
  14: ['asylum seeker', 'refugee crisis', 'deportation'],
  15: ['statelessness', 'citizenship revoked', 'nationality rights'],
  16: ['child marriage', 'same-sex marriage ban', 'family separation policy', 'forced marriage'],
  17: ['property rights', 'land seizure', 'eminent domain abuse'],
  18: ['religious persecution', 'blasphemy law', 'freedom of religion'],
  19: ['censorship', 'press freedom', 'free speech crackdown'],
  20: ['protest crackdown', 'freedom of assembly', 'union busting'],
  21: ['election interference', 'voter suppression', 'democratic backsliding'],
  22: ['social safety net', 'welfare cuts', 'universal basic income'],
  23: ['labor exploitation', 'wage theft', 'workers rights'],
  24: ['overwork death karoshi', 'labor rights working hours', 'right to rest'],
  25: ['homelessness crisis', 'healthcare access', 'poverty living standards'],
  26: ['education access', 'school segregation', 'right to education'],
  27: ['intellectual property', 'cultural heritage', 'scientific access'],
  28: ['international order', 'rule of law', 'global governance'],
  29: ['civic responsibility', 'rights limitations', 'public order'],
  30: ['rights destruction', 'authoritarian abuse rights', 'rights abolition'],
};

async function strategyArticleGapFill(
  db: D1Database,
  options?: StrategyOptions,
): Promise<CoverageResult> {
  // Query per-article signal counts
  const { results: articleStats } = await db
    .prepare(
      `SELECT sc.section, sc.sort_order,
              SUM(CASE WHEN sc.final IS NOT NULL THEN 1 ELSE 0 END) as signal_count,
              SUM(CASE WHEN sc.final < 0 THEN 1 ELSE 0 END) as neg_count
       FROM rater_scores sc
       JOIN stories s ON s.hn_id = sc.hn_id
       WHERE sc.eval_model = s.eval_model
       GROUP BY sc.section
       ORDER BY sc.sort_order`,
    )
    .all<{ section: string; sort_order: number; signal_count: number; neg_count: number }>();

  // Build a map of sort_order → stats
  const statsMap = new Map<number, { signal_count: number; neg_count: number; section: string }>();
  for (const row of articleStats) {
    statsMap.set(row.sort_order, { signal_count: row.signal_count, neg_count: row.neg_count, section: row.section });
  }

  // Determine target articles
  let targetArticles: { sort_order: number; gap: number; section: string }[];

  if (options?.article) {
    const artNum = parseInt(options.article, 10);
    if (isNaN(artNum) || artNum < 0 || artNum > 30) {
      return { strategy: 'article_gap_fill', inserted: 0, skipped: 0, details: { error: `Invalid article number: ${options.article}` } };
    }
    const stats = statsMap.get(artNum);
    const gap = stats
      ? Math.max(0, 80 - stats.signal_count) + 3 * Math.max(0, 10 - stats.neg_count)
      : 80 + 30; // No data = max gap
    const section = stats?.section ?? (artNum === 0 ? 'Preamble' : `Article ${artNum}`);
    targetArticles = [{ sort_order: artNum, gap, section }];
  } else {
    // Compute gap score for all articles, pick top 5
    const allGaps: { sort_order: number; gap: number; section: string }[] = [];
    for (let i = 0; i <= 30; i++) {
      const stats = statsMap.get(i);
      const signal_count = stats?.signal_count ?? 0;
      const neg_count = stats?.neg_count ?? 0;
      const gap = Math.max(0, 80 - signal_count) + 3 * Math.max(0, 10 - neg_count);
      if (gap > 0) {
        const section = stats?.section ?? (i === 0 ? 'Preamble' : `Article ${i}`);
        allGaps.push({ sort_order: i, gap, section });
      }
    }
    allGaps.sort((a, b) => b.gap - a.gap);
    targetArticles = allGaps.slice(0, 5);
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  const articleResults: string[] = [];

  for (const target of targetArticles) {
    const terms = ARTICLE_SEARCH_TERMS[target.sort_order];
    if (!terms || terms.length === 0) continue;

    // Collect hits across all search terms for this article
    const allHits: AlgoliaHit[] = [];
    const seenIds = new Set<string>();

    for (const term of terms) {
      try {
        const hits = await searchAlgolia({
          query: term,
          tags: 'story',
          numericFilters: 'points>20',
          hitsPerPage: 50,
        });
        for (const h of hits) {
          if (!seenIds.has(h.objectID)) {
            seenIds.add(h.objectID);
            allHits.push(h);
          }
        }
      } catch (err) {
        console.error(`[coverage] article_gap_fill search failed for "${term}":`, err);
      }
      await sleep(ALGOLIA_DELAY_MS);
    }

    // Rank by engagement: (points + num_comments) descending, take top 15
    allHits.sort((a, b) => ((b.points ?? 0) + (b.num_comments ?? 0)) - ((a.points ?? 0) + (a.num_comments ?? 0)));
    const topHits = allHits.slice(0, 15);

    if (topHits.length > 0) {
      const { inserted, skipped } = await insertAlgoliaHits(db, topHits, 'story', 'article_gap_fill');
      totalInserted += inserted;
      totalSkipped += skipped;
      const stats = statsMap.get(target.sort_order);
      articleResults.push(
        `${target.section}(gap=${target.gap},signals=${stats?.signal_count ?? 0},neg=${stats?.neg_count ?? 0}):${inserted}/${topHits.length}`,
      );
    }
  }

  return {
    strategy: 'article_gap_fill',
    inserted: totalInserted,
    skipped: totalSkipped,
    details: {
      target_articles: targetArticles.map((a) => ({ sort_order: a.sort_order, section: a.section, gap: a.gap })),
      article_results: articleResults,
    },
  };
}

// --- Strategy dispatcher ---

type StrategyFn = (db: D1Database, options?: StrategyOptions) => Promise<CoverageResult>;

const STRATEGY_FNS: Record<StrategyName, StrategyFn> = {
  domain_min_coverage: strategyDomainMinCoverage,
  hrcb_spectrum_gaps: strategyHrcbSpectrumGaps,
  content_type_gaps: strategyContentTypeGaps,
  high_setl_deep_dive: strategyHighSetlDeepDive,
  submitter_network: strategySubmitterNetwork,
  temporal_backfill: strategyTemporalBackfill,
  article_gap_fill: strategyArticleGapFill,
};

/**
 * Run the coverage strategy scheduled for a given minute.
 * Returns null if no strategy is scheduled for that minute.
 */
export async function runScheduledCoverageStrategy(
  minute: number,
  db: D1Database,
): Promise<CoverageResult | null> {
  const strategy = STRATEGY_SCHEDULE[minute];
  if (!strategy) return null;

  console.log(`[coverage] Running ${strategy}`);
  return STRATEGY_FNS[strategy](db, undefined);
}

/**
 * Run one or all coverage strategies manually.
 */
export async function runCoverageStrategy(
  strategy: StrategyName | 'all',
  db: D1Database,
  options?: StrategyOptions,
): Promise<CoverageResult[]> {
  const strategies = strategy === 'all' ? STRATEGY_NAMES : [strategy];
  const results: CoverageResult[] = [];

  for (const s of strategies) {
    console.log(`[coverage] Running ${s}`);
    const result = await STRATEGY_FNS[s](db, options);
    results.push(result);
  }

  return results;
}
