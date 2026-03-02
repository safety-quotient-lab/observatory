// SPDX-License-Identifier: Apache-2.0
// --- Rate Limit State ---

export interface RateLimitState {
  requests_remaining: number | null;
  requests_limit: number | null;
  input_tokens_remaining: number | null;
  input_tokens_limit: number | null;
  output_tokens_remaining: number | null;
  output_tokens_limit: number | null;
  requests_reset: string | null;
  tokens_reset: string | null;
  consecutive_429s: number;
  cache_hit_rate: number | null;
  updated_at: string;
}

export interface RateLimitHeaders {
  requests_remaining: number | null;
  requests_limit: number | null;
  input_tokens_remaining: number | null;
  input_tokens_limit: number | null;
  output_tokens_remaining: number | null;
  output_tokens_limit: number | null;
  requests_reset: string | null;
  tokens_reset: string | null;
}

export function readRateLimitHeaders(res: Response): RateLimitHeaders {
  const getInt = (name: string) => {
    const v = res.headers.get(name);
    return v !== null ? parseInt(v, 10) : null;
  };
  return {
    requests_remaining: getInt('anthropic-ratelimit-requests-remaining'),
    requests_limit: getInt('anthropic-ratelimit-requests-limit'),
    input_tokens_remaining: getInt('anthropic-ratelimit-input-tokens-remaining'),
    input_tokens_limit: getInt('anthropic-ratelimit-input-tokens-limit'),
    output_tokens_remaining: getInt('anthropic-ratelimit-output-tokens-remaining'),
    output_tokens_limit: getInt('anthropic-ratelimit-output-tokens-limit'),
    requests_reset: res.headers.get('anthropic-ratelimit-requests-reset'),
    tokens_reset: res.headers.get('anthropic-ratelimit-tokens-reset'),
  };
}

export async function updateRateLimitState(
  kv: KVNamespace,
  model: string,
  headers: RateLimitHeaders,
  is429: boolean,
  cacheHitRate?: number | null,
): Promise<RateLimitState> {
  const key = `ratelimit:${model}`;
  let existing: RateLimitState | null = null;
  try {
    existing = await kv.get(key, 'json') as RateLimitState | null;
  } catch { /* KV miss */ }

  const now = new Date().toISOString();
  const prevConsecutive = existing?.consecutive_429s ?? 0;

  // Exponential moving average for cache hit rate (alpha = 0.3)
  let newCacheHitRate = existing?.cache_hit_rate ?? null;
  if (cacheHitRate != null) {
    newCacheHitRate = newCacheHitRate != null
      ? newCacheHitRate * 0.7 + cacheHitRate * 0.3
      : cacheHitRate;
  }

  const state: RateLimitState = {
    requests_remaining: headers.requests_remaining ?? existing?.requests_remaining ?? null,
    requests_limit: headers.requests_limit ?? existing?.requests_limit ?? null,
    input_tokens_remaining: headers.input_tokens_remaining ?? existing?.input_tokens_remaining ?? null,
    input_tokens_limit: headers.input_tokens_limit ?? existing?.input_tokens_limit ?? null,
    output_tokens_remaining: headers.output_tokens_remaining ?? existing?.output_tokens_remaining ?? null,
    output_tokens_limit: headers.output_tokens_limit ?? existing?.output_tokens_limit ?? null,
    requests_reset: headers.requests_reset ?? existing?.requests_reset ?? null,
    tokens_reset: headers.tokens_reset ?? existing?.tokens_reset ?? null,
    consecutive_429s: is429 ? prevConsecutive + 1 : 0,
    cache_hit_rate: newCacheHitRate,
    updated_at: now,
  };

  try {
    await kv.put(key, JSON.stringify(state), { expirationTtl: 600 });
  } catch (err) {
    console.error(`[consumer] KV ratelimit write failed: ${err}`);
  }

  return state;
}

