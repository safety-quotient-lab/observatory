// SPDX-License-Identifier: Apache-2.0
/**
 * Shared types, utilities, and content preparation for provider-specific consumers.
 *
 * All provider-agnostic logic lives here. The 3 consumer workers import from this module.
 */

import {
  PRIMARY_MODEL_ID,
  CONTENT_MAX_CHARS,
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LITE,
  extractDomain,
  buildUserMessageWithDcp,
  buildLiteUserMessage,
  extractJsonFromResponse,
  validateLiteEvalResponse,
  computeLiteAggregates,
  writeLiteRaterEvalResult,
  fetchUrlContent,
  requestArchive,
  writeRaterEvalResult,
  markFailed,
  markSkipped,
  markRaterFailed,
  getCachedDcp,
  cacheDcp,
  getModelDef,
  raterHealthKvKey,
  emptyRaterHealth,
  shouldSkipModel,
  updateRaterHealthOnSuccess,
  updateRaterHealthOnParseFailure,
  updateRaterHealthOnApiFailure,
  type EvalResult,
  type ModelDefinition,
  type RaterHealthState,
  type SlimEvalResponse,
  type LiteEvalResponse,
} from '../src/lib/shared-eval';

import { computeAggregates, computeWitnessRatio, computeDerivedScoreFields, type DcpElement } from '../src/lib/compute-aggregates';
import { cleanHtml, hasReadableText } from '../src/lib/html-clean';
import { classifyContent } from '../src/lib/content-gate';
import { computeContentHash } from '../src/lib/content-drift';
import { logEvent } from '../src/lib/events';
import { writeDb } from '../src/lib/db-utils';
import { checkCreditPause } from './rate-limit';

// --- Shared types ---

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI?: any;
  CONTENT_CACHE: KVNamespace;
  CONTENT_SNAPSHOTS: R2Bucket;
  EVAL_MODEL_OVERRIDE?: string;
  RATE_LIMIT_MAX_BACKOFF_SECONDS?: string;
}

export interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
  eval_model?: string;
  eval_provider?: string;
  prompt_mode?: 'full' | 'lite';
  batch_id?: string | null;
}

/** Wake-up signal sent to CF Queues instead of full story payloads (pull model). */
export interface WakeUpMessage {
  trigger: 'new_work';
  provider: string;
}

/** A claimed row from eval_queue. */
export interface EvalQueueClaim {
  id: number;
  hn_id: number;
  target_provider: string;
  target_model: string;
  prompt_mode: 'full' | 'lite';
  batch_id: string | null;
}

// --- eval_queue pull model helpers ---

/**
 * Atomically claim up to batchSize rows from eval_queue for this provider.
 * Also recovers stale claims (>5 min) before claiming new ones.
 * Returns claimed rows, or [] if nothing is available.
 */
export async function claimFromEvalQueue(
  db: D1Database,
  provider: string,
  workerId: string,
  batchSize = 5,
): Promise<EvalQueueClaim[]> {
  // Recover stale claims for this provider (>5 min old)
  await db.prepare(
    `UPDATE eval_queue SET status='pending', claimed_by=NULL, claimed_at=NULL
     WHERE status='claimed' AND target_provider=? AND claimed_at < datetime('now', '-5 minutes')`
  ).bind(provider).run().catch(() => {});

  // Select candidate IDs to claim
  const { results: candidates } = await db.prepare(
    `SELECT id FROM eval_queue WHERE target_provider=? AND status='pending'
     ORDER BY priority DESC, enqueued_at ASC LIMIT ?`
  ).bind(provider, batchSize).all<{ id: number }>();

  if (candidates.length === 0) return [];

  const ids = candidates.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  // Mark as claimed
  await db.prepare(
    `UPDATE eval_queue SET status='claimed', claimed_by=?, claimed_at=datetime('now')
     WHERE id IN (${placeholders}) AND status='pending'`
  ).bind(workerId, ...ids).run();

  // Fetch what we actually claimed (concurrent workers may have taken some)
  const { results: claimed } = await db.prepare(
    `SELECT id, hn_id, target_provider, target_model, prompt_mode, batch_id
     FROM eval_queue WHERE id IN (${placeholders}) AND claimed_by=?`
  ).bind(...ids, workerId).all<EvalQueueClaim>();

  return claimed;
}

