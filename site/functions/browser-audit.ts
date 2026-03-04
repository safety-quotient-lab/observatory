// SPDX-License-Identifier: Apache-2.0
/**
 * Browser Audit Worker: headless Chromium via CF Browser Rendering.
 *
 * Consumes { domain } messages from hrcb-browser-audit queue.
 * Launches Puppeteer, navigates to https://{domain}, extracts:
 *   - Tracking signals (3rd-party request domains)
 *   - Security signals (HTTPS, HSTS, CSP headers)
 *   - Accessibility signals (lang attr, skip-nav, alt text)
 *   - Consent signals (cookie banner detection, dark patterns)
 *
 * Writes results to domain_browser_audit table and merges br_*
 * DCP elements into KV cache.
 */

import puppeteer from '@cloudflare/puppeteer';
import { logEvent } from '../src/lib/events';
import { writeDb } from '../src/lib/db-utils';
import { getCachedDcp, cacheDcp } from '../src/lib/eval-write';
import type { DcpElement } from '../src/lib/compute-aggregates';

// --- Types ---

interface AuditMessage {
  domain: string;
}

interface Env {
  BROWSER: Fetcher;
  DB: D1Database;
  CONTENT_CACHE: KVNamespace;
}

// Known tracker domains (prefix match)
const TRACKER_PREFIXES = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'googlesyndication.com', 'googleadservices.com', 'google.com/pagead',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'analytics.twitter.com', 'ads-twitter.com',
  'bat.bing.com', 'clarity.ms',
  'hotjar.com', 'mouseflow.com', 'crazyegg.com',
  'segment.io', 'segment.com', 'cdn.segment.com',
  'mixpanel.com', 'amplitude.com', 'heap.io', 'heapanalytics.com',
  'newrelic.com', 'nr-data.net',
  'quantserve.com', 'scorecardresearch.com', 'chartbeat.com',
  'adnxs.com', 'criteo.com', 'outbrain.com', 'taboola.com',
  'linkedin.com/px', 'snap.licdn.com',
  'tiktok.com/i18n/pixel', 'analytics.tiktok.com',
  'hubspot.com', 'hs-analytics.net', 'hsforms.com',
  'intercom.io', 'intercomcdn.com',
  'optimizely.com', 'cdn.optimizely.com',
  'fullstory.com', 'rs.fullstory.com',
  'sentry.io', 'sentry-cdn.com',
];

// Fingerprinting API names to check
const FINGERPRINT_APIS = [
  'HTMLCanvasElement.prototype.toDataURL',
  'HTMLCanvasElement.prototype.toBlob',
  'HTMLCanvasElement.prototype.getContext',
  'WebGLRenderingContext.prototype.getParameter',
  'WebGL2RenderingContext.prototype.getParameter',
  'AudioContext.prototype.createOscillator',
  'navigator.getBattery',
];

// Cookie banner selectors (common patterns)
const COOKIE_BANNER_SELECTORS = [
  '#cookie-banner', '#cookie-consent', '#cookie-notice', '#cookie-popup',
  '#cookiebanner', '#cookies-banner', '#consent-banner',
  '.cookie-banner', '.cookie-consent', '.cookie-notice', '.cookie-popup',
  '.cookiebanner', '.cookies-banner', '.consent-banner',
  '[class*="cookie-banner"]', '[class*="cookie-consent"]',
  '[class*="CookieBanner"]', '[class*="CookieConsent"]',
  '[id*="onetrust"]', '[class*="onetrust"]',
  '[id*="cookiebot"]', '[class*="cookiebot"]',
  '[id*="gdpr"]', '[class*="gdpr"]',
  '[id*="CybotCookiebot"]',
  '[data-testid="cookie-banner"]',
  '[aria-label*="cookie"]', '[aria-label*="consent"]',
];

// --- Audit Logic ---

