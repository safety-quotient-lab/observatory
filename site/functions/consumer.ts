/**
 * Queue Consumer Worker: Processes one HRCB evaluation per queue message.
 *
 * Architecture:
 * - Receives messages from hrcb-eval-queue (one story per message)
 * - Fetches URL content (or uses hn_text for self-posts)
 * - Passes full HTML to Claude (slim prompt — no aggregates in output)
 * - Computes aggregates deterministically on Worker CPU
 * - Caches DCP per domain (7-day TTL)
 * - Writes results to D1
 * - Proactively reads Anthropic rate limit headers to self-throttle before 429s
 * - Acks on success, retries on failure (max 2 retries → DLQ)
 */

import {
  EVAL_MODEL,
  EVAL_MAX_TOKENS,
  EVAL_MAX_TOKENS_EXTENDED,
  EVAL_MAX_TOKENS_LIGHT,
  CONTENT_MAX_CHARS,
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  METHODOLOGY_SYSTEM_PROMPT_LIGHT,
  extractDomain,
  buildUserMessageWithDcp,
  buildLightUserMessage,
  parseSlimEvalResponse,
  parseOpenRouterResponse,
  extractJsonFromResponse,
  validateSlimEvalResponse,
  validateLightEvalResponse,
  computeLightAggregates,
  writeLightRaterEvalResult,
  fetchUrlContent,
  writeEvalResult,
  writeRaterEvalResult,
  markFailed,
  markSkipped,
  markRaterFailed,
  getCachedDcp,
  cacheDcp,
  getModelDef,
  PRIMARY_MODEL_ID,
  MODEL_REGISTRY,
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

import {
  type RateLimitState,
  type RateLimitHeaders,
  readRateLimitHeaders,
  updateRateLimitState,
  writeRateLimitSnapshot,
  checkCreditPause,
  setCreditPause,
  checkRateLimitCapacity,
  addJitter,
} from './rate-limit';

import {
  callAnthropicApi,
  callOpenRouterApi,
  callWorkersAi,
} from './providers';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  OPENROUTER_API_KEY?: string;
  AI?: any; // Cloudflare Workers AI binding
  CONTENT_CACHE: KVNamespace;
  CONTENT_SNAPSHOTS: R2Bucket;
  EVAL_MODEL_OVERRIDE?: string;
}

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
  eval_model?: string;
  eval_provider?: string;
}

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPrompt(system: string, user: string): Promise<string> {
  return hashString(system + '\n---\n' + user);
}

// --- Consolidated error handlers ---

