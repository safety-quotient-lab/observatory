/**
 * Anthropic Consumer Worker: Processes primary model evaluations from hrcb-eval-queue.
 *
 * Inline fetch to api.anthropic.com with:
 * - Prompt caching (cache_control: ephemeral)
 * - Proactive rate limit tracking via response headers
 * - Self-throttle before 429s via KV state
 * - 429/529 retry with backoff
 * - Credit balance detection → 30-min pause
 * - Output truncation retry with extended token limit
 */

import {
  prepareContent,
  processFullResult,
  handleApiFailure,
  handleValidationFailure,
  handleMessageFailure,
  lookupCachedDcp,
  hashString,
  type Env,
  type QueueMessage,
  type PreparedContent,
} from './consumer-shared';

import {
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  EVAL_MAX_TOKENS,
  EVAL_MAX_TOKENS_EXTENDED,
  parseSlimEvalResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';

import {
  readRateLimitHeaders,
  updateRateLimitState,
  writeRateLimitSnapshot,
  checkRateLimitCapacity,
  setCreditPause,
  addJitter,
} from './rate-limit';

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;

    for (const msg of batch.messages) {
      const story = msg.body;
      const evalStartMs = Date.now();
      let prep: PreparedContent | null = null;

      try {
        // API key check
        if (!env.ANTHROPIC_API_KEY) {
          console.warn(`[consumer-anthropic] No ANTHROPIC_API_KEY, skipping hn_id=${story.hn_id}`);
          msg.ack();
          continue;
        }

        prep = await prepareContent(msg, env);
        if (!prep) continue;

        // Light mode not supported for Anthropic
        if (prep.isLightMode) {
          throw new Error(`Light mode not supported for provider=anthropic`);
        }

        // Look up cached DCP
        const cachedDcp = await lookupCachedDcp(env, prep.domain);

        // Build user message
        const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);

        // Pre-call: check rate limit capacity
        const capacity = await checkRateLimitCapacity(env.CONTENT_CACHE, prep.msgModelId);
        if (!capacity.ok) {
          const delay = addJitter(capacity.delaySeconds!);
          console.warn(`[consumer-anthropic] Self-throttle for hn_id=${story.hn_id} model=${prep.msgModelId}: ${capacity.reason}, delaying ${delay}s`);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'self_throttle', severity: 'info', message: `Self-throttle: ${capacity.reason}`, details: { reason: capacity.reason, delay_seconds: delay, model: prep.msgModelId } });
          msg.retry({ delaySeconds: delay });
          continue;
        }

        // --- Call Anthropic API ---
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: prep.modelToUse,
            max_tokens: prep.modelDef?.max_tokens || EVAL_MAX_TOKENS,
            system: [
              {
                type: 'text',
                text: METHODOLOGY_SYSTEM_PROMPT_SLIM,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [{ role: 'user', content: userMessage }],
          }),
        });

        if (!res.ok) {
          const body = await res.text();

          if (res.status === 429) {
            const rlHeaders = readRateLimitHeaders(res);
            const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, true);
            await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

            const retryAfter = res.headers.get('retry-after');
            const baseSec = retryAfter ? parseInt(retryAfter, 10) : 60;
            const delaySec = addJitter(Math.min(Math.max(baseSec, 30), 300));
            console.warn(`[consumer-anthropic] Rate limited (429) for hn_id=${story.hn_id}. retry-after=${retryAfter ?? 'none'}, delaying ${delaySec}s, consecutive=${rlState.consecutive_429s}`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `Rate limited (429), retrying in ${delaySec}s`, details: { status: 429, retry_after: retryAfter, delay_seconds: delaySec, consecutive_429s: rlState.consecutive_429s, requests_remaining: rlState.requests_remaining, model: prep.msgModelId } });
            msg.retry({ delaySeconds: delaySec });
            continue;
          }

          if (res.status === 529) {
            const rlHeaders = readRateLimitHeaders(res);
            const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, false);
            await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

            const delaySec = addJitter(120);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `API overloaded (529), retrying in ${delaySec}s`, details: { status: 529, delay_seconds: delaySec, model: prep.msgModelId } });
            msg.retry({ delaySeconds: delaySec });
            continue;
          }

          if (res.status === 400 && body.includes('credit balance')) {
            await setCreditPause(env.CONTENT_CACHE, 'anthropic');
            await logEvent(db, { hn_id: story.hn_id, event_type: 'credit_exhausted', severity: 'error', message: `Credit balance too low, pausing provider for 30 min`, details: { status: 400, model: prep.msgModelId } });
            if (prep.isPrimary) {
              await db.prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status IN ('queued', 'evaluating')`).bind(story.hn_id).run().catch(() => {});
            }
            msg.ack();
            continue;
          }

          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'error', message: `Anthropic API error ${res.status}`, details: { status: res.status, body_preview: body.slice(0, 500), model: prep.msgModelId } });
          throw new Error(`Anthropic API error ${res.status}: ${body}`);
        }

        // --- Parse successful response ---
        let data = (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          stop_reason?: string;
          usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
        };

        const usage = data.usage;
        let inputTokens = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
        let outputTokens = usage?.output_tokens ?? 0;

        // Rate limit header tracking
        const rlHeaders = readRateLimitHeaders(res);
        const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
        const totalInput = inputTokens;
        const cacheHitRate = totalInput > 0 ? cacheReadTokens / totalInput : null;
        const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, false, cacheHitRate);
        await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

        console.log(`[consumer-anthropic] Rate limit headers for hn_id=${story.hn_id}: req=${rlHeaders.requests_remaining}/${rlHeaders.requests_limit} input=${rlHeaders.input_tokens_remaining}/${rlHeaders.input_tokens_limit} output=${rlHeaders.output_tokens_remaining}/${rlHeaders.output_tokens_limit}`);

        // Detect output truncation and retry with extended limit
        if (data.stop_reason === 'max_tokens') {
          console.warn(`[consumer-anthropic] Output truncated for hn_id=${story.hn_id} at ${data.usage?.output_tokens} tokens, retrying with extended limit`);
          await logEvent(db, {
            hn_id: story.hn_id,
            event_type: 'eval_retry',
            severity: 'warn',
            message: `Output truncated at ${data.usage?.output_tokens} tokens, retrying with ${EVAL_MAX_TOKENS_EXTENDED}`,
            details: { output_tokens: data.usage?.output_tokens, max_tokens: EVAL_MAX_TOKENS, model: prep.msgModelId },
          });

          const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: prep.modelToUse,
              max_tokens: EVAL_MAX_TOKENS_EXTENDED,
              system: [
                {
                  type: 'text',
                  text: METHODOLOGY_SYSTEM_PROMPT_SLIM,
                  cache_control: { type: 'ephemeral' },
                },
              ],
              messages: [{ role: 'user', content: userMessage }],
            }),
          });

          if (!retryRes.ok) {
            const retryBody = await retryRes.text();
            throw new Error(`Anthropic API error ${retryRes.status} on truncation retry: ${retryBody}`);
          }

          const retryData = (await retryRes.json()) as typeof data;

          const retryRlHeaders = readRateLimitHeaders(retryRes);
          const retryCacheReadTokens = retryData.usage?.cache_read_input_tokens ?? 0;
          const retryTotalInput = (retryData.usage?.input_tokens ?? 0) + (retryData.usage?.cache_creation_input_tokens ?? 0) + retryCacheReadTokens;
          const retryCacheHitRate = retryTotalInput > 0 ? retryCacheReadTokens / retryTotalInput : null;
          const retryRlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, retryRlHeaders, false, retryCacheHitRate);
          await writeRateLimitSnapshot(db, prep.msgModelId, retryRlState);

          if (retryData.stop_reason === 'max_tokens') {
            throw new Error(`Output still truncated at ${EVAL_MAX_TOKENS_EXTENDED} tokens for hn_id=${story.hn_id}`);
          }

          data = retryData;
          inputTokens = (retryData.usage?.input_tokens ?? 0) + (retryData.usage?.cache_creation_input_tokens ?? 0) + (retryData.usage?.cache_read_input_tokens ?? 0);
          outputTokens = retryData.usage?.output_tokens ?? 0;
        }

        // Parse slim eval response
        const slim = parseSlimEvalResponse(data);

        // Validate
        const validation = validateSlimEvalResponse(slim);
        if (!validation.valid) {
          const rawText = data.content?.find(c => c.type === 'text')?.text || '';
          await handleValidationFailure(env, db, story, prep.msgModelId, prep.provider, rawText, validation, 'full');
          msg.ack();
          continue;
        }

        if (validation.warnings.length > 0 || validation.repairs.length > 0) {
          await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Validation warnings for model ${prep.msgModelId}: ${validation.warnings.length}W ${validation.repairs.length}R`, details: { model: prep.msgModelId, warnings: validation.warnings, repairs: validation.repairs } });
        }

        // Process full result (DCP, aggregates, write to D1/R2)
        await processFullResult(env, msg, prep, slim, inputTokens, outputTokens, evalStartMs, cachedDcp);

      } catch (err) {
        await handleMessageFailure(env, msg, prep, err, evalStartMs);
      }
    }
  },
};
