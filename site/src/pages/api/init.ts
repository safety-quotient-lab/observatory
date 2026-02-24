import type { APIRoute } from 'astro';

interface HNItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  by?: string;
  time?: number;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  // Check if there are already stories
  const existing = await db
    .prepare(`SELECT COUNT(*) as cnt FROM stories`)
    .first<{ cnt: number }>();

  if (existing && existing.cnt > 0) {
    return new Response(
      JSON.stringify({ error: `Already initialized (${existing.cnt} stories)` }),
      { status: 409 }
    );
  }

  // Fetch top story IDs from HN
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `HN API error: ${res.status}` }),
      { status: 502 }
    );
  }
  const topIds = (await res.json()) as number[];

  // Fetch item details in parallel batches of 20
  let inserted = 0;
  for (let i = 0; i < topIds.length; i += 20) {
    const batch = topIds.slice(i, i + 20);
    const items = await Promise.all(
      batch.map(async (id): Promise<HNItem | null> => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          if (!r.ok) return null;
          return (await r.json()) as HNItem;
        } catch {
          return null;
        }
      })
    );

    const stmts = items
      .filter((item): item is HNItem => item !== null && item.type === 'story' && !!item.title)
      .map((item) => {
        const domain = item.url ? extractDomain(item.url) : null;
        return db
          .prepare(
            `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, eval_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
          )
          .bind(
            item.id,
            item.url || null,
            item.title || 'Untitled',
            domain,
            item.score || null,
            item.descendants || null,
            item.by || null,
            item.time || Math.floor(Date.now() / 1000)
          );
      });

    if (stmts.length > 0) {
      await db.batch(stmts);
      inserted += stmts.length;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, inserted, total: topIds.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