interface AuditResult {
  tracker_count: number;
  tracker_domains: string[];
  fingerprint_apis: string[];
  has_https: boolean;
  has_hsts: boolean;
  has_csp: boolean;
  csp_value: string | null;
  has_lang_attr: boolean;
  has_skip_nav: boolean;
  images_without_alt: number;
  total_images: number;
  has_cookie_banner: boolean;
  cookie_banner_dismissable: boolean;
  dark_pattern_flags: string[];
  request_domains: string[];
  audit_duration_ms: number;
  audit_error: string | null;
}

function isTrackerDomain(hostname: string): boolean {
  return TRACKER_PREFIXES.some(prefix => hostname === prefix || hostname.endsWith('.' + prefix));
}

async function auditDomain(env: Env, domain: string): Promise<AuditResult> {
  const startMs = Date.now();
  const requestDomains = new Set<string>();
  const trackerDomains = new Set<string>();

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    // Set a realistic viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Collect network requests via CDP
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    client.on('Network.requestWillBeSent', (event: { request: { url: string } }) => {
      try {
        const url = new URL(event.request.url);
        const host = url.hostname;
        requestDomains.add(host);
        if (host !== domain && !host.endsWith('.' + domain)) {
          if (isTrackerDomain(host)) {
            trackerDomains.add(host);
          }
        }
      } catch { /* invalid URL */ }
    });

    // Navigate with timeout
    let responseHeaders: Record<string, string> = {};
    const response = await page.goto(`https://${domain}`, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });

    if (response) {
      const headers = response.headers();
      responseHeaders = headers;
    }

    // Security signals from response headers
    const hasHttps = true; // we navigated to https://
    const hasHsts = !!responseHeaders['strict-transport-security'];
    const hasCsp = !!responseHeaders['content-security-policy'];
    const cspValue = responseHeaders['content-security-policy'] || null;

    // Accessibility + consent signals via page.evaluate
    const pageSignals = await page.evaluate((cookieSelectors: string[], fingerprintApis: string[]) => {
      // Accessibility
      const htmlEl = document.documentElement;
      const hasLang = !!htmlEl.getAttribute('lang');
      const skipNavLinks = document.querySelectorAll(
        'a[href^="#main"], a[href^="#content"], a.skip-nav, a.skip-link, [class*="skip-nav"], [class*="skip-link"], a[href="#skip"]'
      );
      const hasSkipNav = skipNavLinks.length > 0;
      const allImages = document.querySelectorAll('img');
      const totalImages = allImages.length;
      let imagesWithoutAlt = 0;
      allImages.forEach(img => {
        const alt = img.getAttribute('alt');
        if (alt === null || alt === undefined) imagesWithoutAlt++;
      });

      // Cookie banner detection
      let hasCookieBanner = false;
      let cookieBannerDismissable = false;
      for (const sel of cookieSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && (el as HTMLElement).offsetHeight > 0) {
            hasCookieBanner = true;
            // Check for dismiss/reject/decline buttons
            const buttons = el.querySelectorAll('button, a, [role="button"]');
            for (const btn of buttons) {
              const text = (btn.textContent || '').toLowerCase();
              if (text.includes('reject') || text.includes('decline') || text.includes('deny')
                  || text.includes('refuse') || text.includes('opt out') || text.includes('opt-out')
                  || text.includes('necessary only') || text.includes('essential only')) {
                cookieBannerDismissable = true;
                break;
              }
            }
            break;
          }
        } catch { /* invalid selector */ }
      }

      // Dark pattern detection
      const darkPatterns: string[] = [];
      if (hasCookieBanner) {
        // Check for pre-checked consent checkboxes
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        let preCheckedCount = 0;
        checkboxes.forEach(cb => {
          if ((cb as HTMLInputElement).checked) preCheckedCount++;
        });
        if (preCheckedCount > 1) darkPatterns.push('pre_checked_consent');

        // Check for hidden/tiny reject buttons (contrast with accept)
        const allButtons = document.querySelectorAll('button, [role="button"]');
        let acceptBtn: HTMLElement | null = null;
        let rejectBtn: HTMLElement | null = null;
        allButtons.forEach(btn => {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('accept') || text.includes('agree') || text.includes('allow')) {
            acceptBtn = btn as HTMLElement;
          }
          if (text.includes('reject') || text.includes('decline') || text.includes('deny') || text.includes('refuse')) {
            rejectBtn = btn as HTMLElement;
          }
        });
        if (acceptBtn && rejectBtn) {
          const acceptRect = (acceptBtn as HTMLElement).getBoundingClientRect();
          const rejectRect = (rejectBtn as HTMLElement).getBoundingClientRect();
          if (rejectRect.width < acceptRect.width * 0.5 || rejectRect.height < acceptRect.height * 0.5) {
            darkPatterns.push('diminished_reject_button');
          }
        }
        if (acceptBtn && !rejectBtn && !cookieBannerDismissable) {
          darkPatterns.push('no_reject_option');
        }
      }

      // Fingerprinting API detection (check if they've been tampered with / called)
      const detectedApis: string[] = [];
      // We can detect if certain API access patterns exist in loaded scripts
      // by checking if specific objects have been modified or wrapped
      for (const api of fingerprintApis) {
        try {
          const parts = api.split('.');
          let obj: unknown = window;
          for (const part of parts.slice(0, -1)) {
            obj = (obj as Record<string, unknown>)[part];
            if (!obj) break;
          }
          if (obj) {
            const fn = (obj as Record<string, unknown>)[parts[parts.length - 1]];
            if (typeof fn === 'function') {
              const fnStr = fn.toString();
              // Native functions show [native code]; wrapped ones don't
              if (!fnStr.includes('[native code]')) {
                detectedApis.push(api);
              }
            }
          }
        } catch { /* access denied */ }
      }

      return {
        hasLang,
        hasSkipNav,
        totalImages,
        imagesWithoutAlt,
        hasCookieBanner,
        cookieBannerDismissable,
        darkPatterns,
        detectedApis,
      };
    }, COOKIE_BANNER_SELECTORS, FINGERPRINT_APIS);

    await browser.close();

    return {
      tracker_count: trackerDomains.size,
      tracker_domains: [...trackerDomains].slice(0, 50),
      fingerprint_apis: pageSignals.detectedApis,
      has_https: hasHttps,
      has_hsts: hasHsts,
      has_csp: hasCsp,
      csp_value: cspValue ? cspValue.slice(0, 2000) : null,
      has_lang_attr: pageSignals.hasLang,
      has_skip_nav: pageSignals.hasSkipNav,
      images_without_alt: pageSignals.imagesWithoutAlt,
      total_images: pageSignals.totalImages,
      has_cookie_banner: pageSignals.hasCookieBanner,
      cookie_banner_dismissable: pageSignals.cookieBannerDismissable,
      dark_pattern_flags: pageSignals.darkPatterns,
      request_domains: [...requestDomains].slice(0, 200),
      audit_duration_ms: Date.now() - startMs,
      audit_error: null,
    };
  } catch (err) {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    return {
      tracker_count: 0,
      tracker_domains: [],
      fingerprint_apis: [],
      has_https: false,
      has_hsts: false,
      has_csp: false,
      csp_value: null,
      has_lang_attr: false,
      has_skip_nav: false,
      images_without_alt: 0,
      total_images: 0,
      has_cookie_banner: false,
      cookie_banner_dismissable: false,
      dark_pattern_flags: [],
      request_domains: [],
      audit_duration_ms: Date.now() - startMs,
      audit_error: String(err).slice(0, 500),
    };
  }
}

