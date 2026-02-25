/**
 * Fetch current HN stories from all feeds and output SQL INSERTs for D1.
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
  text?: string;
  score?: number;
  descendants?: number;
  by?: string;
  time?: number;
}

type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'job';

const FEED_URLS: Record<Feed, string> = {
  top: 'https://hacker-news.firebaseio.com/v0/topstories.json',
  new: 'https://hacker-news.firebaseio.com/v0/newstories.json',
  best: 'https://hacker-news.firebaseio.com/v0/beststories.json',
  ask: 'https://hacker-news.firebaseio.com/v0/askstories.json',
  show: 'https://hacker-news.firebaseio.com/v0/showstories.json',
  job: 'https://hacker-news.firebaseio.com/v0/jobstories.json',
};

async function main() {
  const typeMap = new Map<number, string>();
  const feedMap = new Map<number, Set<string>>();
  const allIds = new Set<number>();

  for (const [feed, url] of Object.entries(FEED_URLS)) {
    const res = await fetch(url);
    const ids = (await res.json()) as number[];
    const slice = ids.slice(0, feed === 'top' || feed === 'new' || feed === 'best' ? 60 : ids.length);
    console.error(`${feed}: ${ids.length} total, using ${slice.length}`);

    for (const id of slice) {
      allIds.add(id);
      if (!typeMap.has(id)) {
        typeMap.set(id, feed === 'ask' ? 'ask' : feed === 'show' ? 'show' : feed === 'job' ? 'job' : 'story');
      }
      let feeds = feedMap.get(id);
      if (!feeds) { feeds = new Set(); feedMap.set(id, feeds); }
      feeds.add(feed);
    }
  }

  console.error(`\nFetching ${allIds.size} unique stories from HN API...`);

  const storyStmts: string[] = [];
  const feedStmts: string[] = [];

  for (const id of allIds) {
    try {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const item = (await itemRes.json()) as HNItem;

      if (!item || !item.title) continue;

      const domain = item.url ? extractDomain(item.url) : null;
      const hnType = typeMap.get(item.id) || 'story';
      const evalStatus = item.url ? 'pending' : (item.text && item.text.length >= 50) ? 'pending' : 'skipped';
      const evalError = evalStatus === 'skipped' ? esc('No URL and no text') : 'NULL';

      storyStmts.push(
        `INSERT OR IGNORE INTO stories (hn_id, url, title, domain, hn_score, hn_comments, hn_by, hn_time, hn_type, hn_text, eval_status, eval_error) VALUES (${item.id}, ${esc(item.url || null)}, ${esc(item.title)}, ${esc(domain)}, ${item.score || 'NULL'}, ${item.descendants || 'NULL'}, ${esc(item.by || null)}, ${item.time || Math.floor(Date.now() / 1000)}, ${esc(hnType)}, ${esc(item.text?.slice(0, 5000) || null)}, '${evalStatus}', ${evalError});`
      );

      // Feed membership records
      const feeds = feedMap.get(item.id);
      if (feeds) {
        for (const feed of feeds) {
          feedStmts.push(
            `INSERT OR IGNORE INTO story_feeds (hn_id, feed) VALUES (${item.id}, ${esc(feed)});`
          );
        }
      }
    } catch (err) {
      console.error(`Failed to fetch item ${id}: ${err}`);
    }
  }

  console.error(`Generated ${storyStmts.length} story INSERTs + ${feedStmts.length} feed INSERTs`);
  console.log(storyStmts.join('\n'));
  console.log(feedStmts.join('\n'));
}

main().catch(console.error);
