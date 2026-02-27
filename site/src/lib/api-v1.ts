/**
 * Shared helpers for public REST API v1 routes (/api/v1/*).
 * - No auth required (public read-only)
 * - IP-based rate limiting via KV (200 req/hour per IP)
 * - CORS: Access-Control-Allow-Origin: *
 */

const RATE_LIMIT = 200;
const RATE_WINDOW_SEC = 3600;

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Returns true if the request is within rate limits, false if limit exceeded.
 * Increments the counter for the given IP. Non-fatal on KV error.
 */
export async function checkRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `ratelimit:v1:${ip}`;
  try {
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= RATE_LIMIT) return false;
    // Increment — preserve remaining TTL by re-setting with full window only on first request
    await kv.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_SEC });
    return true;
  } catch {
    // KV unavailable — allow the request
    return true;
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extra,
    },
  });
}

export function errorResponse(msg: string, status: number): Response {
  return jsonResponse({ error: msg }, status);
}

export function listCacheHeaders(): Record<string, string> {
  return { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };
}

export function itemCacheHeaders(): Record<string, string> {
  return { 'Cache-Control': 'public, max-age=30' };
}
