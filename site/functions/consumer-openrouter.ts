/**
 * OpenRouter Consumer Worker: Processes evaluations for 8 OpenRouter model queues.
 *
 * Supports both light and full prompt modes.
 * Error handling: 429 → retry with jitter, other errors → throw → DLQ.
 */

import {
  prepareContent,
  processLightResult,
  processFullResult,
  handleParseFailure,
  handleValidationFailure,
  handleApiFailure,
  handleMessageFailure,
  lookupCachedDcp,
  type Env,
  type QueueMessage,
  type PreparedContent,
} from './consumer-shared';

import {
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LIGHT,
  EVAL_MAX_TOKENS_LIGHT,
  parseOpenRouterResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
  buildLightUserMessage,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';
import { callOpenRouterApi } from './providers';
import { addJitter } from './rate-limit';

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
        if (!env.OPENROUTER_API_KEY) {
          console.warn(`[consumer-openrouter] No OPENROUTER_API_KEY, skipping hn_id=${story.hn_id}`);
          msg.ack();
          continue;
        }

        prep = await prepareContent(msg, env);
        if (!prep) continue;

        if (!prep.modelDef) {
          throw new Error(`Unknown model in registry: ${prep.msgModelId}`);
        }

        if (prep.isLightMode) {
          // --- Light mode ---
          const lightModelDef = { ...prep.modelDef, max_tokens: EVAL_MAX_TOKENS_LIGHT };
          const lightUserMessage = buildLightUserMessage(prep.evalUrl, story.title, prep.content);

          const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, lightModelDef, METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);

          if (!res.ok) {
            const body = await res.text();
            if (res.status === 429) {
              const delaySec = addJitter(60);
              await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${prep.msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: prep.msgModelId } });
              msg.retry({ delaySeconds: delaySec });
              continue;
            }
            await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
            throw new Error(`OpenRouter API error ${res.status}: ${body}`);
          }

          const rawData = await res.json() as any;
          const rawText = rawData.choices?.[0]?.message?.content || '';
          const inputTokens = rawData.usage?.prompt_tokens ?? 0;
          const outputTokens = rawData.usage?.completion_tokens ?? 0;

          await processLightResult(env, msg, prep, rawText, inputTokens, outputTokens, evalStartMs);

        } else {
          // --- Full mode ---
          const cachedDcp = await lookupCachedDcp(env, prep.domain);
          const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);

          const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

          if (!res.ok) {
            const body = await res.text();
            if (res.status === 429) {
              const delaySec = addJitter(60);
              await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${prep.msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: prep.msgModelId } });
              msg.retry({ delaySeconds: delaySec });
              continue;
            }
            await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
            throw new Error(`OpenRouter API error ${res.status}: ${body}`);
          }

          const rawData = await res.json() as any;
          const rawText = rawData.choices?.[0]?.message?.content || '';
          const inputTokens = rawData.usage?.prompt_tokens ?? 0;
          const outputTokens = rawData.usage?.completion_tokens ?? 0;

          // Detect output truncation
          const finishReason = rawData.choices?.[0]?.finish_reason;
          if (finishReason === 'length') {
            console.warn(`[consumer-openrouter] Output truncated for hn_id=${story.hn_id} model=${prep.msgModelId} at ${outputTokens} tokens`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'warn', message: `OpenRouter output truncated at ${outputTokens} tokens`, details: { model: prep.msgModelId, output_tokens: outputTokens, finish_reason: finishReason } });
          }

          // Parse + validate
          let slim;
          try {
            slim = parseOpenRouterResponse(rawData);
          } catch (parseErr) {
            await handleParseFailure(env, db, story, prep.msgModelId, prep.provider, rawText, parseErr, 'full');
            msg.ack();
            continue;
          }

          const validation = validateSlimEvalResponse(slim);
          if (!validation.valid) {
            await handleValidationFailure(env, db, story, prep.msgModelId, prep.provider, rawText, validation, 'full');
            msg.ack();
            continue;
          }

          if (validation.warnings.length > 0 || validation.repairs.length > 0) {
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Validation warnings for model ${prep.msgModelId}: ${validation.warnings.length}W ${validation.repairs.length}R`, details: { model: prep.msgModelId, warnings: validation.warnings, repairs: validation.repairs } });
          }

          await processFullResult(env, msg, prep, slim, inputTokens, outputTokens, evalStartMs, cachedDcp);
        }

      } catch (err) {
        await handleMessageFailure(env, msg, prep, err, evalStartMs);
      }
    }
  },
};
