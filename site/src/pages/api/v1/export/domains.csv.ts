// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { corsHeaders } from '../../../../lib/api-v1';

export const prerender = false;

/** Stub: domains CSV export — not yet implemented. */
export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ error: 'Export endpoints are not yet available. Use /api/v1/domains for paginated access.' }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    }
  );
};

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: corsHeaders() });
