import type { APIRoute } from 'astro';
import { formatScore } from '../lib/colors';
import { readDb } from '../lib/db-utils';

interface FeedStory {
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
  hcb_theme_tag: string | null;
  hcb_sentiment_tag: string | null;
  hcb_executive_summary: string | null;
  eq_score: number | null;
  consensus_score: number | null;
  fw_ratio: number | null;
  section?: string | null;
  section_score?: number | null;
  section_evidence?: string | null;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Build a single Atom <entry> */
function buildEntry(s: FeedStory, baseUrl: string, updated: string, articleLabel?: string): string {
  const isLiteOnly = s.hcb_weighted_mean == null && s.hcb_editorial_mean != null;
  const score = isLiteOnly ? '~lite' : formatScore(s.hcb_weighted_mean);
  const numericScore = s.hcb_weighted_mean ?? s.hcb_editorial_mean;
  const link = `${baseUrl}/item/${s.hn_id}`;
  const pubDate = s.evaluated_at ? new Date(s.evaluated_at).toISOString() : updated;

  const parts: string[] = [];
  if (s.hcb_executive_summary) {
    parts.push(s.hcb_executive_summary);
    parts.push('—');
  }
  parts.push(`HRCB: ${formatScore(numericScore)} (${s.hcb_classification || 'Unknown'})`);
  if (articleLabel && s.section_score != null) {
    parts.push(`${articleLabel}: ${formatScore(s.section_score)} [${s.section_evidence || 'ND'}]`);
  }
  if (s.hcb_sentiment_tag) parts.push(`Sentiment: ${s.hcb_sentiment_tag}`);
  if (s.hcb_theme_tag) parts.push(`Theme: ${s.hcb_theme_tag}`);
  if (!isLiteOnly && s.hcb_signal_sections != null) {
    parts.push(`${s.hcb_signal_sections}/31 provisions`);
  }
  parts.push(s.domain || 'self-post');
  const summary = parts.join('. ').replace(/\.\./g, '.');

  const categories: string[] = [];
  if (s.hcb_theme_tag) categories.push(s.hcb_theme_tag);
  if (s.hcb_sentiment_tag) categories.push(s.hcb_sentiment_tag);
  if (s.hcb_classification) categories.push(s.hcb_classification);
  if (articleLabel) categories.push(articleLabel);
  const categoryXml = categories.map(c =>
    `    <category term="${escapeXml(c)}" />`
  ).join('\n');

  return `  <entry>
    <title>${escapeXml(`[${score}] ${s.title}`)}</title>
    <link href="${escapeXml(link)}" />
    <id>${escapeXml(link)}</id>
    <updated>${pubDate}</updated>
    <summary>${escapeXml(summary)}</summary>
${categoryXml ? categoryXml + '\n' : ''}    ${s.hn_by ? `<author><name>${escapeXml(s.hn_by)}</name></author>` : ''}
  </entry>`;
}

/** Build the full Atom feed XML */
function buildFeed(
  stories: FeedStory[],
  baseUrl: string,
  title: string,
  subtitle: string,
  selfUrl: string,
  articleLabel?: string
): string {
  const updated = stories.length > 0 && stories[0].evaluated_at
    ? new Date(stories[0].evaluated_at).toISOString()
    : new Date().toISOString();

  const entries = stories.map(s => buildEntry(s, baseUrl, updated, articleLabel)).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(subtitle)}</subtitle>
  <link href="${escapeXml(selfUrl)}" rel="self" />
  <link href="${baseUrl}/" />
  <id>${escapeXml(selfUrl)}</id>
  <updated>${updated}</updated>
  <icon>${baseUrl}/favicon.ico</icon>
${entries}
</feed>`;
}

/**
 * Filtered RSS feed. Supports query parameters:
 *
 *   ?filter=positive|negative|neutral  — filter by HRCB classification
 *   ?article=N                         — only stories with a score on UDHR Article N (0=Preamble)
 *   ?domain=example.com                — only stories from a specific domain
 *   ?limit=N                           — entries per feed (default 50, max 100)
 *
 * Combine freely: /feed.xml?filter=negative&article=12 → "negative stories affecting Article 12"
 */
export const GET: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env as { DB: D1Database };
  const db = readDb(env.DB);
  const baseUrl = 'https://hn-hrcb.pages.dev';

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter');      // positive | negative | neutral
  const articleParam = url.searchParams.get('article'); // 0-30
  const domain = url.searchParams.get('domain');
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 100);

  // Validate article param
  const articleNum = articleParam !== null ? parseInt(articleParam, 10) : null;
  if (articleNum !== null && (isNaN(articleNum) || articleNum < 0 || articleNum > 30)) {
    return new Response('Invalid article number (0-30)', { status: 400 });
  }

  const section = articleNum !== null
    ? (articleNum === 0 ? 'Preamble' : `Article ${articleNum}`)
    : null;

  // Build dynamic query
  let stories: FeedStory[];

  if (section) {
    // Per-article feed: JOIN rater_scores for section-level data
    const conditions: string[] = [
      `s.eval_status = 'done'`,
      `(s.hcb_weighted_mean IS NOT NULL OR s.hcb_editorial_mean IS NOT NULL)`,
      `sc.section = ?1`,
      `sc.final IS NOT NULL`,
      `sc.eval_model = s.eval_model`,
    ];
    const bindings: (string | number)[] = [section];
    let bindIdx = 2;

    if (filter === 'positive') {
      conditions.push(`COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) > 0.05`);
    } else if (filter === 'negative') {
      conditions.push(`COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) < -0.05`);
    } else if (filter === 'neutral') {
      conditions.push(`COALESCE(s.hcb_weighted_mean, s.hcb_editorial_mean) BETWEEN -0.05 AND 0.05`);
    }
    if (domain) {
      conditions.push(`s.domain = ?${bindIdx}`);
      bindings.push(domain);
      bindIdx++;
    }

    const sql = `SELECT s.hn_id, s.title, s.url, s.domain, s.hcb_weighted_mean, s.hcb_editorial_mean,
                        s.hcb_classification, s.hcb_signal_sections, s.hcb_nd_count, s.evaluated_at,
                        s.hn_by, s.hn_score, s.content_type, s.hcb_theme_tag, s.hcb_sentiment_tag,
                        s.hcb_executive_summary, s.eq_score, s.consensus_score, s.fw_ratio,
                        sc.section, sc.final AS section_score, sc.evidence AS section_evidence
                 FROM rater_scores sc
                 JOIN stories s ON s.hn_id = sc.hn_id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY s.evaluated_at DESC
                 LIMIT ?${bindIdx}`;
    bindings.push(limit);

    const stmt = db.prepare(sql);
    const { results } = await stmt.bind(...bindings).all<FeedStory>();
    stories = results;
  } else {
    // Standard feed (no article filter)
    const conditions: string[] = [
      `eval_status = 'done'`,
      `(hcb_weighted_mean IS NOT NULL OR hcb_editorial_mean IS NOT NULL)`,
    ];
    const bindings: (string | number)[] = [];
    let bindIdx = 1;

    if (filter === 'positive') {
      conditions.push(`COALESCE(hcb_weighted_mean, hcb_editorial_mean) > 0.05`);
    } else if (filter === 'negative') {
      conditions.push(`COALESCE(hcb_weighted_mean, hcb_editorial_mean) < -0.05`);
    } else if (filter === 'neutral') {
      conditions.push(`COALESCE(hcb_weighted_mean, hcb_editorial_mean) BETWEEN -0.05 AND 0.05`);
    }
    if (domain) {
      conditions.push(`domain = ?${bindIdx}`);
      bindings.push(domain);
      bindIdx++;
    }

    const sql = `SELECT hn_id, title, url, domain, hcb_weighted_mean, hcb_editorial_mean,
                        hcb_classification, hcb_signal_sections, hcb_nd_count, evaluated_at,
                        hn_by, hn_score, content_type, hcb_theme_tag, hcb_sentiment_tag,
                        hcb_executive_summary, eq_score, consensus_score, fw_ratio
                 FROM stories
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY evaluated_at DESC
                 LIMIT ?${bindIdx}`;
    bindings.push(limit);

    const stmt = db.prepare(sql);
    const { results } = await stmt.bind(...bindings).all<FeedStory>();
    stories = results;
  }

  // Build feed metadata
  const titleParts = ['HN HRCB'];
  const subtitleParts: string[] = [];
  let selfUrl = `${baseUrl}/feed.xml`;
  const params: string[] = [];

  if (filter) {
    titleParts.push(`${filter} stories`);
    subtitleParts.push(`filtered to ${filter} HRCB classification`);
    params.push(`filter=${filter}`);
  }
  if (section) {
    titleParts.push(section);
    subtitleParts.push(`stories affecting UDHR ${section}`);
    params.push(`article=${articleNum}`);
  }
  if (domain) {
    titleParts.push(domain);
    subtitleParts.push(`from ${domain}`);
    params.push(`domain=${encodeURIComponent(domain)}`);
  }
  if (params.length > 0) {
    selfUrl += '?' + params.join('&');
  }

  const title = titleParts.length === 1
    ? 'HN HRCB — Human Rights Compatibility Bias'
    : titleParts.join(' — ');
  const subtitle = subtitleParts.length === 0
    ? 'Hacker News stories evaluated against the UN Universal Declaration of Human Rights'
    : `Hacker News stories ${subtitleParts.join(', ')}`;

  const xml = buildFeed(stories, baseUrl, title, subtitle, selfUrl, section ?? undefined);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
