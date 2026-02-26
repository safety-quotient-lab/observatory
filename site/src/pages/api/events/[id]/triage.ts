import type { APIRoute } from 'astro';
import { updateEventTriage } from '../../../../lib/events';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Invalid event ID' }), { status: 400 });
  }

  let body: { investigated?: boolean | null; resolved?: boolean | null };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const db = locals.runtime.env.DB;
  try {
    await updateEventTriage(db, id, body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
