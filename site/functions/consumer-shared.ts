/**
 * Shared types, utilities, and content preparation for provider-specific consumers.
 *
 * All provider-agnostic logic lives here. The 3 consumer workers import from this module.
 */

import {
  EVAL_MODEL,
  CONTENT_MAX_CHARS,
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LIGHT,
  extractDomain,
  buildUserMessageWithDcp,
  buildLightUserMessage,
  extractJsonFromResponse,
  validateLightEvalResponse,
  computeLightAggregates,
  writeLightRaterEvalResult,
  fetchUrlContent,
  writeRaterEvalResult,
  markFailed,
  markSkipped,
  markRaterFailed,
  getCachedDcp,
  cacheDcp,
  getModelDef,
  PRIMARY_MODEL_ID,
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
  type LightEvalResponse,
} from '../src/lib/shared-eval';

import { computeAggregates, computeWitnessRatio, computeDerivedScoreFields, type DcpElement } from '../src/lib/compute-aggregates';
import { cleanHtml, hasReadableText } from '../src/lib/html-clean';
import { classifyContent } from '../src/lib/content-gate';
import { logEvent } from '../src/lib/events';
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
  prompt_mode?: 'full' | 'light';
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
  promptMode: 'full' | 'light',
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
  await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 });

  if (health.disabled_at) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_disable', severity: 'error', message: `Model ${modelId} auto-disabled: ${health.disabled_reason}`, details: { model: modelId, reason: health.disabled_reason, consecutive_parse_failures: health.consecutive_parse_failures } });
  }

  await markRaterFailed(db, story.hn_id, modelId, provider, `${promptMode === 'light' ? 'Light p' : 'P'}arse failure: ${error}`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_fail', severity: 'error', message: `${promptMode === 'light' ? 'Light p' : 'P'}arse failure for model ${modelId}: ${String(error).slice(0, 200)}`, details: { model: modelId, error: String(error).slice(0, 500), prompt_mode: promptMode } });
}

export async function handleValidationFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  rawText: string,
  validation: { errors: string[]; warnings: string[] },
  promptMode: 'full' | 'light',
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
  await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 });

  if (health.disabled_at) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_disable', severity: 'error', message: `Model ${modelId} auto-disabled: ${health.disabled_reason}`, details: { model: modelId, reason: health.disabled_reason } });
  }

  await markRaterFailed(db, story.hn_id, modelId, provider, `${promptMode === 'light' ? 'Light v' : 'V'}alidation failed: ${validation.errors.join('; ')}`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_fail', severity: 'error', message: `${promptMode === 'light' ? 'Light v' : 'V'}alidation failed for model ${modelId}`, details: { model: modelId, errors: validation.errors, warnings: validation.warnings, prompt_mode: promptMode } });
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
  await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 });
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
  await env.CONTENT_CACHE.put(healthKey, JSON.stringify(health), { expirationTtl: 86400 });

  if (wasDisabled) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_auto_enable', severity: 'info', message: `Model ${modelId} auto-re-enabled after successful probe`, details: { model: modelId } });
  }
}

// --- Content preparation ---

export interface PreparedContent {
  content: string;
  isPrimary: boolean;
  isLightMode: boolean;
  modelDef: ModelDefinition | undefined;
  provider: string;
  modelToUse: string;
  msgModelId: string;
  isSelfPost: boolean;
  evalUrl: string;
  domain: string | null;
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
  const db = env.DB;
  const story = msg.body;

  const msgModelId = story.eval_model || env.EVAL_MODEL_OVERRIDE || EVAL_MODEL;
  const modelDef = getModelDef(msgModelId);
  const provider = story.eval_provider || modelDef?.provider || 'anthropic';
  const modelToUse = modelDef?.api_model_id || msgModelId;
  const isPrimary = msgModelId === PRIMARY_MODEL_ID || (!story.eval_model && !env.EVAL_MODEL_OVERRIDE);