/**
 * Fetch story fields needed to build a QueueMessage for an eval_queue claim.
 */
export async function getStoryForClaim(
  db: D1Database,
  hnId: number,
): Promise<{ hn_id: number; url: string | null; title: string; hn_text: string | null; domain: string | null } | null> {
  return db.prepare(
    `SELECT hn_id, url, title, hn_text, domain FROM stories WHERE hn_id=?`
  ).bind(hnId).first<{ hn_id: number; url: string | null; title: string; hn_text: string | null; domain: string | null }>();
}

/**
 * Create a fake Message<QueueMessage> stub for an eval_queue claim.
 *
 * ack()   → marks the eval_queue row 'done' (used for success and permanent skips).
 * retry() → releases the claim back to 'pending' (used for transient failures).
 *
 * Both are fire-and-forget DB updates (not awaited by callers).
 */
export function makeEvalQueueMsg(
  claim: EvalQueueClaim,
  storyData: { hn_id: number; url: string | null; title: string; hn_text: string | null; domain: string | null },
  db: D1Database,
): Message<QueueMessage> {
  const body: QueueMessage = {
    hn_id: storyData.hn_id,
    url: storyData.url,
    title: storyData.title,
    hn_text: storyData.hn_text,
    domain: storyData.domain,
    eval_model: claim.target_model,
    eval_provider: claim.target_provider,
    prompt_mode: claim.prompt_mode,
    batch_id: claim.batch_id ?? null,
  };

  return {
    id: String(claim.id),
    timestamp: new Date(),
    attempts: 1,
    body,
    ack() {
      db.prepare(`UPDATE eval_queue SET status='done', claimed_by=NULL WHERE id=?`)
        .bind(claim.id).run().catch(() => {});
    },
    retry(_opts?: { delaySeconds?: number }) {
      db.prepare(`UPDATE eval_queue SET status='pending', claimed_by=NULL, claimed_at=NULL WHERE id=?`)
        .bind(claim.id).run().catch(() => {});
    },
  } as unknown as Message<QueueMessage>;
}

// --- Hash utilities ---

export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPrompt(system: string, user: string): Promise<string> {
  return hashString(system + '\n---\n' + user);
}

// --- Error handlers ---

export async function handleParseFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  rawText: string,
  error: unknown,
  promptMode: 'full' | 'lite',
): Promise<void> {
  try {
    await env.CONTENT_SNAPSHOTS.put(
      `rater-debug/${modelId}/${story.hn_id}-${Date.now()}.txt`,
      rawText,
      { customMetadata: { model: modelId, hn_id: String(story.hn_id), error: String(error).slice(0, 500), prompt_mode: promptMode } }
    );
  } catch {}

  const healthKey = raterHealthKvKey(modelId);
  let health = emptyRaterHealth();
  try { const s = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null; if (s) health = s; } catch {}
  health = updateRaterHealthOnParseFailure(health);
  try { await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 }); } catch {}

  if (health.disabled_at) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_disable', severity: 'error', message: `Model ${modelId} auto-disabled: ${health.disabled_reason}`, details: { model: modelId, reason: health.disabled_reason, consecutive_parse_failures: health.consecutive_parse_failures } });
  }

  await markRaterFailed(db, story.hn_id, modelId, provider, `${promptMode === 'lite' ? 'Lite p' : 'P'}arse failure: ${error}`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_fail', severity: 'error', message: `${promptMode === 'lite' ? 'Lite p' : 'P'}arse failure for model ${modelId}: ${String(error).slice(0, 200)}`, details: { model: modelId, error: String(error).slice(0, 500), prompt_mode: promptMode } });
}

