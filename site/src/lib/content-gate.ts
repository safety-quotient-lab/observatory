/**
 * Content Gate — Pre-eval content classification.
 *
 * Classifies fetched HTML into content categories (paywall, captcha, bot protection, etc.)
 * and blocks non-evaluable content before it reaches the LLM, saving tokens and producing
 * cleaner data.
 *
 * Pure synchronous function. No async, no external calls. Regex-only.
 */

export type ContentCategory =
  | 'content'
  | 'paywall'
  | 'captcha'
  | 'bot_protection'
  | 'cookie_wall'
  | 'geo_restriction'
  | 'login_wall'
  | 'rate_limited'
  | 'error_page'
  | 'redirect_or_js_required'
  | 'age_gate'
  | 'app_gate';

export interface ContentGateResult {
  category: ContentCategory;
  confidence: number;    // 0.0–1.0
  signals: string[];     // human-readable reasons
  blocked: boolean;      // true if content is non-evaluable
}

// --- Layer 2: Known hard-paywall domains ---
// These frequently return subscriber-only gate pages.
// Domain match alone only boosts score; content must also look gated.
const PAYWALL_DOMAINS = new Set([
  'bloomberg.com', 'wsj.com', 'ft.com', 'nytimes.com', 'economist.com',
  'theathletic.com', 'telegraph.co.uk', 'thetimes.co.uk', 'barrons.com',
  'hbr.org', 'foreignaffairs.com', 'foreignpolicy.com', 'theatlantic.com',
  'newyorker.com', 'wired.com', 'vanityfair.com', 'bostonglobe.com',
  'washingtonpost.com', 'latimes.com', 'sfchronicle.com', 'seattletimes.com',
  'denverpost.com', 'inquirer.com', 'startribune.com', 'chicagotribune.com',
  'baltimoresun.com', 'journalnow.com', 'businessinsider.com', 'insider.com',
  'seekingalpha.com', 'statista.com',
]);

// --- Layer 3: Title patterns → category mapping ---
interface TitlePattern {
  pattern: RegExp;
  category: ContentCategory;
  confidence: number;
  signal: string;
}

const TITLE_PATTERNS: TitlePattern[] = [
  { pattern: /access denied/i, category: 'bot_protection', confidence: 0.8, signal: 'Title: Access Denied' },
  { pattern: /attention required/i, category: 'bot_protection', confidence: 0.8, signal: 'Title: Attention Required' },
  { pattern: /just a moment/i, category: 'bot_protection', confidence: 0.85, signal: 'Title: Just a moment (Cloudflare)' },
  { pattern: /verify you are human/i, category: 'captcha', confidence: 0.85, signal: 'Title: Verify you are human' },
  { pattern: /please enable cookies/i, category: 'cookie_wall', confidence: 0.7, signal: 'Title: Please enable cookies' },
  { pattern: /robot or human/i, category: 'captcha', confidence: 0.85, signal: 'Title: Robot or human?' },
  { pattern: /pardon our interruption/i, category: 'bot_protection', confidence: 0.8, signal: 'Title: Pardon Our Interruption' },
  { pattern: /you have been blocked/i, category: 'bot_protection', confidence: 0.85, signal: 'Title: You have been blocked' },
  { pattern: /403 forbidden/i, category: 'bot_protection', confidence: 0.7, signal: 'Title: 403 Forbidden' },
  { pattern: /service unavailable/i, category: 'error_page', confidence: 0.7, signal: 'Title: Service Unavailable' },
  { pattern: /page not found|404/i, category: 'error_page', confidence: 0.7, signal: 'Title: Page Not Found / 404' },
  { pattern: /under maintenance/i, category: 'error_page', confidence: 0.75, signal: 'Title: Under Maintenance' },
  { pattern: /are you a robot/i, category: 'captcha', confidence: 0.8, signal: 'Title: Are you a robot?' },
  { pattern: /security check/i, category: 'bot_protection', confidence: 0.7, signal: 'Title: Security Check' },
  { pattern: /human verification/i, category: 'captcha', confidence: 0.85, signal: 'Title: Human Verification' },
  { pattern: /age verification/i, category: 'age_gate', confidence: 0.8, signal: 'Title: Age Verification' },
];