  // Credit pause check
  if (await checkCreditPause(env.CONTENT_CACHE, provider)) {
    console.warn(`[consumer] Credit pause active for provider=${provider}, deferring hn_id=${story.hn_id}`);
    if (isPrimary) {
      await db.prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status IN ('queued', 'evaluating')`).bind(story.hn_id).run().catch(() => {});
    }
    msg.ack();
    return null;
  }

  console.log(`[consumer] Processing hn_id=${story.hn_id} model=${msgModelId} provider=${provider}: ${story.title}`);

  // For non-primary models, check rater health
  if (!isPrimary) {
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
  }

  const isSelfPost = !story.url && !!story.hn_text;
  const evalUrl = story.url || `https://news.ycombinator.com/item?id=${story.hn_id}`;

  // Skip binary content
  if (story.url && /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|iso|mp4|mp3|wav|avi|mov)(\?|$)/i.test(story.url)) {
    if (isPrimary) {
      await markSkipped(db, story.hn_id, 'Binary/unsupported content type');
    }
    await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: binary/unsupported content type').catch(() => {});
    await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: binary/unsupported content type`, details: { reason: 'binary', url: story.url, model: msgModelId } });
    msg.ack();
    return null;
  }

  // Non-primary: skip if primary already skipped
  if (!isPrimary) {
    const primaryStatus = await db.prepare('SELECT eval_status FROM stories WHERE hn_id = ?').bind(story.hn_id).first<{ eval_status: string }>();
    if (primaryStatus?.eval_status === 'skipped') {
      await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: primary model skipped this story').catch(() => {});
      msg.ack();
      return null;
    }
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
      const rawHtml = await fetchUrlContent(story.url!);

      // Content gate
      const gate = classifyContent(rawHtml, story.url!);
      if (gate.blocked) {
        if (isPrimary) {
          await markSkipped(db, story.hn_id,
            `Content gate: ${gate.category} (${gate.confidence.toFixed(2)})`,
            gate.category, gate.confidence);
        }
        await markRaterFailed(db, story.hn_id, msgModelId, provider,
          `Skipped: ${gate.category} (${gate.signals.join('; ')})`).catch(() => {});
        await logEvent(db, {
          hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info',
          message: `Content gate: ${gate.category}`,
          details: { reason: gate.category, confidence: gate.confidence, signals: gate.signals, model: msgModelId },
        });
        msg.ack();
        return null;
      }

      // Readable text check
      if (!hasReadableText(rawHtml)) {
        if (isPrimary) {
          await markSkipped(db, story.hn_id, 'No readable content (JavaScript-only page)');
        }
        await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: no readable content').catch(() => {});
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: no readable text in HTML (likely JS-rendered SPA)`, details: { reason: 'no_readable_text', raw_length: rawHtml.length, model: msgModelId } });
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
    if (isPrimary) {
      await markSkipped(db, story.hn_id, 'Content too short');
    }
    await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: content too short').catch(() => {});
    await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: content too short (${content.length} chars)`, details: { reason: 'too_short', content_length: content.length, model: msgModelId } });
    msg.ack();
    return null;
  }

  const isLightMode = story.prompt_mode === 'light' || modelDef?.prompt_mode === 'light';
  const domain = story.domain || (story.url ? extractDomain(story.url) : null);

  return {
    content,
    isPrimary,
    isLightMode,
    modelDef,
    provider,
    modelToUse,
    msgModelId,
    isSelfPost,
    evalUrl,
    domain,
  };
}

// --- Light result processing ---

export async function processLightResult(
  env: Env,
  msg: Message<QueueMessage>,
  prep: PreparedContent,
  rawText: string,
  inputTokens: number,
  outputTokens: number,
  evalStartMs: number,
): Promise<boolean> {
  const db = env.DB;
  const story = msg.body;

  // Parse
  let lightParsed: LightEvalResponse;
  try {
    const extracted = extractJsonFromResponse(rawText);
    lightParsed = JSON.parse(extracted) as LightEvalResponse;
  } catch (parseErr) {
    await handleParseFailure(env, db, story, prep.msgModelId, prep.provider, rawText, parseErr, 'light');
    msg.ack();
    return false;
  }

  // Validate
  const lightValidation = validateLightEvalResponse(lightParsed);
  if (!lightValidation.valid) {
    await handleValidationFailure(env, db, story, prep.msgModelId, prep.provider, rawText, lightValidation, 'light');
    msg.ack();
    return false;
  }

  if (lightValidation.warnings.length > 0 || lightValidation.repairs.length > 0) {
    await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Light validation warnings for model ${prep.msgModelId}: ${lightValidation.warnings.length}W ${lightValidation.repairs.length}R`, details: { model: prep.msgModelId, warnings: lightValidation.warnings, repairs: lightValidation.repairs, prompt_mode: 'light' } });
  }

  // Build hashes
  const lightUserMessage = buildLightUserMessage(prep.evalUrl, story.title, prep.content);
  const lightPromptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);
  const lightMethodologyHash = await hashString(METHODOLOGY_SYSTEM_PROMPT_LIGHT);

  // Write
  await writeLightRaterEvalResult(db, story.hn_id, lightParsed, prep.msgModelId, prep.provider, lightPromptHash, lightMethodologyHash, inputTokens, outputTokens);

  // Health success
  await handleRaterHealthSuccess(env, db, story, prep.msgModelId);

  const { weighted_mean, classification } = computeLightAggregates(lightParsed);
  const evalDurationMs = Date.now() - evalStartMs;
  console.log(`[consumer] Done (light): hn_id=${story.hn_id} → ${classification} (${weighted_mean}) [${prep.msgModelId}] ${evalDurationMs}ms`);
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Light evaluated: ${classification} (${weighted_mean.toFixed(2)})`, details: { classification, weighted_mean, model: prep.msgModelId, provider: prep.provider, prompt_mode: 'light', input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: evalDurationMs } });
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
  const db = env.DB;
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

  // Write to rater tables (always) — writeRaterEvalResult also writes to stories/scores/fair_witness if primary
  await writeRaterEvalResult(db, story.hn_id, fullResult, prep.msgModelId, prep.provider, promptHash, methodologyHash, inputTokens, outputTokens);

  // Primary model: write methodology hash
  if (prep.isPrimary) {
    try {
      await db
        .prepare(`UPDATE stories SET methodology_hash = ? WHERE hn_id = ?`)
        .bind(methodologyHash, story.hn_id)
        .run();
    } catch {}
  }

  // R2 snapshot (primary only)
  if (prep.isPrimary) {
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

  // Cache DCP if new (primary only)
  if (prep.isPrimary) {
    const dcpObj = slim.domain_context_profile as { elements?: Record<string, unknown> };
    if (!cachedDcp && prep.domain && typeof slim.domain_context_profile !== 'string' && dcpObj?.elements) {
      const dcpElements = dcpObj.elements;
      await cacheDcp(db, prep.domain, dcpElements);
      await env.CONTENT_CACHE.put(`dcp:${prep.domain}`, JSON.stringify(dcpElements), {
        expirationTtl: 604800,
      });
    }
  }

  // Rater health success (non-primary)
  if (!prep.isPrimary) {
    await handleRaterHealthSuccess(env, db, story, prep.msgModelId);
  }

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
  return await getCachedDcp(env.DB, domain);
}

// --- Failure handler for outer catch ---

export async function handleMessageFailure(
  env: Env,
  msg: Message<QueueMessage>,
  prep: PreparedContent | null,
  error: unknown,
  evalStartMs: number,
): Promise<void> {
  const db = env.DB;
  const story = msg.body;
  const msgModelId = prep?.msgModelId || story.eval_model || EVAL_MODEL;
  const provider = prep?.provider || story.eval_provider || 'unknown';
  const isPrimary = prep?.isPrimary ?? (msgModelId === PRIMARY_MODEL_ID);
  const evalDurationMs = Date.now() - evalStartMs;

  console.error(`[consumer] Failed: hn_id=${story.hn_id} model=${msgModelId} (${evalDurationMs}ms):`, error);
  if (isPrimary) {
    await markFailed(db, story.hn_id, `${error}`).catch(() => {});
  }
  await markRaterFailed(db, story.hn_id, msgModelId, provider, `${error}`).catch(() => {});
  await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_failure', severity: 'error', message: `Evaluation failed: ${String(error).slice(0, 200)}`, details: { error: String(error).slice(0, 500), duration_ms: evalDurationMs, model: msgModelId, provider } });
  msg.retry();
}
