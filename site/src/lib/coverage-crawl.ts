/**
 * Coverage-driven crawl strategies.
 *
 * Identifies gaps in the evaluated dataset and uses the HN Algolia Search API
 * to find stories that fill them. All strategies share a daily budget cap
 * stored in KV.
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
  | 'temporal_backfill';

export const STRATEGY_NAMES: StrategyName[] = [
  'domain_min_coverage',
  'hrcb_spectrum_gaps',
  'content_type_gaps',
  'high_setl_deep_dive',
  'submitter_network',
  'temporal_backfill',
];

/** Minute → strategy mapping (1x/hour each, staggered) */
export const STRATEGY_SCHEDULE: Record<number, StrategyName> = {
  3: 'domain_min_coverage',
  13: 'hrcb_spectrum_gaps',
  23: 'content_type_gaps',
  33: 'high_setl_deep_dive',
  43: 'submitter_network',
  53: 'temporal_backfill',
};

const DEFAULT_DAILY_BUDGET = 100;
const ALGOLIA_DELAY_MS = 1100; // 1.1s between Algolia calls

// --- Algolia helper ---

interface AlgoliaSearchParams {
  query?: string;
  tags?: string;
  numericFilters?: string;
  hitsPerPage?: number;
  byDate?: boolean;
}