export async function handleValidationFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  rawText: string,
  validation: { errors: string[]; warnings: string[] },
  promptMode: 'full' | 'lite',
): Promise<void> {
  try {
    await env.CONTENT_SNAPSHOTS.put(
      `rater-debug/${modelId}/${story.hn_id}-${Date.now()}.txt`,
      rawText,
      { customMetadata: { model: modelId, hn_id: String(story.hn_id), error: validation.errors.join('; ').slice(0, 500), prompt_mode: promptMode } }
    );
  } catch {}

  const healthKey = raterHealthKvKey(modelId);
  let health = emptyRaterHealth();
  try { const s = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null; if (s) health = s; } catch {}
  health = updateRaterHealthOnParseFailure(health);
  try { await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 }); } catch {}

  if (health.disabled_at) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_disable', severity: 'error', message: `Model ${modelId} auto-disabled: ${health.disabled_reason}`, details: { model: modelId, reason: health.disabled_reason } });
  }

  await markRaterFailed(db, story.hn_id, modelId, provider, `${promptMode === 'lite' ? 'Lite v' : 'V'}alidation failed: ${validation.errors.join('; ')}`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_fail', severity: 'error', message: `${promptMode === 'lite' ? 'Lite v' : 'V'}alidation failed for model ${modelId}`, details: { model: modelId, errors: validation.errors, warnings: validation.warnings, prompt_mode: promptMode } });
}

export async function handleApiFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  status: number,
  body: string,
): Promise<void> {
  const healthKey = raterHealthKvKey(modelId);
  let health = emptyRaterHealth();
  try { const s = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null; if (s) health = s; } catch {}
  health = updateRaterHealthOnApiFailure(health);
  try { await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 }); } catch {}
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'error', message: `${provider === 'openrouter' ? 'OpenRouter' : 'API'} error ${status} model=${modelId}`, details: { status, body_preview: body.slice(0, 500), model: modelId } });
}

export async function handleRaterHealthSuccess(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
): Promise<void> {
  const healthKey = raterHealthKvKey(modelId);
  let health = emptyRaterHealth();
  try { const s = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null; if (s) health = s; } catch {}
  const wasDisabled = !!health.disabled_at;
  health = updateRaterHealthOnSuccess(health);
  try { await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 }); } catch {}

  if (wasDisabled) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_enable', severity: 'info', message: `Model ${modelId} auto-re-enabled after successful probe`, details: { model: modelId } });
  }
}

// --- Content preparation ---

export interface PreparedContent {
  content: string;
  contentHash: string | null;
  isLiteMode: boolean;
  modelDef: ModelDefinition | undefined;
  provider: string;
  modelToUse: string;
  msgModelId: string;
  isSelfPost: boolean;
  evalUrl: string;
  domain: string | null;
  contentTruncationPct: number;
}

/**
 * Attempt to retrieve archived content from the Wayback Machine.
 * Checks availability API first, then fetches the closest snapshot.
 * Returns raw HTML string, or null if unavailable/unreachable.
 */
async function fetchFromWayback(url: string): Promise<string | null> {
  try {
    const checkUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const check = await fetch(checkUrl, { signal: AbortSignal.timeout(8000) });
    if (!check.ok) return null;
    const data = await check.json() as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
    const snapshot = data?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) return null;
    const archiveRes = await fetch(snapshot.url, { signal: AbortSignal.timeout(20000) });
    if (!archiveRes.ok) return null;
    return await archiveRes.text();
  } catch {
    return null;
  }
}

/**
 * Prepare content for evaluation. Handles model resolution, credit pause, rater health,
 * binary skip, primary-skipped check, content fetch (KV cache → fetch → content gate → readable check).
 *
 * Returns PreparedContent if ready to evaluate, or null if the message was already handled (acked/retried).
 */
