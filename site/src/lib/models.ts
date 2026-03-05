// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-model registry and helpers.
 */

export type ModelProvider = 'anthropic' | 'openrouter' | 'workers-ai';

export type PromptMode = 'full' | 'lite' | 'lite-v2';

export interface ModelDefinition {
  id: string;                    // DB identifier (eval_model column)
  display_name: string;          // UI label
  short_name: string;            // 3-char badge label
  provider: ModelProvider;
  api_model_id: string;          // sent to API
  is_free: boolean;              // free → auto-eval alongside primary
  enabled: boolean;
  max_tokens: number;
  supports_cache_control: boolean;
  supports_json_mode: boolean;
  prompt_mode: PromptMode;       // 'full' = 31-section eval, 'lite' = aggregate-only
  max_input_chars?: number;      // max content chars to send (truncates before sending)
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    display_name: 'Haiku 4.5',
    short_name: 'Hku',
    provider: 'anthropic',
    api_model_id: 'claude-haiku-4-5-20251001',
    is_free: false,
    enabled: true,
    max_tokens: 10240,
    supports_cache_control: true,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  // --- Active free OpenRouter models ---
  {
    id: 'gpt-oss-120b',
    display_name: 'GPT-OSS 120B',
    short_name: 'GPO',
    provider: 'openrouter',
    api_model_id: 'openai/gpt-oss-120b:free',
    is_free: true,
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'lite',
  },
  {
    id: 'gemma-3-27b',
    display_name: 'Gemma 3 27B',
    short_name: 'Gem',
    provider: 'openrouter',
    api_model_id: 'google/gemma-3-27b-it:free',
    is_free: true,
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'lite',
  },
  {
    id: 'qwen3-coder-480b',
    display_name: 'Qwen3 Coder 480B',
    short_name: 'QwC',
    provider: 'openrouter',
    api_model_id: 'qwen/qwen3-coder:free',
    is_free: true,
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'lite',
  },
  // --- Disabled free OpenRouter models (historical — broken/rate-limited) ---
  {
    id: 'deepseek-v3.2',
    display_name: 'DeepSeek V3.2',
    short_name: 'DS',
    provider: 'openrouter',
    api_model_id: 'deepseek/deepseek-v3.2-20251201',
    is_free: true,
    enabled: false, // disabled: untested since registry overhaul
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'trinity-large',
    display_name: 'Trinity Large',
    short_name: 'Tri',
    provider: 'openrouter',
    api_model_id: 'arcee-ai/trinity-large-preview:free',
    is_free: true,
    enabled: false, // disabled: 77% failure rate
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'nemotron-nano-30b',
    display_name: 'Nemotron Nano 30B',
    short_name: 'Nem',
    provider: 'openrouter',
    api_model_id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    is_free: true,
    enabled: false, // disabled: returns empty/broken JSON
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'lite',
  },
  {
    id: 'step-3.5-flash',
    display_name: 'Step 3.5 Flash',
    short_name: 'Stp',
    provider: 'openrouter',
    api_model_id: 'stepfun/step-3.5-flash:free',
    is_free: true,
    enabled: false, // disabled: 100% failure rate
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  {
    id: 'qwen3-next-80b',
    display_name: 'Qwen3 Next 80B',
    short_name: 'Qwn',
    provider: 'openrouter',
    api_model_id: 'qwen/qwen3-next-80b-a3b-instruct:free',
    is_free: true,
    enabled: false, // disabled: conserving quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'llama-3.3-70b',
    display_name: 'Llama 3.3 70B',
    short_name: 'Lla',
    provider: 'openrouter',
    api_model_id: 'meta-llama/llama-3.3-70b-instruct:free',
    is_free: true,
    enabled: false, // disabled: chronic 429s — use Workers AI variant
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'lite',
  },
  {
    id: 'mistral-small-3.1',
    display_name: 'Mistral Small 3.1',
    short_name: 'Mis',
    provider: 'openrouter',
    api_model_id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    is_free: true,
    enabled: false, // disabled: conserving quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'hermes-3-405b',
    display_name: 'Hermes 3 405B',
    short_name: 'Her',
    provider: 'openrouter',
    api_model_id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    is_free: true,
    enabled: false, // disabled: conserving quota
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'llama-3.3-70b-wai',
    display_name: 'Llama 3.3 70B (WAI)',
    short_name: 'L3W',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    is_free: true,
    enabled: false, // superseded by llama-3.3-70b-wai-psq (lite-v2)
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite',
    max_input_chars: 6000,
  },
  {
    id: 'llama-4-scout-wai',
    display_name: 'Llama 4 Scout (WAI)',
    short_name: 'L4S',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    is_free: true,
    enabled: false, // superseded by llama-4-scout-wai-psq (lite-v2)
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite',
    max_input_chars: 12000,
  },
  {
    id: 'qwen3-30b-a3b-wai',
    display_name: 'Qwen3 30B A3B (WAI)',
    short_name: 'Q3W',
    provider: 'workers-ai',
    api_model_id: '@cf/qwen/qwen3-30b-a3b-fp8',
    is_free: false, // paid model ($0.051/M input) — was incorrectly marked free
    enabled: false, // superseded by qwen3-30b-a3b-wai-psq (lite-v2)
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite',
    max_input_chars: 8000,
  },
  // PSQ models — same LLMs, lite-v2 prompt (3-dim PSQ: threat_exposure, trust_conditions, resilience_baseline)
  {
    id: 'llama-3.3-70b-wai-psq',
    display_name: 'Llama 3.3 70B PSQ (WAI)',
    short_name: 'L3P',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    is_free: true,
    enabled: true,
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite-v2',
    max_input_chars: 6000,
  },
  {
    id: 'llama-4-scout-wai-psq',
    display_name: 'Llama 4 Scout PSQ (WAI)',
    short_name: 'L4P',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    is_free: true,
    enabled: true,
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite-v2',
    max_input_chars: 12000,
  },
  {
    id: 'qwen3-30b-a3b-wai-psq',
    display_name: 'Qwen3 30B A3B PSQ (WAI)',
    short_name: 'Q3P',
    provider: 'workers-ai',
    api_model_id: '@cf/qwen/qwen3-30b-a3b-fp8',
    is_free: false, // paid model ($0.051/M input) — was incorrectly marked free
    enabled: false, // enable after PSQ pipeline proven in production
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'lite-v2',
    max_input_chars: 8000,
  },
];

export const PRIMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

/**
 * DB-backed primary model lookup. Queries model_registry for is_primary=1.
 * Falls back to static PRIMARY_MODEL_ID on error or missing row.
 */
export async function getPrimaryModelId(db: D1Database): Promise<string> {
  try {
    const row = await db
      .prepare(`SELECT model_id FROM model_registry WHERE is_primary = 1 LIMIT 1`)
      .first<{ model_id: string }>();
    return row?.model_id ?? PRIMARY_MODEL_ID;
  } catch {
    return PRIMARY_MODEL_ID;
  }
}

export function getModelDef(modelId: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId);
}

