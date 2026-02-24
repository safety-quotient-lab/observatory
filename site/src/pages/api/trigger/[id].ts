import type { APIRoute } from 'astro';
import { fetchUrlContent, callClaude, writeEvalResult } from '../../../lib/evaluate';

export const POST: APIRoute = async ({ params, locals }) => {
  const hnId = parseInt(params.id!, 10);
  if (isNaN(hnId)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
  }

  const db = locals.runtime.env.DB;
  const apiKey = locals.runtime.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
  }

  const story = await db
    .prepare(`SELECT hn_id, url, title, hn_text, eval_status FROM stories WHERE hn_id = ?`)
    .bind(hnId)
    .first<{ hn_id: number; url: string | null; title: string; hn_text: string | null; eval_status: string }>();

  if (!story) {
    return new Response(JSON.stringify({ error: 'Story not found' }), { status: 404 });
  }

  if (story.eval_status === 'done') {
    return new Response(JSON.stringify({ error: 'Already evaluated' }), { status: 409 });
  }

  if (story.eval_status === 'evaluating') {
    return new Response(JSON.stringify({ error: 'Already in progress' }), { status: 409 });
  }

  // Stream progress via SSE
  const encoder = new TextEncoder();
  const isSelfPost = !story.url && !!story.hn_text;
  const evalUrl = story.url || `https://news.ycombinator.com/item?id=${hnId}`;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      // Mark as evaluating
      await db
        .prepare(`UPDATE stories SET eval_status = 'evaluating', eval_error = NULL WHERE hn_id = ?`)
        .bind(hnId)
        .run();

      try {
        let pageContent: string;

        if (isSelfPost) {
          // Self-post: use hn_text directly, no fetch needed
          pageContent = `${story.title}\n\n${story.hn_text}`;
          send('status', { step: 'evaluating', message: `Self-post — using HN text (${pageContent.length.toLocaleString()} chars)...` });
        } else {
          send('status', { step: 'fetching', message: `Fetching ${evalUrl}...` });

          // Skip binary content
          if (evalUrl.includes('.pdf') || evalUrl.includes('.zip') || evalUrl.includes('.tar')) {
            await db
              .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = 'Binary/unsupported content type' WHERE hn_id = ?`)
              .bind(hnId)
              .run();
            send('error', { error: 'Unsupported content type' });
            controller.close();
            return;
          }

          // Fetch page content
          try {
            pageContent = await fetchUrlContent(evalUrl);
          } catch (err) {
            await db
              .prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`)
              .bind(`Fetch failed: ${err}`.slice(0, 500), hnId)
              .run();
            send('error', { error: `Failed to fetch URL: ${err}` });
            controller.close();
            return;
          }

          if (pageContent.length < 100) {
            await db
              .prepare(`UPDATE stories SET eval_status = 'skipped', eval_error = 'Page content too short' WHERE hn_id = ?`)
              .bind(hnId)
              .run();
            send('error', { error: 'Page content too short' });
            controller.close();
            return;
          }

          send('status', { step: 'evaluating', message: `Calling Claude (${pageContent.length.toLocaleString()} chars)...` });
        }

        // Call Claude for evaluation
        const evalCall = await callClaude(apiKey, evalUrl, pageContent, isSelfPost);

        send('status', { step: 'writing', message: 'Writing results...' });

        // Write results to D1
        await writeEvalResult(db, hnId, evalCall);

        send('done', {
          hn_id: hnId,
          score: evalCall.result.aggregates.weighted_mean,
          classification: evalCall.result.aggregates.classification,
        });
      } catch (err) {
        await db
          .prepare(`UPDATE stories SET eval_status = 'failed', eval_error = ? WHERE hn_id = ?`)
          .bind(`${err}`.slice(0, 500), hnId)
          .run();
        send('error', { error: `${err}` });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