export async function prepareContent(
  msg: Message<QueueMessage>,
  env: Env,
): Promise<PreparedContent | null> {
  const db = writeDb(env.DB);
  const story = msg.body;

  const msgModelId = story.eval_model || env.EVAL_MODEL_OVERRIDE || PRIMARY_MODEL_ID;
  const modelDef = getModelDef(msgModelId);
  const provider = story.eval_provider || modelDef?.provider || 'anthropic';
  const modelToUse = modelDef?.api_model_id || msgModelId;
  // Credit pause check
  if (await checkCreditPause(env.CONTENT_CACHE, provider)) {
    console.warn(`[consumer] Credit pause active for provider=${provider}, deferring hn_id=${story.hn_id}`);
    await db.prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status IN ('queued', 'evaluating')`).bind(story.hn_id).run().catch(() => {});
    msg.ack();
    return null;
  }

  console.log(`[consumer] Processing hn_id=${story.hn_id} model=${msgModelId} provider=${provider}: ${story.title}`);

  // Check rater health for all models
  const healthKey = raterHealthKvKey(msgModelId);
  let health: RaterHealthState = emptyRaterHealth();
  try {
    const stored = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null;
    if (stored) health = stored;
  } catch {}

  const skipCheck = shouldSkipModel(health);
  if (skipCheck.skip) {
    console.warn(`[consumer] Model ${msgModelId} auto-disabled: ${skipCheck.reason}`);
    await markRaterFailed(db, story.hn_id, msgModelId, provider, `Auto-disabled: ${skipCheck.reason}`);
    msg.ack();
    return null;
  }

  const isSelfPost = !story.url && !!story.hn_text;
  const evalUrl = story.url || `https://news.ycombinator.com/item?id=${story.hn_id}`;

  // Skip binary content
  if (story.url && /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|iso|mp4|mp3|wav|avi|mov)(\?|$)/i.test(story.url)) {
    await markSkipped(db, story.hn_id, 'Binary/unsupported content type', 'binary_content', 1.0);
    await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: binary/unsupported content type').catch(() => {});
    await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: binary/unsupported content type`, details: { reason: 'binary', url: story.url, model: msgModelId } });
    msg.ack();
    return null;
  }

  // Skip if story is already skipped (any model that skipped first wins)
  const storyStatus = await db.prepare('SELECT eval_status FROM stories WHERE hn_id = ?').bind(story.hn_id).first<{ eval_status: string }>();
  if (storyStatus?.eval_status === 'skipped') {
    await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: story already skipped').catch(() => {});
    msg.ack();
    return null;
  }

  // Fetch content (KV cache first)
  let content: string;
  if (isSelfPost) {
    content = story.hn_text!;
  } else {
    const kvKey = `content:${story.hn_id}`;
    let cached: string | null = null;
    try { cached = await env.CONTENT_CACHE.get(kvKey); } catch {}
    if (cached) {
      content = cached;
      console.log(`[consumer] KV cache hit for hn_id=${story.hn_id}`);
    } else {
      // 1. Live fetch
      let rawHtml = await fetchUrlContent(story.url!);

      // 2. Evaluate live content quality
      const isErrorResponse = rawHtml.startsWith('[error:');
      const gate = isErrorResponse ? null : classifyContent(rawHtml, story.url!);
      const liveOk = !isErrorResponse && gate !== null && !gate.blocked && hasReadableText(rawHtml);

      // 3. Wayback Machine fallback if live content is unusable (Phase 39C Part 2)
      let archiveUsed = false;
      if (!liveOk) {
        const wb = await fetchFromWayback(story.url!);
        if (wb && hasReadableText(wb)) {
          rawHtml = wb;
          archiveUsed = true;
          console.log(`[consumer] Wayback fallback used for hn_id=${story.hn_id}`);
          await db.prepare('UPDATE stories SET archive_used = 1 WHERE hn_id = ?').bind(story.hn_id).run().catch(() => {});
        }
      }

      // 4. Handle unrecoverable failure (Wayback also unavailable)
      if (!liveOk && !archiveUsed) {
        if (gate?.blocked) {
          await markSkipped(db, story.hn_id,
            `Content gate: ${gate.category} (${gate.confidence.toFixed(2)})`,
            gate.category, gate.confidence);
          await markRaterFailed(db, story.hn_id, msgModelId, provider,
            `Skipped: ${gate.category} (${gate.signals.join('; ')})`).catch(() => {});
          await logEvent(db, {
            hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info',
            message: `Content gate: ${gate.category}`,
            details: { reason: gate.category, confidence: gate.confidence, signals: gate.signals, model: msgModelId },
          });
        } else if (rawHtml.startsWith('[error:binary]')) {
          await markSkipped(db, story.hn_id, 'Binary/unsupported content type', 'binary_content', 1.0);
          await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: binary content').catch(() => {});
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: binary content type`, details: { reason: 'binary', raw_length: rawHtml.length, model: msgModelId } });
        } else {
          await markSkipped(db, story.hn_id, 'No readable content (JavaScript-only page)', 'js_rendered', 0.9);
          await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: no readable content').catch(() => {});
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: no readable text in HTML (likely JS-rendered SPA)`, details: { reason: 'no_readable_text', raw_length: rawHtml.length, model: msgModelId } });
        }
        msg.ack();
        return null;
      }

      content = cleanHtml(rawHtml, CONTENT_MAX_CHARS);
      try {
        await env.CONTENT_CACHE.put(kvKey, content, { expirationTtl: 3600 });
      } catch {}
    }
  }

  if (content.length < 50) {
    await markSkipped(db, story.hn_id, 'Content too short');
    await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: content too short').catch(() => {});
    await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: content too short (${content.length} chars)`, details: { reason: 'too_short', content_length: content.length, model: msgModelId } });
    msg.ack();
    return null;
  }

  // Per-model content truncation for small-context models
  let contentTruncationPct = 0;
  if (modelDef?.max_input_chars && content.length > modelDef.max_input_chars) {
    contentTruncationPct = 1 - (modelDef.max_input_chars / content.length);
    content = content.slice(0, modelDef.max_input_chars);
  }

  const isLiteMode = story.prompt_mode === 'lite' || story.prompt_mode === 'light' || modelDef?.prompt_mode === 'lite';
  const domain = story.domain || (story.url ? extractDomain(story.url) : null);

  // Compute content hash for drift detection (skip self-posts — content is user-mutable)
  let contentHash: string | null = null;
  if (!isSelfPost && content.length >= 50) {
    try {
      contentHash = await computeContentHash(content);
    } catch {}
  }

  return {
    content,
    contentHash,
    isLiteMode,
    modelDef,
    provider,
    modelToUse,
    msgModelId,
    isSelfPost,
    evalUrl,
    domain,
    contentTruncationPct,
  };
}

