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
 * - Acks on success, retries on failure (max 2 retries → DLQ)
 */

import {
  EVAL_MODEL,
  EVAL_MAX_TOKENS,
  CONTENT_MAX_CHARS,
  METHODOLOGY_SYSTEM_PROMPT_SLIM,
  extractDomain,
  buildUserMessageWithDcp,
  parseSlimEvalResponse,
  fetchUrlContent,
  writeEvalResult,
  markFailed,
  markSkipped,
  getCachedDcp,
  cacheDcp,
  type EvalResult,
} from '../src/lib/shared-eval';

import { computeAggregates, computeWitnessRatio, computeDerivedScoreFields, type DcpElement } from '../src/lib/compute-aggregates';
import { cleanHtml } from '../src/lib/html-clean';
import { logEvent } from '../src/lib/events';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  CONTENT_CACHE: KVNamespace;
  CONTENT_SNAPSHOTS: R2Bucket;
  EVAL_MODEL_OVERRIDE?: string; // Override default model (e.g., 'claude-sonnet-4-5-20250514')
}

interface QueueMessage {
  hn_id: number;
  url: string | null;
  title: string;
  hn_text: string | null;
  domain: string | null;
}

async function hashPrompt(system: string, user: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(system + '\n---\n' + user);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    const db = env.DB;
    const apiKey = env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      // Retry all — config issue
      for (const msg of batch.messages) msg.retry();
      return;
    }

    for (const msg of batch.messages) {
      const story = msg.body;
      console.log(`[consumer] Processing hn_id=${story.hn_id}: ${story.title}`);
      let evalStartMs = Date.now();

      try {
        const isSelfPost = !story.url && !!story.hn_text;
        const evalUrl = story.url || `https://news.ycombinator.com/item?id=${story.hn_id}`;

        // Skip binary content
        if (story.url && /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|iso|mp4|mp3|wav|avi|mov)(\?|$)/i.test(story.url)) {
          await markSkipped(db, story.hn_id, 'Binary/unsupported content type');
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: binary/unsupported content type`, details: { reason: 'binary', url: story.url } });
          msg.ack();
          continue;
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
            content = cleanHtml(rawHtml, CONTENT_MAX_CHARS);
          }
        }

        if (content.length < 50) {
          await markSkipped(db, story.hn_id, 'Content too short');
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_skip', severity: 'info', message: `Skipped: content too short (${content.length} chars)`, details: { reason: 'too_short', content_length: content.length } });
          msg.ack();
          continue;
        }

        // Look up cached DCP for domain (KV first, then D1 fallback)
        const domain = story.domain || (story.url ? extractDomain(story.url) : null);
        let cachedDcp: Record<string, unknown> | null = null;
        if (domain) {
          const kvDcp = await env.CONTENT_CACHE.get(`dcp:${domain}`, 'json');
          if (kvDcp) {
            cachedDcp = kvDcp as Record<string, unknown>;
            console.log(`[consumer] DCP KV cache hit for ${domain}`);
          } else {
            cachedDcp = await getCachedDcp(db, domain);
          }
        }

        // Build user message with optional cached DCP
        const userMessage = buildUserMessageWithDcp(evalUrl, content, isSelfPost, cachedDcp);
        const promptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT_SLIM, userMessage);

        // Call Claude API (slim prompt — no aggregates)
        const modelToUse = env.EVAL_MODEL_OVERRIDE || EVAL_MODEL;
        evalStartMs = Date.now();
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: EVAL_MAX_TOKENS,
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
            // Rate limited — retry with delay instead of burning retries
            const retryAfter = res.headers.get('retry-after');
            const delaySec = retryAfter ? parseInt(retryAfter, 10) : 60;
            console.warn(`[consumer] Rate limited (429) for hn_id=${story.hn_id}. retry-after=${retryAfter ?? 'none'}, delaying ${delaySec}s`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `Rate limited (429), retrying in ${delaySec}s`, details: { status: 429, retry_after: retryAfter, delay_seconds: Math.min(Math.max(delaySec, 30), 300) } });
            msg.retry({ delaySeconds: Math.min(Math.max(delaySec, 30), 300) });
            continue;
          }
          if (res.status === 529) {
            // API overloaded — retry with longer delay
            console.warn(`[consumer] API overloaded (529) for hn_id=${story.hn_id}, delaying 120s`);
            await logEvent(db, { hn_id: story.hn_id, event_type: 'rate_limit', severity: 'warn', message: `API overloaded (529), retrying in 120s`, details: { status: 529, delay_seconds: 120 } });
            msg.retry({ delaySeconds: 120 });
            continue;
          }
          await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_retry', severity: 'error', message: `Anthropic API error ${res.status}`, details: { status: res.status, body_preview: body.slice(0, 500) } });
          throw new Error(`Anthropic API error ${res.status}: ${body}`);
        }

        const data = (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
        };

        // Extract token usage for cost tracking
        const usage = data.usage;
        const inputTokens = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
        const outputTokens = usage?.output_tokens ?? 0;

        // Parse slim response (no aggregates)
        const slim = parseSlimEvalResponse(data);

        // Handle DCP "cached" string — substitute from cached DCP
        let dcpForCompute: Record<string, DcpElement> | null = null;
        if (typeof slim.domain_context_profile === 'string') {
          // LLM output "cached" — restore from cached DCP
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

        // Compute derived fields (combined, context_modifier, final) on Worker CPU
        const channelWeights = slim.evaluation.channel_weights;
        const derivedScores = computeDerivedScoreFields(slim.scores, channelWeights, dcpForCompute);

        // Compute witness_ratio per score on Worker CPU
        for (const score of derivedScores) {
          (score as any).witness_ratio = computeWitnessRatio(score.witness_facts, score.witness_inferences);
        }

        // Compute aggregates on Worker CPU
        const aggregates = computeAggregates(derivedScores, channelWeights);

        // Assemble full EvalResult
        const fullResult: EvalResult = {
          ...slim,
          domain_context_profile: slim.domain_context_profile as { domain: string; eval_date: string; elements: Record<string, unknown> },
          scores: derivedScores,
          aggregates,
        };

        // Write to D1
        await writeEvalResult(db, story.hn_id, fullResult, modelToUse, promptHash);

        // Also write to eval_history for multi-model comparison + cost tracking
        await db
          .prepare(
            `INSERT INTO eval_history (hn_id, eval_model, hcb_weighted_mean, hcb_classification, hcb_json, input_tokens, output_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            story.hn_id,
            modelToUse,
            aggregates.weighted_mean,
            aggregates.classification,
            JSON.stringify(fullResult),
            inputTokens,
            outputTokens
          )
          .run();

        // Snapshot content to R2 for audit trail / re-evaluation
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

        // Cache DCP if we got a new one (not from cache)
        const dcpObj = slim.domain_context_profile as { elements?: Record<string, unknown> };
        if (!cachedDcp && domain && typeof slim.domain_context_profile !== 'string' && dcpObj?.elements) {
          const dcpElements = dcpObj.elements;
          await cacheDcp(db, domain, dcpElements);
          // Also cache in KV with 7-day TTL
          await env.CONTENT_CACHE.put(`dcp:${domain}`, JSON.stringify(dcpElements), {
            expirationTtl: 604800, // 7 days
          });
        }

        const evalDurationMs = Date.now() - evalStartMs;
        console.log(`[consumer] Done: hn_id=${story.hn_id} → ${aggregates.classification} (${aggregates.weighted_mean}) [${modelToUse}] ${evalDurationMs}ms`);
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_success', severity: 'info', message: `Evaluated: ${aggregates.classification} (${aggregates.weighted_mean.toFixed(2)})`, details: { classification: aggregates.classification, weighted_mean: aggregates.weighted_mean, model: modelToUse, input_tokens: inputTokens, output_tokens: outputTokens, duration_ms: evalDurationMs } });
        msg.ack();
      } catch (err) {
        const evalDurationMs = Date.now() - evalStartMs;
        console.error(`[consumer] Failed: hn_id=${story.hn_id} (${evalDurationMs}ms):`, err);
        await markFailed(db, story.hn_id, `${err}`).catch(() => {});
        await logEvent(db, { hn_id: story.hn_id, event_type: 'eval_failure', severity: 'error', message: `Evaluation failed: ${String(err).slice(0, 200)}`, details: { error: String(err).slice(0, 500), duration_ms: evalDurationMs } });
        msg.retry();
      }
    }
  },
};
