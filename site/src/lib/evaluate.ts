/**
 * Shared HRCB evaluation logic.
 * Used by both the API trigger endpoint and the cron worker.
 */

import {
  EVAL_MODEL,
  METHODOLOGY_SYSTEM_PROMPT,
  buildUserMessage,
  parseEvalResponse,
  type EvalResult,
} from './shared-eval';
import { computeWitnessRatio, computeDerivedScoreFields, type DcpElement } from './compute-aggregates';

// Re-export shared primitives for the trigger endpoint
export { fetchUrlContent, writeEvalResult, EVAL_MODEL } from './shared-eval';
export type { EvalResult } from './shared-eval';

export interface EvalCallResult {
  result: EvalResult;
  model: string;
  promptHash: string;
}

async function hashPrompt(system: string, user: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(system + '\n---\n' + user);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Call Claude for evaluation.
 * Supports both URL-fetched content and self-post text (Ask HN, Show HN).
 */
export async function callClaude(
  apiKey: string,
  url: string,
  pageContent: string,
  isSelfPost = false
): Promise<EvalCallResult> {
  const userPrompt = buildUserMessage(url, pageContent, isSelfPost);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      max_tokens: 10240,
      system: [
        {
          type: 'text',
          text: METHODOLOGY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const parsed = parseEvalResponse(data);

  // Compute derived fields (combined, context_modifier, final) on CPU
  const channelWeights = parsed.evaluation.channel_weights;
  const dcpElements = parsed.domain_context_profile?.elements as Record<string, DcpElement> | null;
  parsed.scores = computeDerivedScoreFields(parsed.scores, channelWeights, dcpElements ?? null);

  // Compute witness_ratio per score on CPU
  for (const score of parsed.scores) {
    (score as any).witness_ratio = computeWitnessRatio(score.witness_facts, score.witness_inferences);
  }

  const promptHash = await hashPrompt(METHODOLOGY_SYSTEM_PROMPT, userPrompt);

  return {
    result: parsed,
    model: EVAL_MODEL,
    promptHash,
  };
}