async function searchAlgolia(params: AlgoliaSearchParams): Promise<AlgoliaHit[]> {
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

async function insertAlgoliaHits(
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

// --- Daily budget ---

function budgetKey(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `coverage-budget:${yyyy}-${mm}-${dd}`;
}

async function getRemainingBudget(kv: KVNamespace, maxBudget: number): Promise<number> {
  const key = budgetKey();
  const val = await kv.get(key);
  if (val === null) return maxBudget;
  const used = parseInt(val, 10);
  return Math.max(0, maxBudget - (isNaN(used) ? 0 : used));
}

async function consumeBudget(kv: KVNamespace, count: number): Promise<void> {
  const key = budgetKey();
  const val = await kv.get(key);
  const used = val !== null ? parseInt(val, 10) || 0 : 0;
  await kv.put(key, String(used + count), { expirationTtl: 172800 }); // 48h TTL
}

// --- Strategy implementations ---

async function strategyDomainMinCoverage(
  db: D1Database,
  kv: KVNamespace,
  maxBudget: number,
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
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

    const cap = Math.min(10, remaining);
    try {
      const hits = await searchAlgolia({
        query: d.domain,
        tags: 'story',
        numericFilters: 'points>50',
        hitsPerPage: cap,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'domain_min_coverage');
      totalInserted += inserted;
      totalSkipped += skipped;
      if (inserted > 0) await consumeBudget(kv, inserted);
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
  kv: KVNamespace,
  maxBudget: number,
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
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

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
      const cap = Math.min(10, remaining);
      try {
        const hits = await searchAlgolia({
          query: d.domain,
          tags: 'story',
          numericFilters: 'points>30',
          hitsPerPage: cap,
        });
        const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'hrcb_spectrum_gaps');
        totalInserted += inserted;
        totalSkipped += skipped;
        if (inserted > 0) await consumeBudget(kv, inserted);
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
  kv: KVNamespace,
  maxBudget: number,
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

    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

    const cap = Math.min(20, remaining);
    try {
      const hits = await searchAlgolia({
        tags: tagMap[hnType],
        numericFilters: 'points>30',
        hitsPerPage: cap,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, hnType, 'content_type_gaps');
      totalInserted += inserted;
      totalSkipped += skipped;
      if (inserted > 0) await consumeBudget(kv, inserted);
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
  kv: KVNamespace,
  maxBudget: number,
): Promise<CoverageResult> {
  // Find domains with avg |SETL| > 0.15 and only 1-3 evaluations
  // SETL = |editorial - structural| divergence, approximated from scores table
  const { results: domains } = await db
    .prepare(
      `SELECT s.domain, COUNT(*) as cnt,
              AVG(ABS(COALESCE(sc.editorial, 0) - COALESCE(sc.structural, 0))) as avg_setl
       FROM stories s
       JOIN scores sc ON s.hn_id = sc.hn_id
       WHERE s.eval_status = 'done' AND s.domain IS NOT NULL
       GROUP BY s.domain
       HAVING cnt <= 3 AND avg_setl > 0.15
       ORDER BY avg_setl DESC
       LIMIT 5`,
    )
    .all<{ domain: string; cnt: number; avg_setl: number }>();

  let totalInserted = 0;
  let totalSkipped = 0;
  const domainResults: string[] = [];

  for (const d of domains) {
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

    const cap = Math.min(10, remaining);
    try {
      const hits = await searchAlgolia({
        query: d.domain,
        tags: 'story',
        numericFilters: 'points>30',
        hitsPerPage: cap,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'high_setl_deep_dive');
      totalInserted += inserted;
      totalSkipped += skipped;
      if (inserted > 0) await consumeBudget(kv, inserted);
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
  kv: KVNamespace,
  maxBudget: number,
): Promise<CoverageResult> {
  // Find HN users with karma > 10k and <3 evaluated stories
  const { results: users } = await db
    .prepare(
      `SELECT u.username, u.karma,
              (SELECT COUNT(*) FROM stories s WHERE s.hn_by = u.username AND s.eval_status = 'done') as eval_cnt
       FROM hn_users u
       WHERE u.karma > 10000
       HAVING eval_cnt < 3
       ORDER BY u.karma DESC
       LIMIT 5`,
    )
    .all<{ username: string; karma: number; eval_cnt: number }>();

  let totalInserted = 0;
  let totalSkipped = 0;
  const userResults: string[] = [];

  for (const u of users) {
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

    const cap = Math.min(10, remaining);
    try {
      const hits = await searchAlgolia({
        tags: `story,author_${u.username}`,
        numericFilters: 'points>50',
        hitsPerPage: cap,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'submitter_network');
      totalInserted += inserted;
      totalSkipped += skipped;
      if (inserted > 0) await consumeBudget(kv, inserted);
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
  kv: KVNamespace,
  maxBudget: number,
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
  const weekSet = new Set(weekCounts.map((w) => w.week_num));
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
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) break;

    const cap = Math.min(20, remaining);
    try {
      const hits = await searchAlgolia({
        tags: 'story',
        numericFilters: `points>100,created_at_i>${w.start},created_at_i<${w.end}`,
        hitsPerPage: cap,
        byDate: true,
      });
      const { inserted, skipped } = await insertAlgoliaHits(db, hits, 'story', 'temporal_backfill');
      totalInserted += inserted;
      totalSkipped += skipped;
      if (inserted > 0) await consumeBudget(kv, inserted);
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

// --- Strategy dispatcher ---

const STRATEGY_FNS: Record<StrategyName, (db: D1Database, kv: KVNamespace, maxBudget: number) => Promise<CoverageResult>> = {
  domain_min_coverage: strategyDomainMinCoverage,
  hrcb_spectrum_gaps: strategyHrcbSpectrumGaps,
  content_type_gaps: strategyContentTypeGaps,
  high_setl_deep_dive: strategyHighSetlDeepDive,
  submitter_network: strategySubmitterNetwork,
  temporal_backfill: strategyTemporalBackfill,
};

/**
 * Run the coverage strategy scheduled for a given minute.
 * Returns null if no strategy is scheduled for that minute.
 */
export async function runScheduledCoverageStrategy(
  minute: number,
  db: D1Database,
  kv: KVNamespace,
  dailyBudget?: number,
): Promise<CoverageResult | null> {
  const strategy = STRATEGY_SCHEDULE[minute];
  if (!strategy) return null;

  const maxBudget = dailyBudget ?? DEFAULT_DAILY_BUDGET;
  const remaining = await getRemainingBudget(kv, maxBudget);
  if (remaining <= 0) {
    console.log(`[coverage] Daily budget exhausted (${maxBudget}), skipping ${strategy}`);
    return null;
  }

  console.log(`[coverage] Running ${strategy} (budget remaining: ${remaining}/${maxBudget})`);
  return STRATEGY_FNS[strategy](db, kv, maxBudget);
}

/**
 * Run one or all coverage strategies manually.
 */
export async function runCoverageStrategy(
  strategy: StrategyName | 'all',
  db: D1Database,
  kv: KVNamespace,
  dailyBudget?: number,
): Promise<CoverageResult[]> {
  const maxBudget = dailyBudget ?? DEFAULT_DAILY_BUDGET;
  const strategies = strategy === 'all' ? STRATEGY_NAMES : [strategy];
  const results: CoverageResult[] = [];

  for (const s of strategies) {
    const remaining = await getRemainingBudget(kv, maxBudget);
    if (remaining <= 0) {
      console.log(`[coverage] Daily budget exhausted, stopping at ${s}`);
      break;
    }
    console.log(`[coverage] Running ${s} (budget remaining: ${remaining}/${maxBudget})`);
    const result = await STRATEGY_FNS[s](db, kv, maxBudget);
    results.push(result);
  }

  return results;
}
