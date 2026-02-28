/**
 * OpenRouter Consumer Worker: Processes evaluations for 8 OpenRouter model queues.
 *
 * Pull model (eval_queue): wake-up signals ({ trigger: 'new_work' }) cause the consumer
 * to claim rows from eval_queue and process them. Legacy push messages (with hn_id) are
 * still processed for backward compatibility.
 *
 * Supports both lite and full prompt modes.
 * Error handling: 429 → retry with jitter, other errors → throw → DLQ.
 */

import {
  prepareContent,
  processLiteResult,
  processFullResult,
  handleParseFailure,
  handleValidationFailure,
  handleApiFailure,
  handleMessageFailure,
  lookupCachedDcp,
  claimFromEvalQueue,
  getStoryForClaim,
  makeEvalQueueMsg,
  type Env,
  type QueueMessage,
  type PreparedContent,
} from './consumer-shared';

import {
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LITE,
  EVAL_MAX_TOKENS_LITE,
  parseOpenRouterResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
  buildLiteUserMessage,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';
import { callOpenRouterApi } from './providers';
import { addJitter } from './rate-limit';

async function processOpenRouterClaim(env: Env, msg: Message<QueueMessage>, db: D1Database): Promise<void> {
  const story = msg.body;
  const evalStartMs = Date.now();
  let prep: PreparedContent | null = null;

  try {
    prep = await prepareContent(msg, env);
    if (!prep) return;

    if (!prep.modelDef) {
      throw new Error(`Unknown model in registry: ${prep.msgModelId}`);
    }

    if (prep.modelDef.provider !== 'openrouter') {
      console.warn(`[consumer-openrouter] Wrong provider ${prep.modelDef.provider} for model ${prep.msgModelId}, acking`);
      msg.ack();
      return;
    }

    if (prep.isLiteMode) {
      const liteModelDef = { ...prep.modelDef, max_tokens: EVAL_MAX_TOKENS_LITE };
      const liteUserMessage = buildLiteUserMessage(prep.evalUrl, story.title, prep.content);

      const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, liteModelDef, METHODOLOGY_SYSTEM_PROMPT_LITE, liteUserMessage);

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) {
          const delaySec = addJitter(60);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${prep.msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: prep.msgModelId } });
          msg.retry({ delaySeconds: delaySec });
          return;
        }
        await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
        throw new Error(`OpenRouter API error ${res.status}: ${body}`);
      }

      const rawData = await res.json() as any;
      const rawText = rawData.choices?.[0]?.message?.content || '';
      const inputTokens = rawData.usage?.prompt_tokens ?? 0;
      const outputTokens = rawData.usage?.completion_tokens ?? 0;

      await processLiteResult(env, msg, prep, rawText, inputTokens, outputTokens, evalStartMs);

    } else {
      const cachedDcp = await lookupCachedDcp(env, prep.domain);
      const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);

      const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) {
          const delaySec = addJitter(60);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${prep.msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: prep.msgModelId } });
          msg.retry({ delaySeconds: delaySec });
          return;
        }
        await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
        throw new Error(`OpenRouter API error ${res.status}: ${body}`);
      }

      const rawData = await res.json() as any;
      const rawText = rawData.choices?.[0]?.message?.content || '';
      const inputTokens = rawData.usage?.prompt_tokens ?? 0;
      const outputTokens = rawData.usage?.completion_tokens ?? 0;

      const finishReason = rawData.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        console.warn(`[consumer-openrouter] Output truncated hn_id=${story.hn_id} model=${prep.msgModelId} at ${outputTokens} tokens`);
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'warn', message: `OpenRouter output truncated at ${outputTokens} tokens`, details: { model: prep.msgModelId, output_tokens: outputTokens, finish_reason: finishReason } });
      }

      let slim;
      try {
        slim = parseOpenRouterResponse(rawData);
      } catch (parseErr) {
        await handleParseFailure(env, db, story, prep.msgModelId, prep.provider, rawText, parseErr, 'full');
        msg.ack();
        return;
      }

      const validation = validateSlimEvalResponse(slim);
      if (!validation.valid) {
        await handleValidationFailure(env, db, story, prep.msgModelId, prep.provider, rawText, validation, 'full');
        msg.ack();
        return;
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

/**
 * Pull path: claim rows from eval_queue and process them.
 */
async function processOpenRouterPullBatch(env: Env): Promise<void> {
  const db = env.DB;
  if (!env.OPENROUTER_API_KEY) {
    console.warn('[consumer-openrouter] Pull: no OPENROUTER_API_KEY, skipping');
    return;
  }

  const workerId = crypto.randomUUID();
  const claims = await claimFromEvalQueue(db, 'openrouter', workerId, 5);
  if (claims.length === 0) return;

  console.log(`[consumer-openrouter] Pull: claimed ${claims.length} rows from eval_queue`);

  for (const claim of claims) {
    const storyData = await getStoryForClaim(db, claim.hn_id);
    if (!storyData) {
      db.prepare(`UPDATE eval_queue SET status='done', claimed_by=NULL WHERE id=?`).bind(claim.id).run().catch(() => {});
      continue;
    }
    const msg = makeEvalQueueMsg(claim, storyData, db);
    await processOpenRouterClaim(env, msg, db);
  }
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;

    // Batch-level API key check — retry all messages if key is missing
    if (!env.OPENROUTER_API_KEY) {
      console.error('[consumer-openrouter] No OPENROUTER_API_KEY — retrying all messages');
      for (const msg of batch.messages) msg.retry();
      return;
    }

    for (const msg of batch.messages) {
      const body = msg.body as any;

      // Wake-up signal → pull from eval_queue (pull model)
      if (!body.hn_id) {
        msg.ack();
        await processOpenRouterPullBatch(env);
        continue;
      }

      // Legacy push message — reuse same logic as pull path
      await processOpenRouterClaim(env, msg, db);
    }
  },
};
