// SPDX-License-Identifier: Apache-2.0
/**
 * Global middleware: security headers on all responses.
 * NOTE: caches.default (CF Cache API) caused "Can't modify immutable headers"
 * in Astro's SSR adapter when returning cached Responses — removed 2026-03-03.
 * TODO: investigate CF Pages-specific caching approach (e.g., CF Cache Rules).
 */
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
  );

  return response;
});