export function getEnabledModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled);
}

export function getEnabledFreeModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled && m.is_free);
}

/** All free models regardless of enabled status — used for front-page priority dispatch. */
export function getAllFreeModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.is_free);
}

/**
 * DB-backed enabled model list. Intersects model_registry table (enabled=1)
 * with MODEL_REGISTRY definitions. Falls back to static getEnabledModels() on error.
 */
export async function getEnabledModelsFromDb(db: D1Database): Promise<ModelDefinition[]> {
  try {
    const { results } = await db
      .prepare(`SELECT model_id FROM model_registry WHERE enabled = 1`)
      .all<{ model_id: string }>();
    const enabledIds = new Set(results.map(r => r.model_id));
    return MODEL_REGISTRY.filter(m => enabledIds.has(m.id));
  } catch {
    // DB unavailable or table missing — fall back to static registry
    return getEnabledModels();
  }
}

export function modelDisplayName(modelId: string): string {
  return getModelDef(modelId)?.api_model_id ?? modelId;
}

export function modelShortName(modelId: string): string {
  return getModelDef(modelId)?.short_name ?? modelId.slice(0, 3);
}

/** Returns true if the model (or eval row) used any lite prompt mode (lite or lite-v2). */
export function isLiteMode(promptModeOrModelId: string | null | undefined): boolean {
  if (promptModeOrModelId === 'lite') return true;
  if (promptModeOrModelId === 'lite-v2') return true;
  // Also accept legacy 'light' value for backward compat during transition
  if (promptModeOrModelId === 'light') return true;
  // Check registry definition as fallback
  const def = getModelDef(promptModeOrModelId ?? '');
  return def?.prompt_mode === 'lite' || def?.prompt_mode === 'lite-v2';
}

/** Returns true if the model (or eval row) used the PSQ-based lite-v2 prompt mode. */
export function isLiteV2Mode(promptModeOrModelId: string | null | undefined): boolean {
  if (promptModeOrModelId === 'lite-v2') return true;
  const def = getModelDef(promptModeOrModelId ?? '');
  return def?.prompt_mode === 'lite-v2';
}

/** Map model IDs to their queue binding names in wrangler config. */
export const MODEL_QUEUE_BINDINGS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'EVAL_QUEUE',
  'gpt-oss-120b': 'GPT_OSS_QUEUE',
  'gemma-3-27b': 'GEMMA_QUEUE',
  'qwen3-coder-480b': 'QWEN_CODER_QUEUE',
  'deepseek-v3.2': 'DEEPSEEK_QUEUE',
  'trinity-large': 'TRINITY_QUEUE',
  'nemotron-nano-30b': 'NEMOTRON_QUEUE',
  'step-3.5-flash': 'STEP_QUEUE',
  'qwen3-next-80b': 'QWEN_QUEUE',
  'llama-3.3-70b': 'LLAMA_QUEUE',
  'mistral-small-3.1': 'MISTRAL_QUEUE',
  'hermes-3-405b': 'HERMES_QUEUE',
  'llama-3.3-70b-wai': 'WORKERS_AI_QUEUE',
  'llama-4-scout-wai': 'WORKERS_AI_QUEUE',
  'qwen3-30b-a3b-wai': 'WORKERS_AI_QUEUE',
  'llama-3.3-70b-wai-psq': 'WORKERS_AI_QUEUE',
  'llama-4-scout-wai-psq': 'WORKERS_AI_QUEUE',
  'qwen3-30b-a3b-wai-psq': 'WORKERS_AI_QUEUE',
};

/** Get the queue for a given model from the env bindings. Falls back to EVAL_QUEUE. */
export function getModelQueue(modelId: string, env: Record<string, any>): Queue {
  const binding = MODEL_QUEUE_BINDINGS[modelId] || 'EVAL_QUEUE';
  return env[binding] as Queue;
}

/** Derived queue configuration for system observability. */
export const QUEUE_CONFIG = MODEL_REGISTRY
  .filter(m => m.enabled)
  .map(m => ({
    bindingKey: MODEL_QUEUE_BINDINGS[m.id] ?? 'EVAL_QUEUE',
    model: m.id,
    shortName: m.short_name,
    consumer: `consumer-${m.provider}`,
    provider: m.provider,
    promptMode: m.prompt_mode,
  }));
