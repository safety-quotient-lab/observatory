import type { APIRoute } from 'astro';
import { corsHeaders } from '../../../../lib/api-v1';

export const prerender = false;

/** Stub: stories JSONL export — not yet implemented. */
export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ error: 'Export endpoints are not yet available. Use /api/v1/stories for paginated access.' }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    }
  );
};

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: corsHeaders() });
