/**
 * Fetch current HN top stories and output SQL INSERTs for D1.
 *
 * Usage:
 *   npx tsx scripts/fetch-hn.ts > /tmp/hn-stories.sql
 *   npx wrangler d1 execute udhr-hrcb --remote --file=/tmp/hn-stories.sql
 */

function esc(s: string | null): string {
  if (s === null) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

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

async function main() {
  // Fetch top story IDs
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = (await res.json()) as number[];

  // Fetch first 60 stories
  const top60 = ids.slice(0, 60);
  const statements: string[] = [];

  console.error(`Fetching ${top60.length} stories from HN API...`);

  for (const id of top60) {
    try {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const item = (await itemRes.json()) as HNItem;

      if (!item || item.type !== 'story' || !item.title) continue;

      const domain = item.url ? extractDomain(item.url) : null;
      const evalStatus = item.url ? 'pending' : 'skipped';
      const evalError = item.url ? 'NULL' : esc('No URL (self-post)');

      statements.push(
        `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, eval_status, eval_error) VALUES (${item.id}, ${esc(item.url || null)}, ${esc(item.title)}, ${esc(domain)}, ${item.score || 'NULL'}, ${item.descendants || 'NULL'}, ${esc(item.by || null)}, ${item.time || Math.floor(Date.now() / 1000)}, '${evalStatus}', ${evalError});`
      );
    } catch (err) {
      console.error(`Failed to fetch item ${id}: ${err}`);
    }
  }

  console.error(`Generated ${statements.length} INSERT statements`);
  console.log(statements.join('\n'));
}

main().catch(console.error);