// --- DCP Element Derivation ---

interface BrowserDcpElements {
  br_tracking: DcpElement;
  br_security: DcpElement;
  br_accessibility: DcpElement;
  br_consent: DcpElement;
}

function deriveDcpElements(result: AuditResult): BrowserDcpElements {
  // Tracking
  let trackingMod: number;
  if (result.tracker_count === 0) trackingMod = 0.05;
  else if (result.tracker_count <= 3) trackingMod = 0;
  else if (result.tracker_count <= 10) trackingMod = -0.10;
  else trackingMod = -0.20;

  const trackingNote = result.tracker_count === 0
    ? 'No third-party trackers detected'
    : `${result.tracker_count} tracker domain(s): ${result.tracker_domains.slice(0, 5).join(', ')}${result.tracker_count > 5 ? '...' : ''}`;

  // Security
  const securityScore = (result.has_https ? 1 : 0) + (result.has_hsts ? 1 : 0) + (result.has_csp ? 1 : 0);
  let securityMod: number;
  if (securityScore === 3) securityMod = 0.05;
  else if (securityScore === 2) securityMod = 0;
  else if (securityScore === 1) securityMod = -0.05;
  else securityMod = -0.15;

  const securityParts = [];
  if (result.has_https) securityParts.push('HTTPS');
  if (result.has_hsts) securityParts.push('HSTS');
  if (result.has_csp) securityParts.push('CSP');
  const securityNote = securityParts.length > 0
    ? `Security headers: ${securityParts.join(', ')}`
    : 'No security headers detected';

  // Accessibility
  const a11yChecks = [result.has_lang_attr, result.has_skip_nav,
    result.total_images === 0 || (result.images_without_alt / Math.max(result.total_images, 1)) < 0.2];
  const a11yScore = a11yChecks.filter(Boolean).length;
  let a11yMod: number;
  if (a11yScore === 3) a11yMod = 0.05;
  else if (a11yScore === 2) a11yMod = 0;
  else if (a11yScore === 1) a11yMod = -0.05;
  else a11yMod = -0.10;

  const a11yParts = [];
  if (result.has_lang_attr) a11yParts.push('lang attr');
  if (result.has_skip_nav) a11yParts.push('skip nav');
  if (result.total_images > 0) {
    const altPct = Math.round(((result.total_images - result.images_without_alt) / result.total_images) * 100);
    a11yParts.push(`${altPct}% alt text`);
  }
  const a11yNote = a11yParts.length > 0
    ? `Accessibility: ${a11yParts.join(', ')}`
    : 'No accessibility features detected';

  // Consent
  let consentMod: number;
  if (!result.has_cookie_banner) {
    consentMod = 0; // no banner needed or absent
  } else if (result.dark_pattern_flags.length > 0) {
    consentMod = -0.15;
  } else if (!result.cookie_banner_dismissable) {
    consentMod = -0.05;
  } else {
    consentMod = 0.03;
  }

  let consentNote = 'No cookie consent banner detected';
  if (result.has_cookie_banner) {
    if (result.dark_pattern_flags.length > 0) {
      consentNote = `Cookie banner with dark patterns: ${result.dark_pattern_flags.join(', ')}`;
    } else if (result.cookie_banner_dismissable) {
      consentNote = 'Cookie banner with clear opt-out option';
    } else {
      consentNote = 'Cookie banner without clear reject option';
    }
  }

  return {
    br_tracking: {
      modifier: trackingMod,
      affects: ['Preamble ¶5', 'Article 12', 'Article 19'],
      note: trackingNote,
    },
    br_security: {
      modifier: securityMod,
      affects: ['Article 3', 'Article 12'],
      note: securityNote,
    },
    br_accessibility: {
      modifier: a11yMod,
      affects: ['Article 26', 'Article 27 ¶1'],
      note: a11yNote,
    },
    br_consent: {
      modifier: consentMod,
      affects: ['Article 12', 'Article 19', 'Article 20 ¶2'],
      note: consentNote,
    },
  };
}

