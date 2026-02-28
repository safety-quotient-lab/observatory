import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const baseUrl = 'https://hn-hrcb.pages.dev';
  const buildDate = new Date().toISOString().slice(0, 10);

  // Static pages with priority tiers
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'hourly' },
    { loc: '/signals', priority: '0.8', changefreq: 'hourly' },
    { loc: '/about', priority: '0.5', changefreq: 'monthly' },
    { loc: '/rights', priority: '0.8', changefreq: 'daily' },
    { loc: '/rights/observatory', priority: '0.7', changefreq: 'daily' },
    { loc: '/rights/articles', priority: '0.7', changefreq: 'daily' },
    { loc: '/rights/network', priority: '0.6', changefreq: 'daily' },
    { loc: '/sources', priority: '0.8', changefreq: 'daily' },
    { loc: '/domains', priority: '0.7', changefreq: 'daily' },
    { loc: '/users', priority: '0.6', changefreq: 'daily' },
    { loc: '/factions', priority: '0.6', changefreq: 'daily' },
    { loc: '/trends', priority: '0.7', changefreq: 'daily' },
    { loc: '/seldon', priority: '0.6', changefreq: 'daily' },
    { loc: '/status', priority: '0.6', changefreq: 'hourly' },
    { loc: '/status/models', priority: '0.5', changefreq: 'daily' },
    { loc: '/status/events', priority: '0.5', changefreq: 'hourly' },
    { loc: '/past', priority: '0.6', changefreq: 'daily' },
    { loc: '/velocity', priority: '0.6', changefreq: 'hourly' },
    { loc: '/dynamics', priority: '0.6', changefreq: 'daily' },
    { loc: '/feed.xml', priority: '0.3', changefreq: 'hourly' },
  ];

  // Article pages (0-30)
  for (let i = 0; i <= 30; i++) {
    staticPages.push({ loc: `/article/${i}`, priority: '0.6', changefreq: 'daily' });
  }

  // Evaluated stories with hn_score for priority tiering
  const { results: stories } = await db
    .prepare(
      `SELECT hn_id, evaluated_at, hn_score FROM stories
       WHERE eval_status = 'done'
       ORDER BY evaluated_at DESC
       LIMIT 5000`
    )
    .all<{ hn_id: number; evaluated_at: string | null; hn_score: number | null }>();

  // Domains with 2+ evaluated stories
  const { results: domains } = await db
    .prepare(
      `SELECT domain FROM stories
       WHERE eval_status = 'done' AND domain IS NOT NULL
       GROUP BY domain
       HAVING COUNT(*) >= 2
       LIMIT 1000`
    )
    .all<{ domain: string }>();

  // Users with 2+ evaluated stories
  const { results: users } = await db
    .prepare(
      `SELECT hn_by FROM stories
       WHERE eval_status = 'done' AND hn_by IS NOT NULL
       GROUP BY hn_by
       HAVING COUNT(*) >= 2
       LIMIT 1000`
    )
    .all<{ hn_by: string }>();

  const urls = staticPages.map(
    (p) =>
      `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <lastmod>${buildDate}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  );

  for (const story of stories) {
    const lastmod = story.evaluated_at ? `\n    <lastmod>${story.evaluated_at.split(' ')[0]}</lastmod>` : '';
    // High HN score stories get higher priority
    const priority = (story.hn_score ?? 0) >= 200 ? '0.7' : '0.6';
    urls.push(
      `  <url>
    <loc>${baseUrl}/item/${story.hn_id}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`
    );
  }

  for (const { domain } of domains) {
    urls.push(
      `  <url>
    <loc>${baseUrl}/domain/${domain}</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>`
    );
  }

  for (const { hn_by } of users) {
    urls.push(
      `  <url>
    <loc>${baseUrl}/user/${hn_by}</loc>
    <changefreq>daily</changefreq>
    <priority>0.4</priority>
  </url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
