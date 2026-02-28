import type { APIContext } from 'astro';
import { readDb } from '../../../../lib/db-utils';
import { formatScore } from '../../../../lib/colors';

export const prerender = false;

/** HSL to hex (server-side — mirrors scoreToColor from colors.ts) */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Score [-1, +1] to hex color — same algorithm as scoreToColor in colors.ts */
function scoreToHex(score: number | null | undefined): string {
  if (score == null) return '#4b5563';
  const clamped = Math.max(-1, Math.min(1, score));
  const hue = clamped < 0 ? 40 * (1 + clamped) : 40 + 102 * clamped;
  const sat = 0.75 + 0.15 * Math.abs(clamped);
  const lit = 0.42 + 0.08 * Math.abs(clamped);
  return hslToHex(hue, sat, lit);
}

/** Generate a shields.io-style SVG badge */
function renderBadge(label: string, value: string, valueColor: string, count: number | null): string {
  const labelWidth = Math.max(label.length * 6.5 + 12, 40);
  const valueWidth = Math.max(value.length * 6.8 + 12, 40);
  const totalWidth = labelWidth + valueWidth;

  // Subtitle with story count
  const subtitle = count !== null ? `${count} stories` : '';
  const subtitleSection = subtitle
    ? `<text x="${totalWidth / 2}" y="24" font-family="Verdana,Geneva,sans-serif" font-size="8" fill="#aaa" text-anchor="middle">${subtitle}</text>`
    : '';
  const height = subtitle ? 30 : 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="13">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="13">${value}</text>
  </g>
  ${subtitleSection}
</svg>`;
}

/**
 * GET /api/v1/badge/{domain}.svg
 *
 * Returns a shields.io-style SVG badge showing the domain's HRCB score.
 * Embeddable in Markdown, HTML, READMEs.
 *
 * Options:
 *   ?label=HRCB        — left-side label (default: "HRCB")
 *   ?style=flat         — badge style (only "flat" currently)
 */
export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(renderBadge('HRCB', 'error', '#e05d44', null), {
      status: 503,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
    });
  }

  const db = readDb(env.DB);
  // Astro captures "example.com.svg" — strip the .svg suffix
  const rawDomain = (context.params.domain ?? '').replace(/\.svg$/, '');
  if (!rawDomain) {
    return new Response(renderBadge('HRCB', 'no domain', '#9f9f9f', null), {
      status: 400,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
    });
  }

  const label = context.url.searchParams.get('label') || 'HRCB';

  const row = await db
    .prepare(
      `SELECT avg_hrcb, evaluated_count, story_count
       FROM domain_aggregates
       WHERE domain = ?`
    )
    .bind(rawDomain)
    .first<{ avg_hrcb: number | null; evaluated_count: number; story_count: number }>();

  if (!row) {
    return new Response(renderBadge(label, 'unknown', '#9f9f9f', null), {
      status: 404,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const scoreText = row.avg_hrcb !== null ? formatScore(row.avg_hrcb) : 'ND';
  const color = scoreToHex(row.avg_hrcb);

  return new Response(renderBadge(label, scoreText, color, row.evaluated_count), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}