// --- Lite result processing ---

export async function processLiteResult(
  env: Env,
  msg: Message<QueueMessage>,
  prep: PreparedContent,
  rawText: string,
  inputTokens: number,
  outputTokens: number,
  evalStartMs: number,
): Promise<boolean> {
  const db = writeDb(env.DB);
  const story = msg.body;

  // Parse
  let liteParsed: LiteEvalResponse;
  try {
    const extracted = extractJsonFromResponse(rawText);
    liteParsed = JSON.parse(extracted) as LiteEvalResponse;
  } catch (parseErr) {
    await handleParseFailure(env, db, story, prep.msgModelId, prep.provider, rawText, parseErr, 'lite');
    msg.ack();
    return false;
  }

  // Validate
  const liteValidation = validateLiteEvalResponse(liteParsed);
  if (!liteValidation.valid) {
    await handleValidationFailure(env, db, story, prep.msgModelId, prep.provider, rawText, liteValidation, 'lite');
    msg.ack();
    return false;
  }

  if (liteValidation.warnings.length > 0 || liteValidation.repairs.length > 0) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Lite validation warnings for model ${prep.msgModelId}: ${liteValidation.warnings.length}W ${liteValidation.repairs.length}R`, details: { model: prep.msgModelId, warnings: liteValidation.warnings, repairs: liteValidation.repairs, prompt_mode: 'lite' } });
  }

  // Build hashes
  const liteUserMessage = buildLiteUserMessage(prep.evalUrl, story.title, prep.content);
  const litePromptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_LITE, liteUserMessage);
  const liteMethodologyHash = await hashString(METHODOLOGY_SYSTEM_PROMPT_LITE);

  // Write
  await writeLiteRaterEvalResult(db, story.hn_id, liteParsed, prep.msgModelId, prep.provider, litePromptHash, liteMethodologyHash, inputTokens, outputTokens, prep.contentTruncationPct, story.batch_id ?? null);

  // Invalidate domain caches — lite eval fills hcb_editorial_mean which affects feed/domain display
  const cacheKeys = [
    'q:domainSignalProfiles',
    'q:allDomainStats:count:50',
    'q:allDomainStats:count:200',
    'q:allDomainStats:score:200',
    'q:allDomainStats:setl:200',
    'q:allDomainStats:conf:200',
  ];
  for (const key of cacheKeys) {
    env.CONTENT_CACHE.delete(key).catch(() => {});
  }

  // Health success
  await handleRaterHealthSuccess(env, db, story, prep.msgModelId);

  const { weighted_mean, classification } = computeLiteAggregates(liteParsed);
  const evalDurationMs = Date.now() - evalStartMs;
  console.log(`[consumer] Done (lite): hn_id=${story.hn_id} → ${classification} (${weighted_mean}) [${prep.msgModelId}] ${evalDurationMs}ms`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Lite evaluated: ${classification} (${weighted_mean.toFixed(2)})`, details: { classification, weighted_mean, model: prep.msgModelId, provider: prep.provider, prompt_mode: 'lite', input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: evalDurationMs } });
  msg.ack();
  return true;
}