// --- DB Write ---

async function writeAuditResult(db: D1Database, domain: string, result: AuditResult): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO domain_browser_audit
     (domain, audited_at, tracker_count, tracker_domains, fingerprint_apis,
      has_https, has_hsts, has_csp, csp_value,
      has_lang_attr, has_skip_nav, images_without_alt, total_images,
      has_cookie_banner, cookie_banner_dismissable, dark_pattern_flags,
      request_log_json, audit_duration_ms, audit_error)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    domain,
    result.tracker_count,
    JSON.stringify(result.tracker_domains),
    JSON.stringify(result.fingerprint_apis),
    result.has_https ? 1 : 0,
    result.has_hsts ? 1 : 0,
    result.has_csp ? 1 : 0,
    result.csp_value,
    result.has_lang_attr ? 1 : 0,
    result.has_skip_nav ? 1 : 0,
    result.images_without_alt,
    result.total_images,
    result.has_cookie_banner ? 1 : 0,
    result.cookie_banner_dismissable ? 1 : 0,
    JSON.stringify(result.dark_pattern_flags),
    JSON.stringify(result.request_domains.slice(0, 100)),
    result.audit_duration_ms,
    result.audit_error,
  ).run();
}

// --- DCP Merge ---

async function mergeBrowserDcpIntoCache(
  db: D1Database,
  kv: KVNamespace,
  domain: string,
  brElements: BrowserDcpElements,
): Promise<void> {
  // Read existing DCP
  let existingDcp: Record<string, unknown> | null = null;
  const kvDcp = await kv.get(`dcp:${domain}`, 'json');
  if (kvDcp) {
    existingDcp = kvDcp as Record<string, unknown>;
  } else {
    existingDcp = await getCachedDcp(writeDb(db), domain);
  }

  // Merge br_* elements into existing DCP (or create new)
  const merged: Record<string, unknown> = existingDcp ? { ...existingDcp } : {};
  merged.br_tracking = brElements.br_tracking;
  merged.br_security = brElements.br_security;
  merged.br_accessibility = brElements.br_accessibility;
  merged.br_consent = brElements.br_consent;

  // Write back to both KV and D1
  await cacheDcp(writeDb(db), domain, merged);
  try {
    await kv.put(`dcp:${domain}`, JSON.stringify(merged), { expirationTtl: 604800 });
  } catch { /* KV write failure non-fatal */ }
}

