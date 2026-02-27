/**
 * Workers AI Consumer Worker: Processes evaluations from hrcb-eval-workers-ai queue.
 *
 * Uses Cloudflare AI binding (no API key needed, free tier).
 * Supports both light and full prompt modes.
 * No rate limiting — best-effort free tier.
 */

import {
  prepareContent,
  processLightResult,
  processFullResult,
  handleParseFailure,
  handleValidationFailure,
  handleMessageFailure,
  lookupCachedDcp,
  type Env,
  type QueueMessage,
  type PreparedContent,
} from './consumer-shared';

import {
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LIGHT,
  extractJsonFromResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
  buildLightUserMessage,
  type SlimEvalResponse,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';
import { callWorkersAi } from './providers';

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
        // AI binding check
        if (!env.AI) {
          console.warn(`[consumer-workers-ai] No AI binding, skipping hn_id=${story.hn_id}`);
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
          const lightUserMessage = buildLightUserMessage(prep.evalUrl, story.title, prep.content);

          const { text: rawText } = await callWorkersAi(env.AI, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);

          await processLightResult(env, msg, prep, rawText, 0, 0, evalStartMs);

        } else {
          // --- Full mode ---
          const cachedDcp = await lookupCachedDcp(env, prep.domain);
          const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);

          const { text: rawText } = await callWorkersAi(env.AI, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

          // Parse + validate
          let slim: SlimEvalResponse;
          try {
            const extracted = extractJsonFromResponse(rawText);
            slim = JSON.parse(extracted) as SlimEvalResponse;
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

          await processFullResult(env, msg, prep, slim, 0, 0, evalStartMs, cachedDcp);
        }

      } catch (err) {
        await handleMessageFailure(env, msg, prep, err, evalStartMs);
      }
    }
  },
};