// --- Layer 4: Body keyword patterns ---
interface BodyPattern {
  pattern: RegExp;
  category: ContentCategory;
  weight: number;
  signal: string;
}

const BODY_PATTERNS: BodyPattern[] = [
  // Paywall
  { pattern: /subscribe to (read|continue|access|unlock)/i, category: 'paywall', weight: 0.3, signal: 'subscribe to read/continue' },
  { pattern: /premium (content|article|member|subscriber)/i, category: 'paywall', weight: 0.3, signal: 'premium content/member' },
  { pattern: /(paid|premium) subscription/i, category: 'paywall', weight: 0.3, signal: 'paid/premium subscription' },
  { pattern: /become a (member|subscriber)/i, category: 'paywall', weight: 0.3, signal: 'become a member/subscriber' },
  { pattern: /already a subscriber\? ?(log|sign) ?in/i, category: 'paywall', weight: 0.3, signal: 'already a subscriber? log in' },
  { pattern: /free articles? remaining/i, category: 'paywall', weight: 0.3, signal: 'free articles remaining' },
  { pattern: /reading limit reached/i, category: 'paywall', weight: 0.3, signal: 'reading limit reached' },
  { pattern: /subscribe (now|today) (to|for) (full|unlimited|continued)/i, category: 'paywall', weight: 0.3, signal: 'subscribe for full access' },
  { pattern: /this (article|content|story) is (for|available to) (paid |premium )?subscribers/i, category: 'paywall', weight: 0.35, signal: 'content for subscribers only' },
  { pattern: /unlock (this|full) (article|story|content)/i, category: 'paywall', weight: 0.3, signal: 'unlock this article' },

  // CAPTCHA
  { pattern: /class="g-recaptcha"/i, category: 'captcha', weight: 0.5, signal: 'reCAPTCHA widget' },
  { pattern: /class="h-captcha"/i, category: 'captcha', weight: 0.5, signal: 'hCaptcha widget' },
  { pattern: /data-sitekey=/i, category: 'captcha', weight: 0.45, signal: 'CAPTCHA sitekey' },
  { pattern: /data-hcaptcha-/i, category: 'captcha', weight: 0.5, signal: 'hCaptcha data attribute' },
  { pattern: /verify you are (a )?human/i, category: 'captcha', weight: 0.5, signal: 'verify you are human' },
  { pattern: /complete the security check/i, category: 'captcha', weight: 0.5, signal: 'complete the security check' },
  { pattern: /challenges\.cloudflare\.com/i, category: 'captcha', weight: 0.5, signal: 'Cloudflare challenge script' },
  { pattern: /captcha/i, category: 'captcha', weight: 0.3, signal: 'captcha keyword' },

  // Bot protection
  { pattern: /cf-browser-verification/i, category: 'bot_protection', weight: 0.4, signal: 'Cloudflare browser verification' },
  { pattern: /cf-challenge/i, category: 'bot_protection', weight: 0.4, signal: 'Cloudflare challenge' },
  { pattern: /__cf_chl/i, category: 'bot_protection', weight: 0.4, signal: 'Cloudflare challenge token' },
  { pattern: /cf-turnstile/i, category: 'bot_protection', weight: 0.4, signal: 'Cloudflare Turnstile' },
  { pattern: /akamai.*bot.*manager/i, category: 'bot_protection', weight: 0.4, signal: 'Akamai Bot Manager' },
  { pattern: /perimeterx/i, category: 'bot_protection', weight: 0.4, signal: 'PerimeterX' },
  { pattern: /px-captcha/i, category: 'bot_protection', weight: 0.4, signal: 'PerimeterX CAPTCHA' },
  { pattern: /datadome/i, category: 'bot_protection', weight: 0.4, signal: 'DataDome' },
  { pattern: /dd_banner/i, category: 'bot_protection', weight: 0.35, signal: 'DataDome banner' },
  { pattern: /imperva.*incapsula/i, category: 'bot_protection', weight: 0.4, signal: 'Imperva/Incapsula' },
  { pattern: /distil.*networks/i, category: 'bot_protection', weight: 0.4, signal: 'Distil Networks' },
  { pattern: /please enable javascript.*to view/i, category: 'bot_protection', weight: 0.35, signal: 'JavaScript required to view' },
  { pattern: /please turn javascript on/i, category: 'bot_protection', weight: 0.35, signal: 'JavaScript must be on' },
  { pattern: /your (access|request) (to|has been) (this site|blocked|denied)/i, category: 'bot_protection', weight: 0.4, signal: 'access blocked/denied' },
  { pattern: /ray id:/i, category: 'bot_protection', weight: 0.3, signal: 'Cloudflare Ray ID' },

  // Cookie wall
  { pattern: /consent.*cookie.*continue/i, category: 'cookie_wall', weight: 0.3, signal: 'cookie consent to continue' },
  { pattern: /accept cookies to continue/i, category: 'cookie_wall', weight: 0.3, signal: 'accept cookies to continue' },
  { pattern: /cookie.*policy.*agree/i, category: 'cookie_wall', weight: 0.3, signal: 'cookie policy agree' },
  { pattern: /we (use|need) cookies.*to (provide|give|show)/i, category: 'cookie_wall', weight: 0.25, signal: 'we use cookies to provide' },

  // Login wall
  { pattern: /(sign|log) ?in to (continue|read|access|view)/i, category: 'login_wall', weight: 0.35, signal: 'sign in to continue' },
  { pattern: /create (an |a free )?account to (continue|read|access)/i, category: 'login_wall', weight: 0.35, signal: 'create account to continue' },
  { pattern: /(register|join) (to |for )(continue|access|read)/i, category: 'login_wall', weight: 0.35, signal: 'register to continue' },
  { pattern: /you must (sign|log) ?in/i, category: 'login_wall', weight: 0.35, signal: 'must sign in' },

  // Geo restriction
  { pattern: /not available in your (country|region|location)/i, category: 'geo_restriction', weight: 0.4, signal: 'not available in your region' },
  { pattern: /geo[- ]?restrict/i, category: 'geo_restriction', weight: 0.4, signal: 'geo-restricted' },
  { pattern: /content.*unavailable.*your.*location/i, category: 'geo_restriction', weight: 0.4, signal: 'content unavailable in location' },
  { pattern: /this (service|content) is not available in/i, category: 'geo_restriction', weight: 0.35, signal: 'service not available in region' },

  // Rate limited
  { pattern: /too many requests/i, category: 'rate_limited', weight: 0.4, signal: 'too many requests' },
  { pattern: /rate limit/i, category: 'rate_limited', weight: 0.4, signal: 'rate limit' },
  { pattern: /slow down/i, category: 'rate_limited', weight: 0.3, signal: 'slow down' },
  { pattern: /try again (later|in \d)/i, category: 'rate_limited', weight: 0.3, signal: 'try again later' },
  { pattern: /request(s)? (have|has) been (rate[- ]?limited|throttled)/i, category: 'rate_limited', weight: 0.4, signal: 'requests throttled' },

  // Age gate
  { pattern: /(confirm|verify) (you are|your age|that you)/i, category: 'age_gate', weight: 0.3, signal: 'age verification prompt' },
  { pattern: /must be (18|21)\+?/i, category: 'age_gate', weight: 0.4, signal: 'must be 18/21+' },
  { pattern: /age (verification|gate|check)/i, category: 'age_gate', weight: 0.4, signal: 'age verification/gate' },
  { pattern: /enter your (date of birth|birthday|age)/i, category: 'age_gate', weight: 0.4, signal: 'enter date of birth' },

  // App gate
  { pattern: /download (our|the) app/i, category: 'app_gate', weight: 0.35, signal: 'download our app' },
  { pattern: /continue in (the )?app/i, category: 'app_gate', weight: 0.35, signal: 'continue in app' },
  { pattern: /available (only|exclusively) (on|in) (our|the) app/i, category: 'app_gate', weight: 0.35, signal: 'available only in app' },
  { pattern: /open (in|with) (the|our) app/i, category: 'app_gate', weight: 0.3, signal: 'open in app' },

  // Error page
  { pattern: /500 internal server error/i, category: 'error_page', weight: 0.5, signal: '500 Internal Server Error' },
  { pattern: /503 service unavailable/i, category: 'error_page', weight: 0.5, signal: '503 Service Unavailable' },
  { pattern: /502 bad gateway/i, category: 'error_page', weight: 0.5, signal: '502 Bad Gateway' },
  { pattern: /site (is )?(under |undergoing )?maintenance/i, category: 'error_page', weight: 0.4, signal: 'site under maintenance' },
  { pattern: /we('re| are) (currently )?(experiencing|having) (technical )?(issues|difficulties|problems)/i, category: 'error_page', weight: 0.35, signal: 'experiencing technical issues' },
];

// Script/style blocks regex (same as html-clean.ts)
const SCRIPT_STYLE_BLOCKS = /<(script|style)[\s>][\s\S]*?<\/\1>/gi;

// Content structural elements
const CONTENT_ELEMENTS = /<(article|main|p|section)[\s>]/i;

/** Extract <title> content from raw HTML */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

/** Strip scripts/styles and HTML tags, return text length */
function proseLength(html: string): number {
  let text = html;
  text = text.replace(SCRIPT_STYLE_BLOCKS, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length;
}

/** Extract hostname from URL, stripping www. prefix */
function extractHostname(url: string): string {
  try {
    let host = new URL(url).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return '';
  }
}

/** Check if hostname matches a known paywall domain (including subdomains) */
function isPaywallDomain(hostname: string): boolean {
  if (PAYWALL_DOMAINS.has(hostname)) return true;
  // Check parent domains: e.g. blog.nytimes.com → nytimes.com
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (PAYWALL_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

/**
 * Classify fetched content into a category and decide whether to block evaluation.
 *
 * @param rawHtml - The raw HTML or error string from fetchUrlContent()
 * @param url - The original URL being evaluated
 * @returns Classification result with category, confidence, signals, and blocked flag
 */
export function classifyContent(rawHtml: string, url: string): ContentGateResult {
  // Accumulate scores per category
  const scores: Partial<Record<ContentCategory, number>> = {};
  const signals: string[] = [];

  function addScore(cat: ContentCategory, weight: number, signal: string) {
    scores[cat] = (scores[cat] || 0) + weight;
    signals.push(signal);
  }

  // --- Layer 1: Error prefix check ---
  if (rawHtml.startsWith('[error:')) {
    const errorMatch = rawHtml.match(/^\[error:([^\]]+)\]/);
    const errorCode = errorMatch ? errorMatch[1] : 'unknown';

    if (errorCode === 'http-429') {
      return { category: 'rate_limited', confidence: 0.9, signals: ['HTTP 429 response'], blocked: true };
    }
    if (errorCode === 'http-451') {
      return { category: 'geo_restriction', confidence: 0.9, signals: ['HTTP 451 Unavailable For Legal Reasons'], blocked: true };
    }
    if (errorCode === 'http-403') {
      return { category: 'bot_protection', confidence: 0.7, signals: ['HTTP 403 Forbidden'], blocked: true };
    }
    if (errorCode.startsWith('http-5')) {
      return { category: 'error_page', confidence: 0.9, signals: [`HTTP ${errorCode.replace('http-', '')} error`], blocked: true };
    }
    // Any other error prefix
    return { category: 'error_page', confidence: 0.8, signals: [`Fetch error: ${errorCode}`], blocked: true };
  }

  // --- Layer 2: Known paywall domains ---
  const hostname = extractHostname(url);
  const isKnownPaywall = isPaywallDomain(hostname);
  const textLen = proseLength(rawHtml);

  if (isKnownPaywall) {
    // Domain match boosts paywall score; short/generic content makes it definitive
    if (textLen < 1000) {
      addScore('paywall', 0.6, `Known paywall domain (${hostname}) + short content (${textLen} chars)`);
    } else {
      addScore('paywall', 0.2, `Known paywall domain (${hostname})`);
    }
  }

  // --- Layer 3: Title/meta tag analysis ---
  const title = extractTitle(rawHtml);
  for (const tp of TITLE_PATTERNS) {
    if (tp.pattern.test(title)) {
      addScore(tp.category, tp.confidence, tp.signal);
    }
  }

  // noindex + short content → likely gate/error page
  if (/meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(rawHtml) && textLen < 500) {
    addScore('error_page', 0.3, 'Meta robots noindex + short content');
  }

  // --- Layer 4: Body keyword patterns ---
  for (const bp of BODY_PATTERNS) {
    if (bp.pattern.test(rawHtml)) {
      addScore(bp.category, bp.weight, bp.signal);
    }
  }

  // --- Layer 5: Structural heuristics ---
  // Very short content + any gate signal → boost top category
  if (textLen < 500 && signals.length > 0) {
    // Find the leading category so far and boost it
    const topCat = getTopCategory(scores);
    if (topCat && topCat !== 'content') {
      addScore(topCat, 0.2, `Very short content (${textLen} chars) amplifier`);
    }
  }

  // Extremely high script-to-text ratio → JS redirect/SPA
  const totalLen = rawHtml.length;
  if (totalLen > 200) {
    const scriptLen = totalLen - rawHtml.replace(SCRIPT_STYLE_BLOCKS, '').length;
    const scriptRatio = scriptLen / totalLen;
    if (scriptRatio > 0.9 && textLen < 200) {
      addScore('redirect_or_js_required', 0.7, `Script/style ratio ${(scriptRatio * 100).toFixed(0)}%, prose ${textLen} chars`);
    }
  }

  // No content structural elements + very short → non-content
  if (!CONTENT_ELEMENTS.test(rawHtml) && textLen < 200 && totalLen > 0) {
    const topCat = getTopCategory(scores);
    if (topCat && topCat !== 'content') {
      addScore(topCat, 0.15, `No article/main/p/section elements + ${textLen} chars`);
    } else if (!topCat) {
      addScore('redirect_or_js_required', 0.4, `No content elements, only ${textLen} chars prose`);
    }
  }

  // --- Decision ---
  const topCategory = getTopCategory(scores);

  if (!topCategory) {
    return { category: 'content', confidence: 1.0, signals: [], blocked: false };
  }

  // Cap confidence at 0.95 for keyword-only detection
  const capMap: Partial<Record<ContentCategory, number>> = {
    paywall: 0.95,
    captcha: 0.95,
    bot_protection: 0.95,
    cookie_wall: 0.85,
    login_wall: 0.90,
    geo_restriction: 0.95,
    rate_limited: 0.95,
    error_page: 0.95,
    redirect_or_js_required: 0.95,
    age_gate: 0.90,
    app_gate: 0.90,
  };

  const confidence = Math.min(scores[topCategory]!, capMap[topCategory] ?? 0.95);
  const blocked = confidence >= 0.6;

  return {
    category: topCategory,
    confidence: Math.round(confidence * 100) / 100,
    signals: signals.filter(s => s), // deduplicated by construction
    blocked,
  };
}

/** Return the category with the highest accumulated score, or null if no scores */
function getTopCategory(scores: Partial<Record<ContentCategory, number>>): ContentCategory | null {
  let topCat: ContentCategory | null = null;
  let topScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score! > topScore) {
      topScore = score!;
      topCat = cat as ContentCategory;
    }
  }
  return topCat;
}
