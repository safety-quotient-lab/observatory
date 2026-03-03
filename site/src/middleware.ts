// SPDX-License-Identifier: Apache-2.0
/**
 * Global middleware:
 * 1. Cloudflare Cache API (caches.default) for GET / — homepage is pure aggregate
 *    data with no user state, so the full rendered HTML is cached at each CF PoP
 *    for 5 minutes. Cache hit: Worker returns in ~10ms (no D1 queries).
 * 2. Security headers on all responses (including cache hits, baked in at store time).
 */
import { defineMiddleware } from 'astro:middleware';

const HOMEPAGE_CACHE_TTL = 300; // 5 minutes — matches the staleness budget for aggregates

function applySecurityHeaders(res: Response): void {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
  );
}

export const onRequest = defineMiddleware(async ({ request, locals }, next) => {
  const isHomepage = request.method === 'GET' && new URL(request.url).pathname === '/';

  // ── CDN caching for homepage only ────────────────────────────────────────────
  // caches.default is Cloudflare's Cache API — distinct from Workers KV.
  // Only available in the CF Workers runtime; gracefully skipped in local dev.
  let cache: Cache | undefined;
  if (isHomepage) {
    try { cache = (globalThis as any).caches?.default; } catch { /* local dev */ }
    if (cache) {
      const hit = await cache.match(request);
      if (hit) return hit; // security headers already baked in from original render
    }
  }

  const response = await next();
  applySecurityHeaders(response);

  // ── Cache the homepage response for next request at this PoP ─────────────────
  if (isHomepage && cache && response.ok) {
    const toCache = new Response(response.clone().body, {
      status: response.status,
      headers: new Headers(response.headers), // includes security headers set above
    });
    toCache.headers.set('Cache-Control', `public, s-maxage=${HOMEPAGE_CACHE_TTL}`);
    // Non-blocking: don't delay the current response
    (locals as any).runtime?.ctx?.waitUntil?.(cache.put(request, toCache));
  }

  return response;
});