async function handleParseFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  rawText: string,
  error: unknown,
  promptMode: 'full' | 'light',
): Promise<void> {
  // Store raw response for debugging
  try {
    await env.CONTENT_SNAPSHOTS.put(
      `rater-debug/${modelId}/${story.hn_id}-${Date.now()}.txt`,
      rawText,
      { customMetadata: { model: modelId, hn_id: String(story.hn_id), error: String(error).slice(0, 500), prompt_mode: promptMode } }
    );
  } catch {}

  // Update rater health
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

async function handleValidationFailure(
  env: Env,
  db: D1Database,
  story: QueueMessage,
  modelId: string,
  provider: string,
  rawText: string,
  validation: { errors: string[]; warnings: string[] },
  promptMode: 'full' | 'light',
): Promise<void> {
  // Store raw response for debugging
  try {
    await env.CONTENT_SNAPSHOTS.put(
      `rater-debug/${modelId}/${story.hn_id}-${Date.now()}.txt`,
      rawText,
      { customMetadata: { model: modelId, hn_id: String(story.hn_id), error: validation.errors.join('; ').slice(0, 500), prompt_mode: promptMode } }
    );
  } catch {}

  // Update rater health
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

async function handleApiFailure(
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

async function handleRaterHealthSuccess(
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

// --- Queue handler ---

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;

    for (const msg of batch.messages) {
      const story = msg.body;

      // Determine model + provider from message payload (default: primary/anthropic)
      const msgModelId = story.eval_model || env.EVAL_MODEL_OVERRIDE || EVAL_MODEL;
      const modelDef = getModelDef(msgModelId);
      const provider = story.eval_provider || modelDef?.provider || 'anthropic';
      const modelToUse = modelDef?.api_model_id || msgModelId;
      const isPrimary = msgModelId === PRIMARY_MODEL_ID || (!story.eval_model && !env.EVAL_MODEL_OVERRIDE);

      // Check API key / binding availability
      const apiKey = provider === 'openrouter' ? env.OPENROUTER_API_KEY : provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined;
      if (provider === 'workers-ai' && !env.AI) {
        console.warn(`[consumer] No AI binding for workers-ai model=${msgModelId}, skipping hn_id=${story.hn_id}`);
        msg.ack();
        continue;
      }
      if (provider !== 'workers-ai' && !apiKey) {
        console.warn(`[consumer] No API key for provider=${provider}, model=${msgModelId}, skipping hn_id=${story.hn_id}`);
        msg.ack();
        continue;
      }

      // Credit pause: if provider credits are exhausted, reset to pending and skip
      if (await checkCreditPause(env.CONTENT_CACHE, provider)) {
        console.warn(`[consumer] Credit pause active for provider=${provider}, deferring hn_id=${story.hn_id}`);
        if (isPrimary) {
          await db.prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status IN ('queued', 'evaluating')`).bind(story.hn_id).run().catch(() => {});
        }
        msg.ack();
        continue;
      }

      console.log(`[consumer] Processing hn_id=${story.hn_id} model=${msgModelId} provider=${provider}: ${story.title}`);
      let evalStartMs = Date.now();

      try {
        // For non-primary models, check rater health (M5)
        if (!isPrimary) {
          const healthKey = raterHealthKvKey(msgModelId);
          let health: RaterHealthState = emptyRaterHealth();
          try {
            const stored = await env.CONTENT_CACHE.get(healthKey, 'json') as RaterHealthState | null;
            if (stored) health = stored;
          } catch { /* KV miss */ }

          const skipCheck = shouldSkipModel(health);
          if (skipCheck.skip) {
            console.warn(`[consumer] Model ${msgModelId} auto-disabled: ${skipCheck.reason}`);
            await markRaterFailed(db, story.hn_id, msgModelId, provider, `Auto-disabled: ${skipCheck.reason}`);
            msg.ack();
            continue;
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
          continue;
        }

        // Non-primary: skip if primary already skipped this story
        if (!isPrimary) {
          const primaryStatus = await db.prepare('SELECT eval_status FROM stories WHERE hn_id = ?').bind(story.hn_id).first<{ eval_status: string }>();
          if (primaryStatus?.eval_status === 'skipped') {
            await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: primary model skipped this story').catch(() => {});
            msg.ack();
            continue;
          }
        }

        // Fetch content (check KV cache first)
        let content: string;
        if (isSelfPost) {
          content = story.hn_text!;
        } else {
          const kvKey = `content:${story.hn_id}`;
          const cached = await env.CONTENT_CACHE.get(kvKey);
          if (cached) {
            content = cached;
            console.log(`[consumer] KV cache hit for hn_id=${story.hn_id}`);
          } else {
            const rawHtml = await fetchUrlContent(story.url!);

            // Content gate: classify fetched content before eval
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
              continue;
            }

            // Pre-check: does the page have any human-readable text?
            // JS-rendered SPAs return script bundles but no server-side prose.
            if (!hasReadableText(rawHtml)) {
              if (isPrimary) {
                await markSkipped(db, story.hn_id, 'No readable content (JavaScript-only page)');
              }
              await markRaterFailed(db, story.hn_id, msgModelId, provider, 'Skipped: no readable content').catch(() => {});
              await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: no readable text in HTML (likely JS-rendered SPA)`, details: { reason: 'no_readable_text', raw_length: rawHtml.length, model: msgModelId } });
              msg.ack();
              continue;
            }

            content = cleanHtml(rawHtml, CONTENT_MAX_CHARS);
            // Cache for subsequent model evaluations (1-hour TTL)
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
          continue;
        }

        // --- Light prompt mode branch ---
        const isLightMode = modelDef?.prompt_mode === 'light';

        if (isLightMode) {
          // Light mode: simplified prompt, no DCP, no per-section scores
          const lightUserMessage = buildLightUserMessage(evalUrl, story.title, content);
          const lightPromptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);
          const lightMethodologyHash = await hashString(METHODOLOGY_SYSTEM_PROMPT_LIGHT);

          evalStartMs = Date.now();
          let rawText: string;
          let lightInputTokens = 0;
          let lightOutputTokens = 0;

          if (provider === 'workers-ai') {
            if (!modelDef) throw new Error(`Unknown model in registry: ${msgModelId}`);
            const { text } = await callWorkersAi(env.AI, modelDef, METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);
            rawText = text;
          } else if (provider === 'openrouter') {
            if (!modelDef) throw new Error(`Unknown model in registry: ${msgModelId}`);
            const lightModelDef = { ...modelDef, max_tokens: EVAL_MAX_TOKENS_LIGHT };
            const { response: res } = await callOpenRouterApi(apiKey!, lightModelDef, METHODOLOGY_SYSTEM_PROMPT_LIGHT, lightUserMessage);
            if (!res.ok) {
              const body = await res.text();
              if (res.status === 429) {
                const delaySec = addJitter(60);
                await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: msgModelId } });
                msg.retry({ delaySeconds: delaySec });
                continue;
              }
              await handleApiFailure(env, db, story, msgModelId, provider, res.status, body);
              throw new Error(`OpenRouter API error ${res.status}: ${body}`);
            }
            const rawData = await res.json() as any;
            rawText = rawData.choices?.[0]?.message?.content || '';
            lightInputTokens = rawData.usage?.prompt_tokens ?? 0;
            lightOutputTokens = rawData.usage?.completion_tokens ?? 0;
          } else {
            throw new Error(`Light mode not supported for provider=${provider}`);
          }

          // Parse light response
          let lightParsed: LightEvalResponse;
          try {
            const extracted = extractJsonFromResponse(rawText);
            lightParsed = JSON.parse(extracted) as LightEvalResponse;
          } catch (parseErr) {
            await handleParseFailure(env, db, story, msgModelId, provider, rawText, parseErr, 'light');
            msg.ack();
            continue;
          }

          // Validate light response
          const lightValidation = validateLightEvalResponse(lightParsed);
          if (!lightValidation.valid) {
            await handleValidationFailure(env, db, story, msgModelId, provider, rawText, lightValidation, 'light');
            msg.ack();
            continue;
          }

          if (lightValidation.warnings.length > 0 || lightValidation.repairs.length > 0) {
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Light validation warnings for model ${msgModelId}: ${lightValidation.warnings.length}W ${lightValidation.repairs.length}R`, details: { model: msgModelId, warnings: lightValidation.warnings, repairs: lightValidation.repairs, prompt_mode: 'light' } });
          }

          // Write light results
          await writeLightRaterEvalResult(db, story.hn_id, lightParsed, msgModelId, provider, lightPromptHash, lightMethodologyHash, lightInputTokens, lightOutputTokens);

          // Update rater health on success
          await handleRaterHealthSuccess(env, db, story, msgModelId);

          const { weighted_mean, classification } = computeLightAggregates(lightParsed);
          const evalDurationMs = Date.now() - evalStartMs;
          console.log(`[consumer] Done (light): hn_id=${story.hn_id} → ${classification} (${weighted_mean}) [${msgModelId}] ${evalDurationMs}ms`);
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Light evaluated: ${classification} (${weighted_mean.toFixed(2)})`, details: { classification, weighted_mean, model: msgModelId, provider, prompt_mode: 'light', input_tokens: lightInputTokens, output_tokens: lightOutputTokens, duration_ms: evalDurationMs } });
          msg.ack();
          continue;
        }

        // --- Full prompt mode (existing logic) ---

        // Look up cached DCP for domain (KV first, then D1 fallback)
        const domain = story.domain || (story.url ? extractDomain(story.url) : null);
        let cachedDcp: Record<string, unknown> | null = null;
        if (domain) {
          const kvDcp = await env.CONTENT_CACHE.get(`dcp:${domain}`, 'json');
          if (kvDcp) {
            cachedDcp = kvDcp as Record<string, unknown>;
          } else {
            cachedDcp = await getCachedDcp(db, domain);
          }
        }

        // Build user message with optional cached DCP
        const userMessage = buildUserMessageWithDcp(evalUrl, content, isSelfPost, cachedDcp);
        const promptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);
        const methodologyHash = await hashString(METHODOLOGY_SYSTEM_PROMPT_SLIM);

        // Pre-call: check rate limit capacity (Anthropic models only — OpenRouter has different limits)
        if (provider === 'anthropic') {
          const capacity = await checkRateLimitCapacity(env.CONTENT_CACHE, msgModelId);
          if (!capacity.ok) {
            const delay = addJitter(capacity.delaySeconds!);
            console.warn(`[consumer] Self-throttle for hn_id=${story.hn_id} model=${msgModelId}: ${capacity.reason}, delaying ${delay}s`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'self_throttle', severity: 'info', message: `Self-throttle: ${capacity.reason}`, details: { reason: capacity.reason, delay_seconds: delay, model: msgModelId } });
            msg.retry({ delaySeconds: delay });
            continue;
          }
        }

        // --- Call API ---
        evalStartMs = Date.now();
        let slim: SlimEvalResponse;
        let inputTokens: number;
        let outputTokens: number;

        if (provider === 'openrouter') {
          // --- OpenRouter path ---
          if (!modelDef) {
            throw new Error(`Unknown model in registry: ${msgModelId}`);
          }
          const { response: res } = await callOpenRouterApi(apiKey, modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

          if (!res.ok) {
            const body = await res.text();
            if (res.status === 429) {
              const delaySec = addJitter(60);
              await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `OpenRouter rate limited (429) model=${msgModelId}`, details: { status: 429, delay_seconds: delaySec, model: msgModelId } });
              msg.retry({ delaySeconds: delaySec });
              continue;
            }
            await handleApiFailure(env, db, story, msgModelId, provider, res.status, body);
            throw new Error(`OpenRouter API error ${res.status}: ${body}`);
          }

          const rawData = await res.json() as any;
          const rawText = rawData.choices?.[0]?.message?.content || '';

          inputTokens = rawData.usage?.prompt_tokens ?? 0;
          outputTokens = rawData.usage?.completion_tokens ?? 0;

          // Detect output truncation
          const finishReason = rawData.choices?.[0]?.finish_reason;
          if (finishReason === 'length') {
            console.warn(`[consumer] OpenRouter output truncated for hn_id=${story.hn_id} model=${msgModelId} at ${outputTokens} tokens`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'warn', message: `OpenRouter output truncated at ${outputTokens} tokens`, details: { model: msgModelId, output_tokens: outputTokens, finish_reason: finishReason } });
          }

          // Parse + validate
          try {
            slim = parseOpenRouterResponse(rawData);
          } catch (parseErr) {
            await handleParseFailure(env, db, story, msgModelId, provider, rawText, parseErr, 'full');
            msg.ack();
            continue;
          }

          const validation = validateSlimEvalResponse(slim);
          if (!validation.valid) {
            await handleValidationFailure(env, db, story, msgModelId, provider, rawText, validation, 'full');
            msg.ack();
            continue;
          }

          if (validation.warnings.length > 0 || validation.repairs.length > 0) {
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Validation warnings for model ${msgModelId}: ${validation.warnings.length}W ${validation.repairs.length}R`, details: { model: msgModelId, warnings: validation.warnings, repairs: validation.repairs } });
          }

        } else if (provider === 'workers-ai') {
          // --- Workers AI path ---
          if (!modelDef) {
            throw new Error(`Unknown model in registry: ${msgModelId}`);
          }
          const { text: rawText } = await callWorkersAi(env.AI, modelDef, METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

          inputTokens = 0;
          outputTokens = 0;

          // Parse + validate
          try {
            const extracted = extractJsonFromResponse(rawText);
            slim = JSON.parse(extracted) as SlimEvalResponse;
          } catch (parseErr) {
            await handleParseFailure(env, db, story, msgModelId, provider, rawText, parseErr, 'full');
            msg.ack();
            continue;
          }

          const validation = validateSlimEvalResponse(slim);
          if (!validation.valid) {
            await handleValidationFailure(env, db, story, msgModelId, provider, rawText, validation, 'full');
            msg.ack();
            continue;
          }

          if (validation.warnings.length > 0 || validation.repairs.length > 0) {
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rater_validation_warn', severity: 'info', message: `Validation warnings for model ${msgModelId}: ${validation.warnings.length}W ${validation.repairs.length}R`, details: { model: msgModelId, warnings: validation.warnings, repairs: validation.repairs } });
          }

        } else {
          // --- Anthropic path (existing logic) ---
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: modelToUse,
              max_tokens: modelDef?.max_tokens || EVAL_MAX_TOKENS,
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
              const rlState = await updateRateLimitState(env.CONTENT_CACHE, msgModelId, rlHeaders, true);
              await writeRateLimitSnapshot(db, msgModelId, rlState);

              const retryAfter = res.headers.get('retry-after');
              const baseSec = retryAfter ? parseInt(retryAfter, 10) : 60;
              const delaySec = addJitter(Math.min(Math.max(baseSec, 30), 300));
              console.warn(`[consumer] Rate limited (429) for hn_id=${story.hn_id}. retry-after=${retryAfter ?? 'none'}, delaying ${delaySec}s, consecutive=${rlState.consecutive_429s}`);
              await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `Rate limited (429), retrying in ${delaySec}s`, details: { status: 429, retry_after: retryAfter, delay_seconds: delaySec, consecutive_429s: rlState.consecutive_429s, requests_remaining: rlState.requests_remaining, model: msgModelId } });
              msg.retry({ delaySeconds: delaySec });
              continue;
            }
            if (res.status === 529) {
              const rlHeaders = readRateLimitHeaders(res);
              const rlState = await updateRateLimitState(env.CONTENT_CACHE, msgModelId, rlHeaders, false);
              await writeRateLimitSnapshot(db, msgModelId, rlState);

              const delaySec = addJitter(120);
              await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `API overloaded (529), retrying in ${delaySec}s`, details: { status: 529, delay_seconds: delaySec, model: msgModelId } });
              msg.retry({ delaySeconds: delaySec });
              continue;
            }
            if (res.status === 400 && body.includes('credit balance')) {
              await setCreditPause(env.CONTENT_CACHE, 'anthropic');
              await logEvent(db, { hn_id: story.hn_id, event_type: 'credit_exhausted', severity: 'error', message: `Credit balance too low, pausing provider for 30 min`, details: { status: 400, model: msgModelId } });
              if (isPrimary) {
                await db.prepare(`UPDATE stories SET eval_status = 'pending' WHERE hn_id = ? AND eval_status IN ('queued', 'evaluating')`).bind(story.hn_id).run().catch(() => {});
              }
              msg.ack();
              continue;
            }
            await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'error', message: `Anthropic API error ${res.status}`, details: { status: res.status, body_preview: body.slice(0, 500), model: msgModelId } });
            throw new Error(`Anthropic API error ${res.status}: ${body}`);
          }

          let data = (await res.json()) as {
            content: Array<{ type: string; text?: string }>;
            stop_reason?: string;
            usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
          };

          const usage = data.usage;
          inputTokens = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
          outputTokens = usage?.output_tokens ?? 0;

          // Rate limit header tracking
          const rlHeaders = readRateLimitHeaders(res);
          const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
          const totalInput = inputTokens;
          const cacheHitRate = totalInput > 0 ? cacheReadTokens / totalInput : null;
          const rlState = await updateRateLimitState(env.CONTENT_CACHE, msgModelId, rlHeaders, false, cacheHitRate);
          await writeRateLimitSnapshot(db, msgModelId, rlState);

          console.log(`[consumer] Rate limit headers for hn_id=${story.hn_id}: req=${rlHeaders.requests_remaining}/${rlHeaders.requests_limit} input=${rlHeaders.input_tokens_remaining}/${rlHeaders.input_tokens_limit} output=${rlHeaders.output_tokens_remaining}/${rlHeaders.output_tokens_limit}`);

          // Detect output truncation and retry with extended limit
          if (data.stop_reason === 'max_tokens') {
            console.warn(`[consumer] Output truncated for hn_id=${story.hn_id} at ${data.usage?.output_tokens} tokens, retrying with extended limit`);
            await logEvent(db, {
              hn_id: story.hn_id,
              event_type: 'eval_retry',
              severity: 'warn',
              message: `Output truncated at ${data.usage?.output_tokens} tokens, retrying with ${EVAL_MAX_TOKENS_EXTENDED}`,
              details: { output_tokens: data.usage?.output_tokens, max_tokens: EVAL_MAX_TOKENS, model: msgModelId },
            });

            const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: modelToUse,
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
            const retryRlState = await updateRateLimitState(env.CONTENT_CACHE, msgModelId, retryRlHeaders, false, retryCacheHitRate);
            await writeRateLimitSnapshot(db, msgModelId, retryRlState);

            if (retryData.stop_reason === 'max_tokens') {
              throw new Error(`Output still truncated at ${EVAL_MAX_TOKENS_EXTENDED} tokens for hn_id=${story.hn_id}`);
            }

            data = retryData;
          }

          slim = parseSlimEvalResponse(data);
        }

        // --- Shared post-API processing (both providers) ---

        // Handle DCP "cached" string — substitute from cached DCP
        let dcpForCompute: Record<string, DcpElement> | null = null;
        if (typeof slim.domain_context_profile === 'string') {
          if (cachedDcp) {
            const elements = (cachedDcp as any).elements || cachedDcp;
            slim.domain_context_profile = {
              domain: domain || '',
              eval_date: new Date().toISOString().slice(0, 10),
              elements,
            };
            dcpForCompute = elements as Record<string, DcpElement>;
          } else {
            slim.domain_context_profile = {
              domain: domain || '',
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

        // Write to rater tables (always) — writeRaterEvalResult also writes to stories/scores/fair_witness if primary
        await writeRaterEvalResult(db, story.hn_id, fullResult, msgModelId, provider, promptHash, methodologyHash, inputTokens, outputTokens);

        // For primary model: write methodology hash
        if (isPrimary) {
          try {
            await db
              .prepare(`UPDATE stories SET methodology_hash = ? WHERE hn_id = ?`)
              .bind(methodologyHash, story.hn_id)
              .run();
          } catch { /* column may not exist yet */ }
        }

        // Snapshot content to R2 (primary model only — avoid duplicate snapshots)
        if (isPrimary) {
          try {
            const snapshotKey = `${story.hn_id}/${new Date().toISOString().slice(0, 10)}.txt`;
            await env.CONTENT_SNAPSHOTS.put(snapshotKey, content, {
              customMetadata: {
                hn_id: String(story.hn_id),
                url: evalUrl,
                title: story.title,
                domain: domain || '',
                content_length: String(content.length),
                classification: aggregates.classification,
                weighted_mean: String(aggregates.weighted_mean),
              },
            });
          } catch (err) {
            console.error(`[consumer] R2 snapshot failed (non-fatal): ${err}`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'r2_error', severity: 'warn', message: `R2 snapshot failed`, details: { error: String(err) } });
          }
        }

        // Cache DCP if new (primary model only)
        if (isPrimary) {
          const dcpObj = slim.domain_context_profile as { elements?: Record<string, unknown> };
          if (!cachedDcp && domain && typeof slim.domain_context_profile !== 'string' && dcpObj?.elements) {
            const dcpElements = dcpObj.elements;
            await cacheDcp(db, domain, dcpElements);
            await env.CONTENT_CACHE.put(`dcp:${domain}`, JSON.stringify(dcpElements), {
              expirationTtl: 604800,
            });
          }
        }

        // Update rater health on success (non-primary)
        if (!isPrimary) {
          await handleRaterHealthSuccess(env, db, story, msgModelId);
        }

        const evalDurationMs = Date.now() - evalStartMs;
        console.log(`[consumer] Done: hn_id=${story.hn_id} → ${aggregates.classification} (${aggregates.weighted_mean}) [${msgModelId}] ${evalDurationMs}ms`);
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Evaluated: ${aggregates.classification} (${aggregates.weighted_mean.toFixed(2)})`, details: { classification: aggregates.classification, weighted_mean: aggregates.weighted_mean, model: msgModelId, provider, input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: evalDurationMs } });
        msg.ack();
      } catch (err) {
        const evalDurationMs = Date.now() - evalStartMs;
        console.error(`[consumer] Failed: hn_id=${story.hn_id} model=${msgModelId} (${evalDurationMs}ms):`, err);
        if (isPrimary) {
          await markFailed(db, story.hn_id, `${err}`).catch(() => {});
        }
        await markRaterFailed(db, story.hn_id, msgModelId, provider, `${err}`).catch(() => {});
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_failure', severity: 'error', message: `Evaluation failed: ${String(err).slice(0, 200)}`, details: { error: String(err).slice(0, 500), duration_ms: evalDurationMs, model: msgModelId, provider } });
        msg.retry();
      }
    }
  },
};
