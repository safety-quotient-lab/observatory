import type { APIRoute } from 'astro';
import { formatScore } from '../lib/colors';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const baseUrl = 'https://hn-hrcb.pages.dev';

  const { results: stories } = await db
    .prepare(
      `SELECT hn_id, title, url, domain, hcb_weighted_mean, hcb_editorial_mean, hcb_classification,
              hcb_signal_sections, hcb_nd_count, evaluated_at, hn_by, hn_score, content_type
       FROM stories
       WHERE eval_status = 'done' AND hcb_weighted_mean IS NOT NULL
       ORDER BY evaluated_at DESC
       LIMIT 50`
    )
    .all<{
      hn_id: number;
      title: string;
      url: string | null;
      domain: string | null;
      hcb_weighted_mean: number | null;
      hcb_editorial_mean: number | null;
      hcb_classification: string | null;
      hcb_signal_sections: number | null;
      hcb_nd_count: number | null;
      evaluated_at: string | null;
      hn_by: string | null;
      hn_score: number | null;
      content_type: string;
    }>();

  const updated = stories.length > 0 && stories[0].evaluated_at
    ? new Date(stories[0].evaluated_at).toISOString()
    : new Date().toISOString();

  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const entries = stories.map(s => {
    const score = formatScore(s.hcb_editorial_mean ?? s.hcb_weighted_mean);
    const link = `${baseUrl}/item/${s.hn_id}`;
    const pubDate = s.evaluated_at ? new Date(s.evaluated_at).toISOString() : updated;
    const summary = `HRCB: ${score} (${s.hcb_classification || 'Unknown'}) — ${s.hcb_signal_sections ?? 0} of 31 UDHR provisions scored. ${s.domain || 'self-post'}`;

    return `  <entry>
    <title>${escapeXml(`[${score}] ${s.title}`)}</title>
    <link href="${escapeXml(link)}" />
    <id>${escapeXml(link)}</id>
    <updated>${pubDate}</updated>
    <summary>${escapeXml(summary)}</summary>
    ${s.hn_by ? `<author><name>${escapeXml(s.hn_by)}</name></author>` : ''}
  </entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>HN HRCB — Human Rights Compatibility Bias</title>
  <subtitle>Hacker News stories evaluated against the UN Universal Declaration of Human Rights</subtitle>
  <link href="${baseUrl}/feed.xml" rel="self" />
  <link href="${baseUrl}/" />
  <id>${baseUrl}/</id>
  <updated>${updated}</updated>
  <icon>${baseUrl}/favicon.ico</icon>
${entries}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