// --- Queue Consumer ---

export default {
  async queue(batch: MessageBatch<AuditMessage>, env: Env): Promise<void> {
    const db = writeDb(env.DB);

    for (const msg of batch.messages) {
      const { domain } = msg.body;
      console.log(`[browser-audit] Starting audit: ${domain}`);

      try {
        const result = await auditDomain(env, domain);

        // Write raw audit data to D1
        await writeAuditResult(db, domain, result);

        if (!result.audit_error) {
          // Derive and merge DCP elements
          const brElements = deriveDcpElements(result);
          await mergeBrowserDcpIntoCache(db, env.CONTENT_CACHE, domain, brElements);

          console.log(`[browser-audit] Done: ${domain} — ${result.tracker_count} trackers, ${result.audit_duration_ms}ms`);
          await logEvent(db, {
            event_type: 'eval_success',
            severity: 'info',
            message: `Browser audit: ${domain} — ${result.tracker_count} trackers, HSTS=${result.has_hsts}, CSP=${result.has_csp}`,
            details: {
              phase: 'browser_audit',
              domain,
              tracker_count: result.tracker_count,
              has_hsts: result.has_hsts,
              has_csp: result.has_csp,
              has_lang_attr: result.has_lang_attr,
              has_cookie_banner: result.has_cookie_banner,
              dark_patterns: result.dark_pattern_flags.length,
              duration_ms: result.audit_duration_ms,
            },
          });
        } else {
          console.warn(`[browser-audit] Error for ${domain}: ${result.audit_error}`);
          await logEvent(db, {
            event_type: 'eval_failure',
            severity: 'warn',
            message: `Browser audit failed: ${domain} — ${result.audit_error.slice(0, 200)}`,
            details: { phase: 'browser_audit', domain, error: result.audit_error, duration_ms: result.audit_duration_ms },
          });
        }

        msg.ack();
      } catch (err) {
        console.error(`[browser-audit] Fatal error for ${domain}:`, err);
        await logEvent(db, {
          event_type: 'eval_failure',
          severity: 'error',
          message: `Browser audit fatal: ${domain} — ${String(err).slice(0, 200)}`,
          details: { phase: 'browser_audit', domain, error: String(err).slice(0, 500) },
        }).catch(() => {});
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
