import type { APIRoute } from 'astro';
import { updateEventTriage } from '../../../../lib/events';
import { writeDb } from '../../../../lib/db-utils';

export const POST: APIRoute = async ({ params, request, locals }) => {
  // Auth: require TRIGGER_SECRET or same-origin
  const triggerSecret = locals.runtime.env.TRIGGER_SECRET;
  const auth = request.headers.get('Authorization') ?? '';
  const origin = request.headers.get('Origin') || '';
  const siteHost = new URL(request.url).host;
  const isSameOrigin = origin ? new URL(origin).host === siteHost : false;

  if (triggerSecret && !isSameOrigin && auth !== `Bearer ${triggerSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid event ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { investigated?: boolean | null; resolved?: boolean | null };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = writeDb(locals.runtime.env.DB);
  try {
    await updateEventTriage(db, id, body);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
