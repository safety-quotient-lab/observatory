/**
 * Workers AI Consumer Worker: Processes evaluations from hrcb-eval-workers-ai queue.
 *
 * Uses Cloudflare AI binding (no API key needed, free tier).
 * Supports both lite and full prompt modes.
 * No rate limiting — best-effort free tier.
 */

import {
  prepareContent,
  processLiteResult,
  processFullResult,
  handleParseFailure,
  handleValidationFailure,
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
  extractJsonFromResponse,
  validateSlimEvalResponse,
  buildUserMessageWithDcp,
  buildLiteUserMessage,
  type SlimEvalResponse,
} from '../src/lib/shared-eval';

import { logEvent } from '../src/lib/events';
import { writeDb } from '../src/lib/db-utils';
import { callWorkersAi } from './providers';

async function processWaiClaim(env: Env, msg: Message<QueueMessage>, db: D1Database): Promise<void> {
  const story = msg.body;
  const evalStartMs = Date.now();
  let prep: PreparedContent | null = null;

  try {
    prep = await prepareContent(msg, env);
    if (!prep) return;

    if (!prep.modelDef) {
      throw new Error(`Unknown model in registry: ${prep.msgModelId}`);
    }

    if (prep.modelDef.provider !== 'workers-ai') {
      console.warn(`[consumer-workers-ai] Wrong provider ${prep.modelDef.provider} for model ${prep.msgModelId}, acking`);
      msg.ack();
      return;
    }

    if (prep.isLiteMode) {
      const liteUserMessage = buildLiteUserMessage(prep.evalUrl, story.title, prep.content);
      const { text: rawText } = await callWorkersAi(env.AI, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_LITE, liteUserMessage);
      await processLiteResult(env, msg, prep, rawText, 0, 0, evalStartMs);
    } else {
      const cachedDcp = await lookupCachedDcp(env, prep.domain);
      const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);
      const { text: rawText } = await callWorkersAi(env.AI, prep.modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

      let slim: SlimEvalResponse;
      try {
        const extracted = extractJsonFromResponse(rawText);
        slim = JSON.parse(extracted) as SlimEvalResponse;
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

      await processFullResult(env, msg, prep, slim, 0, 0, evalStartMs, cachedDcp);
    }
  } catch (err) {
    await handleMessageFailure(env, msg, prep, err, evalStartMs);
  }
}

/**
 * Pull path: claim rows from eval_queue and process them.
 */
async function processWaiPullBatch(env: Env): Promise<void> {
  const db = writeDb(env.DB);
  if (!env.AI) {
    console.warn('[consumer-workers-ai] Pull: no AI binding, skipping');
    return;
  }

  const workerId = crypto.randomUUID();
  const claims = await claimFromEvalQueue(db, 'workers-ai', workerId, 5);
  if (claims.length === 0) return;

  console.log(`[consumer-workers-ai] Pull: claimed ${claims.length} rows from eval_queue`);

  for (const claim of claims) {
    const storyData = await getStoryForClaim(db, claim.hn_id);
    if (!storyData) {
      db.prepare(`UPDATE eval_queue SET status='done', claimed_by=NULL WHERE id=?`).bind(claim.id).run().catch(() => {});
      continue;
    }
    const msg = makeEvalQueueMsg(claim, storyData, db);
    await processWaiClaim(env, msg, db);
  }
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = writeDb(env.DB);

    for (const msg of batch.messages) {
      const body = msg.body as any;

      // Wake-up signal → pull from eval_queue (pull model)
      if (!body.hn_id) {
        msg.ack();
        await processWaiPullBatch(env);
        continue;
      }

      // Legacy push message
      if (!env.AI) {
        console.warn(`[consumer-workers-ai] No AI binding, skipping hn_id=${body.hn_id}`);
        msg.ack();
        continue;
      }

      // Legacy push message — reuse same logic as pull path
      await processWaiClaim(env, msg, db);
    }
  },
};