export async function writeRateLimitSnapshot(
  db: D1Database,
  model: string,
  state: RateLimitState,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO ratelimit_snapshots (model, requests_remaining, requests_limit, input_tokens_remaining, input_tokens_limit, output_tokens_remaining, output_tokens_limit, cache_hit_rate, consecutive_429s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        model,
        state.requests_remaining,
        state.requests_limit,
        state.input_tokens_remaining,
        state.input_tokens_limit,
        state.output_tokens_remaining,
        state.output_tokens_limit,
        state.cache_hit_rate,
        state.consecutive_429s,
      )
      .run();

    // Prune: keep only latest 100 rows per model
    await db
      .prepare(
        `DELETE FROM ratelimit_snapshots WHERE model = ? AND id NOT IN (
           SELECT id FROM ratelimit_snapshots WHERE model = ? ORDER BY created_at DESC LIMIT 100
         )`
      )
      .bind(model, model)
      .run();
  } catch (err) {
    // Non-throwing — table may not exist yet
    console.error(`[consumer] D1 ratelimit snapshot failed: ${err}`);
  }
}

export interface CapacityResult {
  ok: boolean;
  delaySeconds?: number;
  reason?: string;
}

export function secondsUntilReset(resetTime: string | null): number {
  if (!resetTime) return 30;
  try {
    const resetMs = new Date(resetTime).getTime();
    const nowMs = Date.now();
    return Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
  } catch {
    return 30;
  }
}

export async function checkCreditPause(kv: KVNamespace, provider: string): Promise<boolean> {
  try {
    const v = await kv.get(`credit_pause:${provider}`);
    return v !== null;
  } catch { return false; }
}

export async function setCreditPause(kv: KVNamespace, provider: string): Promise<void> {
  try {
    await kv.put(`credit_pause:${provider}`, new Date().toISOString(), { expirationTtl: 1800 }); // 30 min
  } catch {}
}

export async function checkRateLimitCapacity(kv: KVNamespace, model: string, maxBackoffSec = 120): Promise<CapacityResult> {
  const key = `ratelimit:${model}`;
  let state: RateLimitState | null = null;
  try {
    state = await kv.get(key, 'json') as RateLimitState | null;
  } catch { /* KV miss */ }

  // No data — don't block
  if (!state) return { ok: true };

  // Circuit breaker: 3+ consecutive 429s → wait for reset
  if (state.consecutive_429s >= 3) {
    const delay = Math.min(Math.max(secondsUntilReset(state.requests_reset), 10), maxBackoffSec);
    return { ok: false, delaySeconds: delay, reason: `circuit-breaker: ${state.consecutive_429s} consecutive 429s` };
  }

  // Low request capacity
  if (state.requests_remaining !== null && state.requests_remaining < 3) {
    const delay = Math.min(Math.max(secondsUntilReset(state.requests_reset), 5), Math.min(60, maxBackoffSec));
    return { ok: false, delaySeconds: delay, reason: `low requests remaining: ${state.requests_remaining}` };
  }

  // Low input token capacity (<10% of limit)
  if (state.input_tokens_remaining !== null && state.input_tokens_limit !== null && state.input_tokens_limit > 0) {
    if (state.input_tokens_remaining < state.input_tokens_limit * 0.1) {
      const delay = Math.min(Math.max(secondsUntilReset(state.tokens_reset), 5), Math.min(60, maxBackoffSec));
      return { ok: false, delaySeconds: delay, reason: `low input tokens: ${state.input_tokens_remaining}/${state.input_tokens_limit}` };
    }
  }

  // Low output token capacity (<10% of limit)
  if (state.output_tokens_remaining !== null && state.output_tokens_limit !== null && state.output_tokens_limit > 0) {
    if (state.output_tokens_remaining < state.output_tokens_limit * 0.1) {
      const delay = Math.min(Math.max(secondsUntilReset(state.tokens_reset), 5), Math.min(60, maxBackoffSec));
      return { ok: false, delaySeconds: delay, reason: `low output tokens: ${state.output_tokens_remaining}/${state.output_tokens_limit}` };
    }
  }

  // Ramp-up guard: if no recent 429s but state is stale (>60s), add small delay
  if (state.consecutive_429s === 0 && state.updated_at) {
    const staleSec = (Date.now() - new Date(state.updated_at).getTime()) / 1000;
    if (staleSec > 60) {
      return { ok: false, delaySeconds: 3, reason: `ramp-up guard: state ${Math.round(staleSec)}s stale` };
    }
  }

  return { ok: true };
}

export function addJitter(delaySec: number): number {
  return Math.round(delaySec * (0.8 + Math.random() * 0.4));
}
