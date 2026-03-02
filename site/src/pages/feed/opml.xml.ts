// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';

export const prerender = true;

const BASE_URL = 'https://observatory.unratified.org';

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * GET /feed/opml.xml
 *
 * OPML subscription list for all UDHR provision feeds.
 * Import into any RSS reader to subscribe to per-article HRCB feeds.
 * Includes the main feed + 31 per-provision feeds (Preamble + Articles 1-30)
 * + stance-filtered feeds (positive/negative/neutral).
 */
export const GET: APIRoute = async () => {
  const now = new Date().toUTCString();

  const outlines: string[] = [];

  // Main feed
  outlines.push(
    `      <outline text="HRO — All Stories" title="HRO — All Stories" type="rss" xmlUrl="${BASE_URL}/feed.xml" htmlUrl="${BASE_URL}/" />`
  );

  // Stance-filtered feeds
  for (const stance of ['positive', 'negative', 'neutral'] as const) {
    outlines.push(
      `      <outline text="HRO — ${stance} stories" title="HRO — ${stance} stories" type="rss" xmlUrl="${BASE_URL}/feed.xml?filter=${stance}" htmlUrl="${BASE_URL}/?filter=${stance}" />`
    );
  }

  // Per-provision feeds
  const provisionOutlines: string[] = [];
  provisionOutlines.push(
    `        <outline text="Preamble" title="UDHR Preamble" type="rss" xmlUrl="${BASE_URL}/feed.xml?article=0" htmlUrl="${BASE_URL}/article/0" />`
  );
  for (let i = 1; i <= 30; i++) {
    provisionOutlines.push(
      `        <outline text="Article ${i}" title="UDHR Article ${i}" type="rss" xmlUrl="${BASE_URL}/feed.xml?article=${i}" htmlUrl="${BASE_URL}/article/${i}" />`
    );
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<opml version="2.0">
  <head>
    <title>HRO — UDHR Provision Feeds</title>
    <dateCreated>${escapeXml(now)}</dateCreated>
    <ownerName>Human Rights Observatory</ownerName>
    <docs>https://observatory.unratified.org/about</docs>
  </head>
  <body>
    <outline text="HRO" title="HRO — Human Rights Compatibility Bias">
${outlines.join('\n')}
      <outline text="UDHR Provisions" title="Per-provision feeds">
${provisionOutlines.join('\n')}
      </outline>
    </outline>
  </body>
</opml>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'text/x-opml+xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hn-hrcb-feeds.opml"',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
