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

  try {
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
        safeInputTokens, safeOutputTokens, 0,
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

      return new Response(JSON.stringify({
        ok: true, hn_id, model_id, prompt_mode: 'light',
        weighted_mean: agg.weighted_mean,
        classification: agg.classification,
        repairs: validation.repairs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Full mode
    const slim = result as SlimEvalResponse;

    // Normalize content_type: string "ED" → { primary: "ED", secondary: [] }
    if (slim.evaluation && typeof slim.evaluation.content_type === 'string') {
      (slim.evaluation as any).content_type = { primary: slim.evaluation.content_type, secondary: [] };
    }

    // Hoist supplementary_signals to top level if nested (standalone evaluator raw output)
    const sup = (result as any).supplementary_signals;
    if (sup && typeof sup === 'object') {
      for (const key of ['epistemic_quality', 'propaganda_flags', 'solution_orientation',
        'emotional_tone', 'stakeholder_representation', 'temporal_framing',
        'geographic_scope', 'complexity_level', 'transparency_disclosure']) {
        if (sup[key] !== undefined && (slim as any)[key] === undefined) {
          (slim as any)[key] = sup[key];
        }
      }
    }

    const validation = validateSlimEvalResponse(slim);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: validation.errors }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const channelWeights = slim.evaluation.channel_weights ?? { editorial: 0.5, structural: 0.5 };

    // Compute final/combined/context_modifier if missing (standalone evaluator omits these)
    for (const score of slim.scores) {
      if (score.final === undefined || score.final === null) {
        const e = score.editorial;
        const s = score.structural;
        if (e !== null && e !== undefined && s !== null && s !== undefined) {
          score.final = e * channelWeights.editorial + s * channelWeights.structural;
        } else {
          score.final = e ?? s ?? null;
        }
      }
      if (score.combined === undefined) score.combined = null;
      if (score.context_modifier === undefined) score.context_modifier = null;
    }

    const aggregates = computeAggregates(slim.scores, channelWeights);
    const dcp = typeof slim.domain_context_profile === 'string'
      ? { domain: slim.evaluation.domain, eval_date: slim.evaluation.date, elements: {} }
      : slim.domain_context_profile;
    const fullResult: EvalResult = { ...slim, domain_context_profile: dcp, aggregates };

    await writeRaterEvalResult(
      env.DB, hn_id, fullResult, model_id, provider,
      prompt_hash ?? null, methodology_hash ?? null,
      safeInputTokens, safeOutputTokens, 0,
    );

    return new Response(JSON.stringify({
      ok: true, hn_id, model_id, prompt_mode: 'full',
      weighted_mean: aggregates.weighted_mean,
      classification: aggregates.classification,
      repairs: validation.repairs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'Internal error', detail: message, hn_id, model_id }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
