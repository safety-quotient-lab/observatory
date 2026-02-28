import type { APIRoute } from 'astro';
import { writeRaterEvalResult, writeLightRaterEvalResult, writeCalibrationEval } from '../../lib/eval-write';
import { validateSlimEvalResponse, validateLightEvalResponse, computeLightAggregates } from '../../lib/eval-parse';
import { computeAggregates } from '../../lib/compute-aggregates';
import type { EvalResult, SlimEvalResponse, LightEvalResponse } from '../../lib/eval-types';

/**
 * POST /api/ingest — accepts a pre-computed evaluation result from the standalone evaluator.
 * Auth: Authorization: Bearer <TRIGGER_SECRET>
 *
 * Body: {
 *   hn_id: number,
 *   model_id: string,
 *   provider: string,
 *   prompt_mode: 'full' | 'light',   // default: 'full'
 *   input_tokens: number,
 *   output_tokens: number,
 *   prompt_hash: string | null,
 *   methodology_hash: string | null,
 *   result: SlimEvalResponse | LightEvalResponse
 * }
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env as { DB: D1Database; TRIGGER_SECRET?: string; CONTENT_CACHE?: KVNamespace };

  const auth = request.headers.get('Authorization') ?? '';
  if (!env.TRIGGER_SECRET || auth !== `Bearer ${env.TRIGGER_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    hn_id: number;
    model_id: string;
    provider: string;
    prompt_mode?: 'full' | 'light';
    input_tokens: number;
    output_tokens: number;
    prompt_hash: string | null;
    methodology_hash: string | null;
    result: SlimEvalResponse | LightEvalResponse;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    hn_id, model_id, provider,
    prompt_mode = 'full',
    input_tokens, output_tokens,
    prompt_hash, methodology_hash,
    result,
  } = body;

  if (!hn_id || typeof hn_id !== 'number' || !Number.isInteger(hn_id)) {
    return new Response(JSON.stringify({ error: 'hn_id must be an integer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!model_id || !provider || !result) {
    return new Response(JSON.stringify({ error: 'Missing required fields: model_id, provider, result' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const safeInputTokens = Number.isInteger(input_tokens) && input_tokens >= 0 ? input_tokens : 0;
  const safeOutputTokens = Number.isInteger(output_tokens) && output_tokens >= 0 ? output_tokens : 0;

  if (prompt_mode === 'light') {
    const light = result as LightEvalResponse;
    const validation = validateLightEvalResponse(light);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: validation.errors }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await writeLightRaterEvalResult(
      env.DB, hn_id, light, model_id, provider,
      prompt_hash ?? null, methodology_hash ?? null,
      safeInputTokens, safeOutputTokens,
    );

    // Longitudinal calibration snapshot: if this is a calibration ID and a run is active, persist to calibration_evals
    const isCalId = hn_id >= -2015 && hn_id <= -2001;
    if (isCalId && env.CONTENT_CACHE) {
      const runStr = await env.CONTENT_CACHE.get('calibration:light:current_run').catch(() => null);
      const calibrationRun = runStr ? parseInt(runStr) : NaN;
      if (!isNaN(calibrationRun)) {
        await writeCalibrationEval(env.DB, calibrationRun, hn_id, light, model_id, provider);
      }
    }

    const agg = computeLightAggregates(light);

    // writeLightRaterEvalResult above handles promotion (pending→done),
    // hcb_editorial_mean, eval_model, theme_tag, etc. via COALESCE fill-in.
    // No redundant UPDATE needed here.
    return new Response(JSON.stringify({
      ok: true, hn_id, model_id, prompt_mode: 'light',
      weighted_mean: agg.weighted_mean,
      classification: agg.classification,
      repairs: validation.repairs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Full mode
  const slim = result as SlimEvalResponse;
  const validation = validateSlimEvalResponse(slim);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: validation.errors }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const channelWeights = slim.evaluation.channel_weights ?? { editorial: 0.5, structural: 0.5 };
  const aggregates = computeAggregates(slim.scores, channelWeights);
  const fullResult: EvalResult = { ...(slim as any), aggregates };

  await writeRaterEvalResult(
    env.DB, hn_id, fullResult, model_id, provider,
    prompt_hash ?? null, methodology_hash ?? null,
    safeInputTokens, safeOutputTokens,
  );

  // Mark story as done so it doesn't get re-queued
  await env.DB
    .prepare(`UPDATE stories SET eval_status = 'done', evaluated_at = datetime('now') WHERE hn_id = ? AND eval_status IN ('pending', 'queued')`)
    .bind(hn_id)
    .run();

  return new Response(JSON.stringify({
    ok: true, hn_id, model_id, prompt_mode: 'full',
    weighted_mean: aggregates.weighted_mean,
    classification: aggregates.classification,
    repairs: validation.repairs,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
