// SPDX-License-Identifier: Apache-2.0
/**
 * OpenRouter Consumer Worker: Processes evaluations for 8 OpenRouter model queues.
 *
 * Pull model (eval_queue): wake-up signals ({ trigger: 'new_work' }) cause the consumer
 * to claim rows from eval_queue and process them. Legacy push messages (with hn_id) are
 * still processed for backward compatibility.
 *
 * Supports both lite and full prompt modes.
 * Proactive rate limiting: pre-check KV capacity before API call, track headers on every response.
 * Error handling: 429 → update KV state + retry with backoff, other errors → throw → DLQ.
 */

import {
  prepareContent,
  processLiteResult,
  processLiteV2Result,
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
  METHODOLOGY_SYSTEM_PROMPT_LITE_V2,
  EVAL_MAX_TOKENS_LITE,
  parseOpenRouterResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
  buildLiteUserMessage,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';
import { writeDb } from '../src/lib/db-utils';
import { callOpenRouterApi } from './providers';
import {
  addJitter,
  readOpenRouterRateLimitHeaders,
  updateRateLimitState,
  writeRateLimitSnapshot,
  checkRateLimitCapacity,
} from './rate-limit';

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

    // Pre-call: check rate limit capacity
    const maxBackoffSec = parseInt(env.RATE_LIMIT_MAX_BACKOFF_SECONDS ?? '120', 10);
    const capacity = await checkRateLimitCapacity(env.CONTENT_CACHE, prep.msgModelId, maxBackoffSec);
    if (!capacity.ok) {
      const delay = addJitter(capacity.delaySeconds!);
      console.warn(`[consumer-openrouter] Self-throttle hn_id=${story.hn_id} model=${prep.msgModelId}: ${capacity.reason}, delaying ${delay}s`);
      await logEvent(db, { hn_id: story.hn_id, event_type: 'self_throttle', severity: 'info', message: `Self-throttle: ${capacity.reason}`, details: { reason: capacity.reason, delay_seconds: delay, model: prep.msgModelId } });
      msg.retry({ delaySeconds: delay });
      return;
    }

    if (prep.evalMode === 'lite-v2' || prep.evalMode === 'lite') {
      const isV2 = prep.evalMode === 'lite-v2';
      const systemPrompt = isV2 ? METHODOLOGY_SYSTEM_PROMPT_LITE_V2 : METHODOLOGY_SYSTEM_PROMPT_LITE;
      const liteModelDef = { ...prep.modelDef, max_tokens: EVAL_MAX_TOKENS_LITE };
      const liteUserMessage = buildLiteUserMessage(prep.evalUrl, story.title, prep.content);

      const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, liteModelDef, systemPrompt, liteUserMessage);

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) {
          const rlHeaders = readOpenRouterRateLimitHeaders(res);
          const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, true);
          await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

          const retryAfter = res.headers.get('retry-after');
          const baseSec = retryAfter ? parseInt(retryAfter, 10) : 60;
          const delaySec = addJitter(Math.min(Math.max(baseSec, 30), 300));
          console.warn(`[consumer-openrouter] Rate limited (429) hn_id=${story.hn_id} model=${prep.msgModelId}, delaying ${delaySec}s, consecutive=${rlState.consecutive_429s}`);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `Rate limited (429), retrying in ${delaySec}s`, details: { status: 429, retry_after: retryAfter, delay_seconds: delaySec, consecutive_429s: rlState.consecutive_429s, requests_remaining: rlState.requests_remaining, model: prep.msgModelId } });
          msg.retry({ delaySeconds: delaySec });
          return;
        }
        await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
        throw new Error(`OpenRouter API error ${res.status}: ${body}`);
      }

      // Track rate limit headers on success
      const rlHeaders = readOpenRouterRateLimitHeaders(res);
      const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, false);
      await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

      const rawData = await res.json() as any;
      const rawText = rawData.choices?.[0]?.message?.content || '';
      const inputTokens = rawData.usage?.prompt_tokens ?? 0;
      const outputTokens = rawData.usage?.completion_tokens ?? 0;

      if (isV2) {
        await processLiteV2Result(env, msg, prep, rawText, inputTokens, outputTokens, evalStartMs);
      } else {
        await processLiteResult(env, msg, prep, rawText, inputTokens, outputTokens, evalStartMs);
      }

    } else {
      const cachedDcp = await lookupCachedDcp(env, prep.domain);
      const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);

      const { response: res } = await callOpenRouterApi(env.OPENROUTER_API_KEY, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) {
          const rlHeaders = readOpenRouterRateLimitHeaders(res);
          const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, true);
          await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

          const retryAfter = res.headers.get('retry-after');
          const baseSec = retryAfter ? parseInt(retryAfter, 10) : 60;
          const delaySec = addJitter(Math.min(Math.max(baseSec, 30), 300));
          console.warn(`[consumer-openrouter] Rate limited (429) hn_id=${story.hn_id} model=${prep.msgModelId}, delaying ${delaySec}s, consecutive=${rlState.consecutive_429s}`);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `Rate limited (429), retrying in ${delaySec}s`, details: { status: 429, retry_after: retryAfter, delay_seconds: delaySec, consecutive_429s: rlState.consecutive_429s, requests_remaining: rlState.requests_remaining, model: prep.msgModelId } });
          msg.retry({ delaySeconds: delaySec });
          return;
        }
        await handleApiFailure(env, db, story, prep.msgModelId, prep.provider, res.status, body);
        throw new Error(`OpenRouter API error ${res.status}: ${body}`);
      }

      // Track rate limit headers on success
      const rlHeaders = readOpenRouterRateLimitHeaders(res);
      const rlState = await updateRateLimitState(env.CONTENT_CACHE, prep.msgModelId, rlHeaders, false);
      await writeRateLimitSnapshot(db, prep.msgModelId, rlState);

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
  const db = writeDb(env.DB);
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
    const db = writeDb(env.DB);

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
