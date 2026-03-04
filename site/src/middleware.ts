// SPDX-License-Identifier: Apache-2.0
/**
 * Global middleware: security headers on all responses.
 * NOTE: caches.default (CF Cache API) caused "Can't modify immutable headers"
 * in Astro's SSR adapter when returning cached Responses — removed 2026-03-03.
 * Edge caching handled via CF Cache Rules (dashboard config, not code).
 */
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  // RFC 8288: feed autodiscovery via HTTP Link header (complements <link> in HTML)
  const ct = response.headers.get('Content-Type') ?? '';
  if (ct.includes('text/html')) {
    response.headers.append(
      'Link',
      '<https://observatory.unratified.org/feed.xml>; rel="alternate"; type="application/atom+xml"; title="HRO Feed"',
    );
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none';"
  );

  return response;
});
