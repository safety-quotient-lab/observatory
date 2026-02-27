import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const baseUrl = 'https://hn-hrcb.pages.dev';

  // Static pages
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'hourly' },
    { loc: '/about', priority: '0.5', changefreq: 'monthly' },
    { loc: '/rights', priority: '0.8', changefreq: 'daily' },
    { loc: '/rights/observatory', priority: '0.7', changefreq: 'daily' },
    { loc: '/rights/articles', priority: '0.7', changefreq: 'daily' },
    { loc: '/rights/network', priority: '0.6', changefreq: 'daily' },
    { loc: '/sources', priority: '0.7', changefreq: 'daily' },
    { loc: '/domains', priority: '0.7', changefreq: 'daily' },
    { loc: '/users', priority: '0.6', changefreq: 'daily' },
    { loc: '/factions', priority: '0.6', changefreq: 'daily' },
    { loc: '/trends', priority: '0.7', changefreq: 'daily' },
    { loc: '/seldon', priority: '0.6', changefreq: 'daily' },
    { loc: '/system', priority: '0.6', changefreq: 'hourly' },
    { loc: '/models', priority: '0.5', changefreq: 'daily' },
    { loc: '/past', priority: '0.6', changefreq: 'daily' },
    { loc: '/velocity', priority: '0.6', changefreq: 'hourly' },
    { loc: '/dynamics', priority: '0.6', changefreq: 'daily' },
    { loc: '/feed.xml', priority: '0.3', changefreq: 'hourly' },
  ];

  // Article pages (0-30)
  for (let i = 0; i <= 30; i++) {
    staticPages.push({ loc: `/article/${i}`, priority: '0.6', changefreq: 'daily' });
  }

  // Evaluated stories
  const { results: stories } = await db
    .prepare(
      `SELECT hn_id, evaluated_at FROM stories
       WHERE eval_status = 'done'
       ORDER BY evaluated_at DESC
       LIMIT 5000`
    )
    .all<{ hn_id: number; evaluated_at: string | null }>();

  // Domains with evaluated stories
  const { results: domains } = await db
    .prepare(
      `SELECT DISTINCT domain FROM stories
       WHERE eval_status = 'done' AND domain IS NOT NULL
       LIMIT 1000`
    )
    .all<{ domain: string }>();

  // Users with evaluated stories
  const { results: users } = await db
    .prepare(
      `SELECT DISTINCT hn_by FROM stories
       WHERE eval_status = 'done' AND hn_by IS NOT NULL
       LIMIT 1000`
    )
    .all<{ hn_by: string }>();

  const urls = staticPages.map(
    (p) =>
      `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  );

  for (const story of stories) {
    const lastmod = story.evaluated_at ? `\n    <lastmod>${story.evaluated_at.split(' ')[0]}</lastmod>` : '';
    urls.push(
      `  <url>
    <loc>${baseUrl}/item/${story.hn_id}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
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
