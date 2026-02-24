/**
 * Regex-based HTML cleaning utility.
 * Strips navigational chrome from raw HTML before sending to Claude, reducing input tokens.
 * Preserves script and style tags (they may carry structural signals for HRCB analysis).
 * No external dependencies.
 */

/** Tags whose content is navigational chrome, not primary content. */
const STRIP_TAGS_WITH_CONTENT = /(<nav[\s>][\s\S]*?<\/nav>|<header[\s>][\s\S]*?<\/header>|<footer[\s>][\s\S]*?<\/footer>|<iframe[\s>][\s\S]*?<\/iframe>|<noscript[\s>][\s\S]*?<\/noscript>)/gi;

/** HTML comments */
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

/** All remaining HTML tags */
const ALL_TAGS = /<[^>]+>/g;

/** Collapse multiple whitespace characters into a single space */
const MULTI_WHITESPACE = /[ \t]+/g;

/** Collapse 3+ newlines into 2 */
const MULTI_NEWLINES = /\n{3,}/g;

/**
 * Default max output chars. Can be overridden per call.
 * ~20K chars ≈ ~5K tokens for Claude, leaving room for system + output tokens.
 */
export const DEFAULT_MAX_CHARS = 20_000;

export function cleanHtml(raw: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  let text = raw;

  // 1. Remove nav/header/footer/iframe/noscript blocks (navigational chrome)
  text = text.replace(STRIP_TAGS_WITH_CONTENT, ' ');

  // 2. Remove HTML comments
  text = text.replace(HTML_COMMENTS, '');

  // 3. Strip all remaining HTML tags, keeping text content
  text = text.replace(ALL_TAGS, ' ');

  // 4. Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // 5. Collapse whitespace
  text = text.replace(MULTI_WHITESPACE, ' ');
  text = text.replace(MULTI_NEWLINES, '\n\n');
  text = text.trim();

  // 6. Truncate to limit
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  return text;
}
