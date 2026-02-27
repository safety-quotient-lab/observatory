/**
 * Cron Worker v6: Thin orchestrator.
 *
 * HN crawling logic lives in src/lib/hn-bot.ts.
 * This file handles:
 * - Cron scheduling (scheduled handler)
 * - HTTP endpoints: /trigger, /calibrate, /calibrate/check, /recalc, /health
 * - Coverage-driven crawl integration
 * - Event pruning
 */

import {
  extractDomain,
  getEnabledModels,
  getEnabledFreeModels,
  type EvalScore,
} from '../src/lib/shared-eval';
import { logEvent, pruneEvents } from '../src/lib/events';
import { CALIBRATION_SET, LIGHT_CALIBRATION_SET, LIGHT_DRIFT_THRESHOLDS, runCalibrationCheck } from '../src/lib/calibration';
import { getPipelineHealth } from '../src/lib/db';
import { runScheduledCoverageStrategy, runCoverageStrategy, STRATEGY_NAMES, type StrategyName, type StrategyOptions } from '../src/lib/coverage-crawl';
import {
  computeAggregates,
  computeDerivedScoreFields,
  computeStoryLevelAggregates,
  computeFairWitnessAggregates,
  type DcpElement,
} from '../src/lib/compute-aggregates';
import { runCrawlCycle, enqueueForEvaluation, dispatchFreeModelEvals } from '../src/lib/hn-bot';
import { getModelQueue } from '../src/lib/shared-eval';

interface Env {
  DB: D1Database;
  EVAL_QUEUE: Queue;
  DEEPSEEK_QUEUE: Queue;
  TRINITY_QUEUE: Queue;
  NEMOTRON_QUEUE: Queue;
  STEP_QUEUE: Queue;
  QWEN_QUEUE: Queue;
  LLAMA_QUEUE: Queue;
  MISTRAL_QUEUE: Queue;
  HERMES_QUEUE: Queue;
  CONTENT_CACHE: KVNamespace;
  CRON_SECRET?: string;
  DAILY_EVAL_BUDGET?: string;
}

