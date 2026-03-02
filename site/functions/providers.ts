// SPDX-License-Identifier: Apache-2.0
import type { ModelDefinition } from '../src/lib/shared-eval';

export async function callAnthropicApi(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  supportsCacheControl: boolean,
): Promise<{ response: Response; data: any }> {
  const system = supportsCacheControl
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });
    return { response: res, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callOpenRouterApi(
  apiKey: string,
  modelDef: ModelDefinition,
  systemPrompt: string,
  userMessage: string,
): Promise<{ response: Response; data: any }> {
  const body: Record<string, unknown> = {
    model: modelDef.api_model_id,
    max_tokens: modelDef.max_tokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };
  if (modelDef.supports_json_mode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://hn-hrcb.pages.dev',
        'X-Title': 'HN HRCB Evaluator',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { response: res, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callWorkersAi(
  ai: any,
  modelDef: ModelDefinition,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string }> {
  const result = await ai.run(modelDef.api_model_id, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: modelDef.max_tokens,
    temperature: 0.0,
  });
  // Workers AI text generation returns { response: "..." } or { response: {...} }
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else if (result && typeof result.response === 'string') {
    text = result.response;
  } else if (result && typeof result.response === 'object' && result.response !== null) {
    // Some models return parsed JSON object directly instead of string
    text = JSON.stringify(result.response);
  } else {
    // Unexpected format — stringify for debugging
    text = JSON.stringify(result) || '';
    console.warn(`[consumer] Workers AI unexpected result format: ${text.slice(0, 200)}`);
  }
  if (!text) {
    throw new Error('Workers AI returned empty response');
  }
  return { text };
}
