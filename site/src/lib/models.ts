/**
 * Multi-model registry and helpers.
 */

export type ModelProvider = 'anthropic' | 'openrouter' | 'workers-ai';

export type PromptMode = 'full' | 'light';

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
  prompt_mode: PromptMode;       // 'full' = 31-section eval, 'light' = aggregate-only
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
  {
    id: 'deepseek-v3.2',
    display_name: 'DeepSeek V3.2',
    short_name: 'DS',
    provider: 'openrouter',
    api_model_id: 'deepseek/deepseek-v3.2-20251201',
    is_free: true,
    enabled: true,
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
    enabled: true,   // re-enabled with light prompt mode (97% fail on full)
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'light',
  },
  {
    id: 'step-3.5-flash',
    display_name: 'Step 3.5 Flash',
    short_name: 'Stp',
    provider: 'openrouter',
    api_model_id: 'stepfun/step-3.5-flash:free',
    is_free: true,
    enabled: false,  // disabled: returns empty responses, 100% failure rate
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
    enabled: false, // disabled: conserving free tier quota
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
    enabled: true,
    max_tokens: 8192,
    supports_cache_control: false,
    supports_json_mode: true,
    prompt_mode: 'full',
  },
  {
    id: 'mistral-small-3.1',
    display_name: 'Mistral Small 3.1',
    short_name: 'Mis',
    provider: 'openrouter',
    api_model_id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    is_free: true,
    enabled: false, // disabled: conserving free tier quota
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
    enabled: false, // disabled: conserving free tier quota
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
    enabled: false, // disabled: not ready for production yet, pending testing
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'full',
  },
  {
    id: 'llama-4-scout-wai',
    display_name: 'Llama 4 Scout (WAI)',
    short_name: 'L4S',
    provider: 'workers-ai',
    api_model_id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    is_free: true,
    enabled: true,
    max_tokens: 16384,
    supports_cache_control: false,
    supports_json_mode: false,
    prompt_mode: 'light',
  },
];

export const PRIMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

export function getModelDef(modelId: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId);
}

export function getEnabledModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled);
}

export function getEnabledFreeModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.enabled && m.is_free);
}

export function modelDisplayName(modelId: string): string {
  return getModelDef(modelId)?.api_model_id ?? modelId;
}

export function modelShortName(modelId: string): string {
  return getModelDef(modelId)?.short_name ?? modelId.slice(0, 3);
}

/** Map model IDs to their queue binding names in wrangler config. */
export const MODEL_QUEUE_BINDINGS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'EVAL_QUEUE',
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
};

/** Get the queue for a given model from the env bindings. Falls back to EVAL_QUEUE. */
export function getModelQueue(modelId: string, env: Record<string, any>): Queue {
  const binding = MODEL_QUEUE_BINDINGS[modelId] || 'EVAL_QUEUE';
  return env[binding] as Queue;
}
