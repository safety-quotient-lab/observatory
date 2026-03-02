// SPDX-License-Identifier: Apache-2.0
/**
 * Lightweight HTML sanitizer for user-generated content (HN comments, user bios).
 * Strips all tags except a safe allowlist. Removes dangerous attributes.
 */

const ALLOWED_TAGS = new Set([
  'p', 'a', 'i', 'em', 'b', 'strong', 'code', 'pre', 'br', 'ul', 'ol', 'li',
  'blockquote', 'div', 'span', 'hr', 'u', 'sub', 'sup', 'del', 's',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'rel']),
};

/**
 * Sanitize HTML string by stripping disallowed tags and attributes.
 * Uses regex-based approach (no DOM parser needed on server).
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  // Remove <script>, <style>, <iframe>, <object>, <embed>, <form>, <input>,
  // <textarea>, <select>, <button>, <svg>, <math> and their contents
  let clean = html.replace(
    /<(script|style|iframe|object|embed|form|input|textarea|select|button|svg|math|link|meta|base|applet)\b[^]*?<\/\1\s*>/gi,
    ''
  );
  // Also remove self-closing/unclosed dangerous tags
  clean = clean.replace(
    /<(script|style|iframe|object|embed|form|input|textarea|select|button|svg|math|link|meta|base|applet)\b[^>]*\/?>/gi,
    ''
  );

  // Process remaining tags: keep allowed, strip others
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const lowerTag = tag.toLowerCase();
    const isClosing = match.startsWith('</');

    if (!ALLOWED_TAGS.has(lowerTag)) {
      return ''; // Strip disallowed tag
    }

    if (isClosing) {
      return `</${lowerTag}>`;
    }

    // Filter attributes
    const allowedAttrSet = ALLOWED_ATTRS[lowerTag];
    if (!allowedAttrSet) {
      // No attributes allowed for this tag
      return `<${lowerTag}>`;
    }

    const safeAttrs: string[] = [];
    const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      if (!allowedAttrSet.has(attrName)) continue;

      // Block javascript: URLs in href
      if (attrName === 'href') {
        const normalized = attrValue.replace(/\s/g, '').toLowerCase();
        if (normalized.startsWith('javascript:') || normalized.startsWith('data:') || normalized.startsWith('vbscript:')) {
          continue;
        }
      }

      safeAttrs.push(`${attrName}="${attrValue.replace(/"/g, '&quot;')}"`);
    }

    // Force rel="nofollow noopener" on links
    if (lowerTag === 'a') {
      safeAttrs.push('rel="nofollow noopener"');
    }

    const attrStr = safeAttrs.length > 0 ? ' ' + safeAttrs.join(' ') : '';
    return `<${lowerTag}${attrStr}>`;
  });

  // Remove event handler attributes that might have slipped through
  clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '');

  return clean;
}