// --- Main cron handler ---

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = env.DB;
    const minute = new Date(event.scheduledTime).getMinutes();

    // ─── Distributed lock (prevent overlapping cron cycles) ───
    const lockKey = 'cron:lock';
    try {
      const existing = await env.CONTENT_CACHE.get(lockKey);
      if (existing) {
        console.warn('[cron] Lock held, skipping cycle');
        return;
      }
      await env.CONTENT_CACHE.put(lockKey, new Date().toISOString(), { expirationTtl: 120 });
    } catch (err) {
      console.warn('[cron] KV lock check failed (non-fatal):', err);
    }

    try {
    // ─── HN crawl cycle (fetch, diff, insert, refresh, comments, users, re-eval, enqueue) ───

    let crawlResult: Awaited<ReturnType<typeof runCrawlCycle>>;
    try {
      crawlResult = await runCrawlCycle(db, env.EVAL_QUEUE, env.CONTENT_CACHE, minute);
    } catch (err) {
      console.error('[cron] Crawl cycle failed (non-fatal):', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'error', message: `Crawl cycle failed`, details: { phase: 'crawl', error: String(err) } }).catch(() => {});
      crawlResult = { stories_new: 0, stories_found: 0, feeds: {}, score_refresh: { updates: 0, sweep: 0 } };
    }

    // ─── Multi-model dispatch (every 5 minutes) ───

    if (minute % 5 === 0) {
      try {
        const multiModelResults = await dispatchFreeModelEvals(db, env as unknown as Record<string, any>, 50);
        const totalDispatched = multiModelResults.reduce((sum, r) => sum + r.dispatched, 0);
        if (totalDispatched > 0) {
          console.log(`[multi-model] Dispatched ${totalDispatched} total evals across ${multiModelResults.length} models`);
        }
      } catch (err) {
        console.error('Multi-model dispatch failed (non-fatal):', err);
        await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Multi-model dispatch failed`, details: { phase: 'multi_model', error: String(err) } });
      }
    }

    // ─── Coverage-driven crawl strategies ───

    try {
      const coverageResult = await runScheduledCoverageStrategy(minute, db);
      if (coverageResult && coverageResult.inserted > 0) {
        console.log(`[coverage] ${coverageResult.strategy}: inserted ${coverageResult.inserted} stories`);
        await logEvent(db, {
          event_type: 'coverage_crawl',
          severity: 'info',
          message: `Coverage crawl: ${coverageResult.strategy} inserted ${coverageResult.inserted} stories`,
          details: coverageResult,
        });
      }
    } catch (err) {
      console.error('Coverage crawl failed (non-fatal):', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'warn', message: `Coverage crawl failed`, details: { phase: 'coverage_crawl', error: String(err) } });
    }

    // ─── Event pruning (90-day retention, once per hour) ───

    if (minute === 0) {
      const pruned = await pruneEvents(db, 90);
      if (pruned > 0) console.log(`[events] Pruned ${pruned} events older than 90 days`);
    }

    // ─── Log cron run event ───

    await logEvent(db, {
      event_type: 'cron_run',
      severity: 'info',
      message: `Cron: ${crawlResult.stories_new} new, ${crawlResult.stories_found} unique stories`,
      details: {
        ...crawlResult,
      },
    });

    console.log('Cron cycle complete');

    } catch (err) {
      console.error('[cron] Scheduled handler error:', err);
      await logEvent(db, { event_type: 'cron_error', severity: 'error', message: `Scheduled handler failed: ${String(err).slice(0, 500)}`, details: { error: String(err) } }).catch(() => {});
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth check helper
    const checkAuth = (): Response | null => {
      if (env.CRON_SECRET) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.CRON_SECRET}`) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
      }
      return null;
    };

    if (path === '/trigger') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const sweep = url.searchParams.get('sweep');

      // No sweep param → full cron cycle
      if (!sweep) {
        ctx.waitUntil(
          this.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' } as ScheduledEvent, env, ctx)
        );
        return new Response('Cron triggered', { status: 200 });
      }

      const db = env.DB;
      const rawLimit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

      if (sweep === 'failed') {
        const { meta } = await db
          .prepare(
            `UPDATE stories SET eval_status = 'pending', eval_error = NULL
             WHERE hn_id IN (
               SELECT hn_id FROM stories
               WHERE eval_status = 'failed'
               ORDER BY hn_time DESC
               LIMIT ?
             )`
          )
          .bind(rawLimit)
          .run();
        const promoted = meta?.changes ?? 0;

        if (promoted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep: reset ${promoted} failed stories to pending`,
          details: { sweep: 'failed', promoted, limit: rawLimit },
        });

        return new Response(JSON.stringify({ sweep: 'failed', promoted, description: `Reset ${promoted} failed stories to pending` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'skipped') {
        const minScore = parseInt(url.searchParams.get('min_score') || '50', 10) || 50;

        const { meta } = await db
          .prepare(
            `UPDATE stories SET eval_status = 'pending', eval_error = NULL
             WHERE hn_id IN (
               SELECT hn_id FROM stories
               WHERE eval_status = 'skipped'
                 AND eval_error LIKE 'Not in top%pages'
                 AND url IS NOT NULL
                 AND hn_score >= ?
               ORDER BY hn_score DESC
               LIMIT ?
             )`
          )
          .bind(minScore, rawLimit)
          .run();
        const promoted = meta?.changes ?? 0;

        if (promoted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE);
        }

        await logEvent(db, {
          event_type: 'trigger',
          severity: 'info',
          message: `Sweep: promoted ${promoted} skipped stories to pending (min_score=${minScore})`,
          details: { sweep: 'skipped', promoted, limit: rawLimit, min_score: minScore },
        });

        return new Response(JSON.stringify({ sweep: 'skipped', promoted, description: `Promoted ${promoted} skipped stories with hn_score >= ${minScore} to pending` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (sweep === 'coverage') {
        const strategyParam = url.searchParams.get('strategy') || 'all';

        if (strategyParam !== 'all' && !STRATEGY_NAMES.includes(strategyParam as StrategyName)) {
          return new Response(JSON.stringify({
            error: `Unknown strategy: ${strategyParam}`,
            valid_strategies: ['all', ...STRATEGY_NAMES],
          }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const articleParam = url.searchParams.get('article');
        const strategyOptions: StrategyOptions = {};
        if (articleParam) strategyOptions.article = articleParam;

        const results = await runCoverageStrategy(
          strategyParam as StrategyName | 'all',
          db,
          strategyOptions,
        );

        const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);

        if (totalInserted > 0) {
          await enqueueForEvaluation(db, env.EVAL_QUEUE, env.CONTENT_CACHE);
        }

        await logEvent(db, {
          event_type: 'coverage_crawl',
          severity: 'info',
          message: `Coverage sweep: ${strategyParam}, ${totalInserted} stories inserted`,
          details: { sweep: 'coverage', strategy: strategyParam, total_inserted: totalInserted, results },
        });

        return new Response(JSON.stringify({ sweep: 'coverage', strategy: strategyParam, results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: `Unknown sweep type: ${sweep}`, valid_types: ['failed', 'skipped', 'coverage'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /calibrate — enqueue 15 calibration URLs for evaluation (all enabled models)
    // POST /calibrate?mode=light — insert light calibration URLs as pending for standalone evaluator
    if (path === '/calibrate' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = env.DB;
      const mode = url.searchParams.get('mode');

      // Light mode: insert LIGHT_CALIBRATION_SET stories as pending (hn_ids -2001 to -2015).
      // Evaluation is done by the local evaluate-standalone.mjs script, not Cloudflare queues.
      if (mode === 'light') {
        for (let i = 0; i < LIGHT_CALIBRATION_SET.length; i++) {
          const cal = LIGHT_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const domain = extractDomain(cal.url);
          await db
            .prepare(
              `INSERT INTO stories (hn_id, title, url, domain, hn_score, hn_comments, hn_time, hn_type, eval_status)
               VALUES (?, ?, ?, ?, 0, 0, ?, 'calibration', 'pending')
               ON CONFLICT(hn_id) DO UPDATE SET eval_status = 'pending', evaluated_at = NULL`,
            )
            .bind(syntheticId, `[CAL-LIGHT] ${cal.label} (${cal.slot})`, cal.url, domain, Math.floor(Date.now() / 1000))
            .run();
        }
        await logEvent(db, {
          event_type: 'calibration',
          severity: 'info',
          message: `Light calibration queued: ${LIGHT_CALIBRATION_SET.length} URLs inserted as pending`,
          details: { mode: 'light', calibration_ids: LIGHT_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)) },
        });
        return new Response(JSON.stringify({
          mode: 'light',
          queued: LIGHT_CALIBRATION_SET.length,
          calibration_ids: LIGHT_CALIBRATION_SET.map((_, i) => -(2000 + i + 1)),
          note: 'Stories inserted as pending. Run: node scripts/evaluate-standalone.mjs --mode light',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Clean up stale calibration data before re-enqueue
      try {
        const calIds = CALIBRATION_SET.map((_, i) => -(1000 + i + 1));
        const placeholders = calIds.map(() => '?').join(',');
        await db.batch([
          db.prepare(`DELETE FROM eval_history WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM fair_witness WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM rater_evals WHERE hn_id IN (${placeholders})`).bind(...calIds),
          db.prepare(`DELETE FROM calibration_runs WHERE created_at < datetime('now', '-30 days')`),
        ]);
      } catch (err) {
        console.warn('[calibrate] Cleanup failed (non-fatal):', err);
      }

      let enqueued = 0;
      const enabledModels = getEnabledModels();

      for (let i = 0; i < CALIBRATION_SET.length; i++) {
        const cal = CALIBRATION_SET[i];
        const syntheticId = -(1000 + i + 1);
        const domain = extractDomain(cal.url);

        await db
          .prepare(
            `INSERT INTO stories (hn_id, title, url, domain, hn_score, hn_comments, hn_time, hn_type, eval_status)
             VALUES (?, ?, ?, ?, 0, 0, ?, 'calibration', 'pending')
             ON CONFLICT(hn_id) DO UPDATE SET eval_status = 'pending', evaluated_at = NULL`,
          )
          .bind(syntheticId, `[CAL] ${cal.label} (${cal.slot})`, cal.url, domain, Math.floor(Date.now() / 1000))
          .run();

        // Primary model (no eval_model field = default)
        await env.EVAL_QUEUE.send({
          hn_id: syntheticId,
          url: cal.url,
          title: `[CAL] ${cal.label} (${cal.slot})`,
          hn_text: null,
          domain,
        });
        enqueued++;

        // Non-primary enabled models — route to per-model queues
        for (const model of enabledModels) {
          if (model.id === 'claude-haiku-4-5-20251001') continue; // primary already sent
          const modelQueue = getModelQueue(model.id, env as unknown as Record<string, any>);
          await modelQueue.send({
            hn_id: syntheticId,
            url: cal.url,
            title: `[CAL] ${cal.label} (${cal.slot})`,
            hn_text: null,
            domain,
            eval_model: model.id,
            eval_provider: model.provider,
            prompt_mode: model.prompt_mode,
          });

          // UPSERT rater_evals as queued
          await db
            .prepare(
              `INSERT INTO rater_evals (hn_id, eval_model, eval_provider, eval_status)
               VALUES (?, ?, ?, 'queued')
               ON CONFLICT(hn_id, eval_model) DO UPDATE SET eval_status = 'queued'`
            )
            .bind(syntheticId, model.id, model.provider)
            .run();
          enqueued++;
        }
      }

      await logEvent(db, {
        event_type: 'calibration',
        severity: 'info',
        message: `Calibration run started: ${enqueued} URLs enqueued across ${enabledModels.length} models`,
        details: { enqueued, models: enabledModels.map(m => m.id) },
      });

      return new Response(JSON.stringify({ enqueued, models: enabledModels.map(m => m.id), calibration_ids: CALIBRATION_SET.map((_, i) => -(1000 + i + 1)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /calibrate/check — collect results and run drift check
    // Optional: ?model=deepseek-v3.2 to check a specific model's calibration from rater_evals
    // Optional: ?mode=light to check the light-1.2 calibration set (hn_ids -2001 to -2015)
    if (path === '/calibrate/check' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = env.DB;
      const modeParam = url.searchParams.get('mode');

      // Light mode: read from rater_evals (prompt_mode='light') for hn_ids -2001 to -2015
      if (modeParam === 'light') {
        const lightScores = new Map<string, number | null>();
        let lightPending = 0;

        for (let i = 0; i < LIGHT_CALIBRATION_SET.length; i++) {
          const cal = LIGHT_CALIBRATION_SET[i];
          const syntheticId = -(2000 + i + 1);
          const row = await db
            .prepare(
              `SELECT eval_status, hcb_weighted_mean FROM rater_evals
               WHERE hn_id = ? AND prompt_mode = 'light'
               ORDER BY evaluated_at DESC LIMIT 1`,
            )
            .bind(syntheticId)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            lightScores.set(cal.url, row.hcb_weighted_mean);
          } else {
            lightScores.set(cal.url, null);
            if (row && (row.eval_status === 'pending' || row.eval_status === 'queued')) lightPending++;
          }
        }

        const lightSummary = runCalibrationCheck(lightScores, LIGHT_CALIBRATION_SET, LIGHT_DRIFT_THRESHOLDS);

        await db
          .prepare(
            `INSERT INTO calibration_runs (model, methodology_hash, total_urls, passed, failed, skipped, status, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            'light-1.2',
            'light-1.2',
            LIGHT_CALIBRATION_SET.length,
            lightSummary.passed,
            lightSummary.failed,
            lightSummary.skipped,
            lightSummary.status,
            JSON.stringify({
              results: lightSummary.results,
              classOrderingOk: lightSummary.classOrderingOk,
              pairChecks: lightSummary.pairChecks,
              warned: lightSummary.warned,
            }),
          )
          .run();

        await logEvent(db, {
          event_type: 'calibration',
          severity: lightSummary.status === 'fail' ? 'error' : lightSummary.status === 'warn' ? 'warn' : 'info',
          message: `Light calibration check: ${lightSummary.status} (${lightSummary.passed} pass, ${lightSummary.failed} fail, ${lightSummary.skipped} skip)`,
          details: {
            mode: 'light',
            status: lightSummary.status,
            passed: lightSummary.passed,
            failed: lightSummary.failed,
            warned: lightSummary.warned,
            skipped: lightSummary.skipped,
            classOrderingOk: lightSummary.classOrderingOk,
            pending: lightPending,
          },
        });

        return new Response(JSON.stringify({ ...lightSummary, pending: lightPending, model: 'light-1.2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const modelParam = url.searchParams.get('model');

      const scores = new Map<string, number | null>();
      let pendingCount = 0;

      for (let i = 0; i < CALIBRATION_SET.length; i++) {
        const cal = CALIBRATION_SET[i];
        const syntheticId = -(1000 + i + 1);

        if (modelParam) {
          // Read from rater_evals for specific model
          const row = await db
            .prepare(`SELECT eval_status, hcb_weighted_mean FROM rater_evals WHERE hn_id = ? AND eval_model = ?`)
            .bind(syntheticId, modelParam)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            scores.set(cal.url, row.hcb_weighted_mean);
          } else {
            scores.set(cal.url, null);
            if (row && (row.eval_status === 'pending' || row.eval_status === 'queued')) pendingCount++;
          }
        } else {
          // Default: read from stories (primary model)
          const row = await db
            .prepare(`SELECT eval_status, hcb_weighted_mean FROM stories WHERE hn_id = ?`)
            .bind(syntheticId)
            .first<{ eval_status: string; hcb_weighted_mean: number | null }>();

          if (row && row.eval_status === 'done' && row.hcb_weighted_mean !== null) {
            scores.set(cal.url, row.hcb_weighted_mean);
          } else {
            scores.set(cal.url, null);
            if (row && row.eval_status === 'pending') pendingCount++;
          }
        }
      }

      const summary = runCalibrationCheck(scores);

      const model = modelParam || 'unknown';
      let methodologyHash = 'unknown';
      if (modelParam) {
        const hashRow = await db
          .prepare(`SELECT methodology_hash FROM rater_evals WHERE hn_id < -1000 AND hn_id >= -1015 AND eval_model = ? AND methodology_hash IS NOT NULL LIMIT 1`)
          .bind(modelParam)
          .first<{ methodology_hash: string }>();
        if (hashRow) methodologyHash = hashRow.methodology_hash;
      } else {
        const hashRow = await db
          .prepare(`SELECT methodology_hash FROM stories WHERE hn_id < -1000 AND hn_id >= -1015 AND methodology_hash IS NOT NULL LIMIT 1`)
          .first<{ methodology_hash: string }>();
        if (hashRow) methodologyHash = hashRow.methodology_hash;

        const modelRow = await db
          .prepare(`SELECT eval_model FROM eval_history WHERE hn_id < -1000 AND hn_id >= -1015 ORDER BY id DESC LIMIT 1`)
          .first<{ eval_model: string }>();
        if (modelRow && model === 'unknown') {
          // Use detected model
        }
      }

      await db
        .prepare(
          `INSERT INTO calibration_runs (model, methodology_hash, total_urls, passed, failed, skipped, status, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          model,
          methodologyHash,
          CALIBRATION_SET.length,
          summary.passed,
          summary.failed,
          summary.skipped,
          summary.status,
          JSON.stringify({
            results: summary.results,
            classOrderingOk: summary.classOrderingOk,
            pairChecks: summary.pairChecks,
            warned: summary.warned,
          }),
        )
        .run();

      await logEvent(db, {
        event_type: 'calibration',
        severity: summary.status === 'fail' ? 'error' : summary.status === 'warn' ? 'warn' : 'info',
        message: `Calibration check: ${summary.status} model=${model} (${summary.passed} pass, ${summary.failed} fail, ${summary.skipped} skip)`,
        details: {
          status: summary.status,
          model,
          passed: summary.passed,
          failed: summary.failed,
          warned: summary.warned,
          skipped: summary.skipped,
          classOrderingOk: summary.classOrderingOk,
          pending: pendingCount,
        },
      });

      return new Response(JSON.stringify({ ...summary, pending: pendingCount, model, methodologyHash }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /recalc — recompute aggregates for stories with eval_status='rescoring'
    if (path === '/recalc' && request.method === 'POST') {
      const authErr = checkAuth();
      if (authErr) return authErr;

      const db = env.DB;

      // Content type → channel weights lookup (from methodology section 2)
      const CHANNEL_WEIGHTS: Record<string, { editorial: number; structural: number }> = {
        ED: { editorial: 0.6, structural: 0.4 },
        PO: { editorial: 0.3, structural: 0.7 },
        LP: { editorial: 0.3, structural: 0.7 },
        PR: { editorial: 0.5, structural: 0.5 },
        AC: { editorial: 0.4, structural: 0.6 },
        MI: { editorial: 0.7, structural: 0.3 },
        AD: { editorial: 0.2, structural: 0.8 },
        HR: { editorial: 0.5, structural: 0.5 },
        CO: { editorial: 0.4, structural: 0.6 },
        ME: { editorial: 0.5, structural: 0.5 },
        MX: { editorial: 0.5, structural: 0.5 },
      };

      const { results: stories } = await db
        .prepare(
          `SELECT hn_id, domain, content_type FROM stories
           WHERE eval_status = 'rescoring'
           LIMIT 50`
        )
        .all<{ hn_id: number; domain: string | null; content_type: string | null }>();

      if (stories.length === 0) {
        return new Response(JSON.stringify({ rescored: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let rescored = 0;
      const errors: string[] = [];

      for (const story of stories) {
        try {
          const { results: scoreRows } = await db
            .prepare(
              `SELECT section, editorial, structural, evidence, directionality, note, editorial_note, structural_note
               FROM scores WHERE hn_id = ? ORDER BY sort_order`
            )
            .bind(story.hn_id)
            .all<{
              section: string;
              editorial: number | null;
              structural: number | null;
              evidence: string | null;
              directionality: string;
              note: string;
              editorial_note: string | null;
              structural_note: string | null;
            }>();

          if (scoreRows.length === 0) {
            errors.push(`hn_id=${story.hn_id}: no scores found`);
            await db.prepare(`UPDATE stories SET eval_status = 'failed', eval_error = 'no scores for rescoring' WHERE hn_id = ?`).bind(story.hn_id).run();
            continue;
          }

          const { results: fwRows } = await db
            .prepare(`SELECT section, fact_type, fact_text FROM fair_witness WHERE hn_id = ?`)
            .bind(story.hn_id)
            .all<{ section: string; fact_type: string; fact_text: string }>();

          const witnessBySection = new Map<string, { facts: string[]; inferences: string[] }>();
          for (const fw of fwRows) {
            let entry = witnessBySection.get(fw.section);
            if (!entry) { entry = { facts: [], inferences: [] }; witnessBySection.set(fw.section, entry); }
            if (fw.fact_type === 'observable') entry.facts.push(fw.fact_text);
            else entry.inferences.push(fw.fact_text);
          }

          const rawScores = scoreRows.map(r => {
            let dir: string[] = [];
            try { dir = JSON.parse(r.directionality || '[]'); } catch { /* ignore */ }
            const fw = witnessBySection.get(r.section);
            return {
              section: r.section,
              editorial: r.editorial,
              structural: r.structural,
              directionality: dir,
              evidence: r.evidence,
              editorial_note: r.editorial_note || '',
              structural_note: r.structural_note || '',
              note: r.note || r.editorial_note || r.structural_note || '',
              witness_facts: fw?.facts,
              witness_inferences: fw?.inferences,
            };
          });

          const contentType = story.content_type || 'MX';
          const channelWeights = CHANNEL_WEIGHTS[contentType] || CHANNEL_WEIGHTS['MX'];

          let dcpElements: Record<string, DcpElement> | null = null;
          if (story.domain) {
            try {
              const dcpRow = await db
                .prepare(`SELECT dcp_json FROM domain_dcp WHERE domain = ? LIMIT 1`)
                .bind(story.domain)
                .first<{ dcp_json: string }>();
              if (dcpRow?.dcp_json) {
                const parsed = JSON.parse(dcpRow.dcp_json);
                dcpElements = parsed.elements || parsed;
              }
            } catch { /* no DCP available */ }
          }

          const derivedScores = computeDerivedScoreFields(rawScores as EvalScore[], channelWeights, dcpElements);
          const aggregates = computeAggregates(derivedScores, channelWeights);
          const storyLevel = computeStoryLevelAggregates(derivedScores);
          const fwAgg = computeFairWitnessAggregates(derivedScores);

          const scoreStmts = derivedScores.map(s => {
            return db
              .prepare(
                `UPDATE scores SET final = ?, combined = ?, context_modifier = ?
                 WHERE hn_id = ? AND section = ?`
              )
              .bind(s.final, s.combined ?? null, s.context_modifier ?? null, story.hn_id, s.section);
          });
          for (let i = 0; i < scoreStmts.length; i += 100) {
            await db.batch(scoreStmts.slice(i, i + 100));
          }

          const hcbJson = JSON.stringify({
            schema_version: '3.7',
            evaluation: {
              content_type: { primary: contentType, secondary: [] },
              channel_weights: channelWeights,
            },
            scores: derivedScores,
            aggregates,
          });

          await db
            .prepare(
              `UPDATE stories SET
                hcb_weighted_mean = ?,
                hcb_classification = ?,
                hcb_signal_sections = ?,
                hcb_nd_count = ?,
                hcb_evidence_h = ?,
                hcb_evidence_m = ?,
                hcb_evidence_l = ?,
                hcb_json = ?,
                eval_model = 'claude-haiku-4-5-20251001',
                fw_ratio = ?,
                fw_observable_count = ?,
                fw_inference_count = ?,
                hcb_editorial_mean = ?,
                hcb_structural_mean = ?,
                hcb_setl = ?,
                hcb_confidence = ?,
                eval_status = 'done',
                eval_error = NULL
              WHERE hn_id = ?`
            )
            .bind(
              aggregates.weighted_mean,
              aggregates.classification,
              aggregates.signal_sections,
              aggregates.nd_count,
              aggregates.evidence_profile?.H ?? 0,
              aggregates.evidence_profile?.M ?? 0,
              aggregates.evidence_profile?.L ?? 0,
              hcbJson,
              fwAgg.fw_ratio,
              fwAgg.fw_observable_count,
              fwAgg.fw_inference_count,
              storyLevel.hcb_editorial_mean,
              storyLevel.hcb_structural_mean,
              storyLevel.hcb_setl,
              storyLevel.hcb_confidence,
              story.hn_id,
            )
            .run();

          rescored++;
        } catch (err) {
          errors.push(`hn_id=${story.hn_id}: ${err}`);
          await db.prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`).bind(String(err).slice(0, 500), story.hn_id).run();
        }
      }

      await logEvent(db, {
        event_type: 'trigger',
        severity: 'info',
        message: `Recalc: rescored ${rescored}/${stories.length} stories`,
        details: { rescored, total: stories.length, errors: errors.length > 0 ? errors : undefined },
      });

      return new Response(JSON.stringify({ rescored, total: stories.length, errors: errors.length > 0 ? errors : undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /health — pipeline health check (no auth required)
    if (path === '/health' && request.method === 'GET') {
      const health = await getPipelineHealth(env.DB);
      return new Response(JSON.stringify(health), {
        status: health.healthy ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('HN HRCB Cron Worker v6 (hn-bot + eval pipeline)', { status: 200 });
  },
};
