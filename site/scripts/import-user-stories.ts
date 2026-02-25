#!/usr/bin/env npx tsx
/**
 * Import all stories submitted by a specific HN user into the DB.
 * Usage: npx tsx scripts/import-user-stories.ts <username>
 *
 * Fetches from HN API, filters for stories, outputs SQL for wrangler d1 execute.
 */

const USERNAME = process.argv[2];
if (!USERNAME) {
  console.error('Usage: npx tsx scripts/import-user-stories.ts <username>');
  process.exit(1);
}

interface HNUser {
  id: string;
  created: number;
  karma: number;
  about?: string;
  submitted?: number[];
}

interface HNItem {
  id: number;
  type: string;
  by?: string;
  time: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function escapeSQL(s: string): string {
  return s.replace(/'/g, "''");
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

async function main() {
  // 1. Fetch user profile
  console.error(`Fetching user profile for ${USERNAME}...`);
  const user = await fetchJson<HNUser>(`https://hacker-news.firebaseio.com/v0/user/${USERNAME}.json`);
  if (!user || !user.submitted) {
    console.error('User not found or has no submissions');
    process.exit(1);
  }
  console.error(`Found ${user.submitted.length} total submissions`);

  // 2. Fetch items in batches of 30, filter for stories
  const stories: HNItem[] = [];
  const ids = user.submitted;

  for (let i = 0; i < ids.length; i += 30) {
    const batch = ids.slice(i, i + 30);
    const items = await Promise.all(
      batch.map(id => fetchJson<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
    );

    for (const item of items) {
      if (item && item.type === 'story' && item.title && !item.deleted && !item.dead) {
        stories.push(item);
      }
    }
    console.error(`  Fetched ${Math.min(i + 30, ids.length)}/${ids.length} submissions (${stories.length} stories so far)`);
  }

  console.error(`\nTotal stories found: ${stories.length}`);

  if (stories.length === 0) {
    console.error('No stories to import.');
    process.exit(0);
  }

  // 3. Generate SQL
  const lines: string[] = [];
  for (const item of stories) {
    const domain = item.url ? extractDomain(item.url) : null;
    const title = escapeSQL(item.title || 'Untitled');
    const url = item.url ? `'${escapeSQL(item.url)}'` : 'NULL';
    const domainVal = domain ? `'${escapeSQL(domain)}'` : 'NULL';
    const score = item.score ?? 'NULL';
    const comments = item.descendants ?? 'NULL';
    const by = item.by ? `'${escapeSQL(item.by)}'` : 'NULL';
    const text = item.text ? `'${escapeSQL(item.text)}'` : 'NULL';

    lines.push(
      `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status) VALUES (${item.id}, ${url}, '${title}', ${domainVal}, ${score}, ${comments}, ${by}, ${item.time}, 'story', ${text}, 'pending');`
    );
  }

  // Also upsert the user profile
  const about = user.about ? `'${escapeSQL(user.about)}'` : 'NULL';
  lines.push(
    `INSERT OR REPLACE INTO hn_users (username, karma, created, about, cached_at) VALUES ('${escapeSQL(user.id)}', ${user.karma}, ${user.created}, ${about}, datetime('now'));`
  );

  // Output SQL to stdout
  console.log(lines.join('\n'));
  console.error(`\nGenerated ${lines.length} SQL statements. Pipe to wrangler d1 execute.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