// --- Full result processing ---

export async function processFullResult(
  env: Env,
  msg: Message<QueueMessage>,
  prep: PreparedContent,
  slim: SlimEvalResponse,
  inputTokens: number,
  outputTokens: number,
  evalStartMs: number,
  cachedDcp: Record<string, unknown> | null,
): Promise<boolean> {
  const db = writeDb(env.DB);
  const story = msg.body;

  // Handle DCP "cached" string — substitute from cached DCP
  let dcpForCompute: Record<string, DcpElement> | null = null;
  if (typeof slim.domain_context_profile === 'string') {
    if (cachedDcp) {
      const elements = (cachedDcp as any).elements || cachedDcp;
      slim.domain_context_profile = {
        domain: prep.domain || '',
        eval_date: new Date().toISOString().slice(0, 10),
        elements,
      };
      dcpForCompute = elements as Record<string, DcpElement>;
    } else {
      slim.domain_context_profile = {
        domain: prep.domain || '',
        eval_date: new Date().toISOString().slice(0, 10),
        elements: {},
      };
    }
  } else if (slim.domain_context_profile?.elements) {
    dcpForCompute = slim.domain_context_profile.elements as Record<string, DcpElement>;
  }

  // Compute derived fields
  const channelWeights = slim.evaluation.channel_weights;
  const derivedScores = computeDerivedScoreFields(slim.scores, channelWeights, dcpForCompute);

  for (const score of derivedScores) {
    (score as any).witness_ratio = computeWitnessRatio(score.witness_facts, score.witness_inferences);
  }

  const aggregates = computeAggregates(derivedScores, channelWeights);

  const fullResult: EvalResult = {
    ...slim,
    domain_context_profile: slim.domain_context_profile as { domain: string; eval_date: string; elements: Record<string, unknown> },
    scores: derivedScores,
    aggregates,
  };

  // Build hashes
  const userMessage = buildUserMessageWithDcp(prep.evalUrl, prep.content, prep.isSelfPost, cachedDcp);
  const promptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);
  const methodologyHash = await hashString(METHODOLOGY_SYSTEM_PROMPT_SLIM);

  // Check if this is the first full eval for this story (determines housekeeping tasks)
  const preWriteStatus = await db.prepare('SELECT eval_status FROM stories WHERE hn_id = ?')
    .bind(story.hn_id).first<{ eval_status: string }>();
  const isFirstFullEval = preWriteStatus != null && preWriteStatus.eval_status !== 'done' && preWriteStatus.eval_status !== 'rescoring';

  // Write to rater tables — writeRaterEvalResult also materializes to stories table (first full eval wins)
  await writeRaterEvalResult(db, story.hn_id, fullResult, prep.msgModelId, prep.provider, promptHash, methodologyHash, inputTokens, outputTokens, prep.contentTruncationPct, story.batch_id ?? null);

  // First full eval: write methodology hash + content hash + invalidate query caches
  if (isFirstFullEval) {
    try {
      await db
        .prepare(`UPDATE stories SET methodology_hash = ?, content_hash = COALESCE(?, content_hash), content_last_fetched = datetime('now') WHERE hn_id = ?`)
        .bind(methodologyHash, prep.contentHash, story.hn_id)
        .run();
    } catch {}
  }

  // Invalidate KV query caches (all evals, not just first — data changed)
  const cacheKeys = [
    'q:allDomainStats:count:50',
    'q:allDomainStats:count:200',
    'q:allDomainStats:score:200',
    'q:allDomainStats:setl:200',
    'q:allDomainStats:conf:200',
    'q:domainSignalProfiles',
    'q:domainIntelligence',
    'q:mostGatekeptDomains',
    'q:articleDetailedStats',
    'q:articleSparklines:30',
    'q:globalGateStats',
  ];
  for (const key of cacheKeys) {
    env.CONTENT_CACHE.delete(key).catch(() => {});
  }

  // R2 snapshot (first full eval only — subsequent evals don't re-snapshot)
  if (isFirstFullEval) {
    try {
      const snapshotKey = `${story.hn_id}/${new Date().toISOString().slice(0, 10)}.txt`;
      await env.CONTENT_SNAPSHOTS.put(snapshotKey, prep.content, {
        customMetadata: {
          hn_id: String(story.hn_id),
          url: prep.evalUrl,
          title: story.title,
          domain: prep.domain || '',
          content_length: String(prep.content.length),
          classification: aggregates.classification,
          weighted_mean: String(aggregates.weighted_mean),
        },
      });
    } catch (err) {
      console.error(`[consumer] R2 snapshot failed (non-fatal): ${err}`);
      await logEvent(db, { hn_id: story.hn_id, event_type: 'r2_error', severity: 'warn', message: `R2 snapshot failed`, details: { error: String(err) } });
    }
  }

  // Internet Archive preservation (first full eval only)
  if (isFirstFullEval && story.url) {
    requestArchive(db, env.CONTENT_CACHE, story.hn_id, story.url).catch(() => {});
  }

  // Cache DCP if new (first full eval only)
  if (isFirstFullEval) {
    const dcpObj = slim.domain_context_profile as { elements?: Record<string, unknown> };
    if (!cachedDcp && prep.domain && typeof slim.domain_context_profile !== 'string' && dcpObj?.elements) {
      const dcpElements = dcpObj.elements;
      await cacheDcp(db, prep.domain, dcpElements);
      try { await env.CONTENT_CACHE.put(`dcp:${prep.domain}`, JSON.stringify(dcpElements), { expirationTtl: 604800 }); } catch {}
    }
  }

  // Track rater health for all models
  await handleRaterHealthSuccess(env, db, story, prep.msgModelId);

  const evalDurationMs = Date.now() - evalStartMs;
  console.log(`[consumer] Done: hn_id=${story.hn_id} → ${aggregates.classification} (${aggregates.weighted_mean}) [${prep.msgModelId}] ${evalDurationMs}ms`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Evaluated: ${aggregates.classification} (${aggregates.weighted_mean.toFixed(2)})`, details: { classification: aggregates.classification, weighted_mean: aggregates.weighted_mean, model: prep.msgModelId, provider: prep.provider, input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: evalDurationMs } });
  msg.ack();
  return true;
}

// --- DCP lookup helper ---

export async function lookupCachedDcp(
  env: Env,
  domain: string | null,
): Promise<Record<string, unknown> | null> {
  if (!domain) return null;
  const kvDcp = await env.CONTENT_CACHE.get(`dcp:${domain}`, 'json');
  if (kvDcp) return kvDcp as Record<string, unknown>;
  return await getCachedDcp(writeDb(env.DB), domain);
}

// --- Failure handler for outer catch ---

export async function handleMessageFailure(
  env: Env,
  msg: Message<QueueMessage>,
  prep: PreparedContent | null,
  error: unknown,
  evalStartMs: number,
): Promise<void> {
  const db = writeDb(env.DB);
  const story = msg.body;
  const msgModelId = prep?.msgModelId || story.eval_model || PRIMARY_MODEL_ID;
  const provider = prep?.provider || story.eval_provider || 'unknown';
  const evalDurationMs = Date.now() - evalStartMs;

  console.error(`[consumer] Failed: hn_id=${story.hn_id} model=${msgModelId} (${evalDurationMs}ms):`, error);
  await markFailed(db, story.hn_id, `${error}`).catch(() => {});
  await markRaterFailed(db, story.hn_id, msgModelId, provider, `${error}`).catch(() => {});
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_failure', severity: 'error', message: `Evaluation failed: ${String(error).slice(0, 200)}`, details: { error: String(error).slice(0, 500), duration_ms: evalDurationMs, model: msgModelId, provider } });
  msg.retry();
}
