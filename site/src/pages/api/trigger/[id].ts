// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { fetchUrlContent, callClaude } from '../../../lib/evaluate';
import { writeRaterEvalResult } from '../../../lib/eval-write';
import { logEvent } from '../../../lib/events';
import { writeDb } from '../../../lib/db-utils';

export const POST: APIRoute = async ({ params, locals, request }) => {
  const hnId = parseInt(params.id!, 10);
  if (isNaN(hnId)) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const triggerSecret = locals.runtime.env.TRIGGER_SECRET;
  const auth = request.headers.get('Authorization');
  const origin = request.headers.get('Origin') || '';
  const siteHost = new URL(request.url).host;
  const isSameOrigin = origin ? new URL(origin).host === siteHost : false;

  // Allow same-origin requests (browser) OR valid Bearer token (external/CLI)
  if (triggerSecret && !isSameOrigin && auth !== `Bearer ${triggerSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const db = writeDb(locals.runtime.env.DB);
  const apiKey = locals.runtime.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const story = await db
    .prepare(`SELECT hn_id, url, title, hn_text, eval_status FROM stories WHERE hn_id = ?`)
    .bind(hnId)
    .first<{ hn_id: number; url: string | null; title: string; hn_text: string | null; eval_status: string }>();

  if (!story) {
    return new Response(JSON.stringify({ error: 'Story not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (story.eval_status === 'done') {
    return new Response(JSON.stringify({ error: 'Already evaluated' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  if (story.eval_status === 'evaluating') {
    return new Response(JSON.stringify({ error: 'Already in progress' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
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

      await logEvent(db, { hn_id: hnId, event_type: 'trigger', severity: 'info', message: `Manual trigger started`, details: { url: evalUrl, is_self_post: isSelfPost } });

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

          if (pageContent.length < 50) {
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
        const evalStartMs = Date.now();
        const evalCall = await callClaude(apiKey, evalUrl, pageContent, isSelfPost);
        const evalDurationMs = Date.now() - evalStartMs;

        send('status', { step: 'writing', message: 'Writing results...' });

        // Write results to D1 (rater tables + stories promotion)
        await writeRaterEvalResult(
          db, hnId, evalCall.result, evalCall.model, 'anthropic',
          evalCall.promptHash, null, evalCall.inputTokens, evalCall.outputTokens,
        );

        await logEvent(db, { hn_id: hnId, event_type: 'eval_success', severity: 'info', message: `Trigger eval done: ${evalCall.result.aggregates.classification} (${evalCall.result.aggregates.weighted_mean.toFixed(2)})`, details: { classification: evalCall.result.aggregates.classification, weighted_mean: evalCall.result.aggregates.weighted_mean, model: evalCall.model, duration_ms: evalDurationMs } });

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
        await logEvent(db, { hn_id: hnId, event_type: 'eval_failure', severity: 'error', message: `Trigger eval failed: ${String(err).slice(0, 200)}`, details: { error: String(err).slice(0, 500) } });
        send('error', { error: 'Evaluation failed' });
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
