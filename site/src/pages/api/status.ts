/**
 * /api/status — Mesh status endpoint for observatory-agent
 *
 * Returns agent identity, transport state, and mesh connectivity info.
 * Consumed by the interagent mesh compositor at interagent.safety-quotient.dev.
 */

import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  const now = new Date().toISOString();

  const status = {
    agent_id: "observatory-agent",
    schema_version: 14,
    collected_at: now,
    totals: {
      sessions: 10,
      messages: 0,
      unprocessed: 0,
      epistemic_flags_unresolved: 0,
    },
    trust_budget: {
      budget_current: 20,
      budget_max: 20,
    },
    active_gates: [],
    peers: [
      { from_agent: "psychology-agent" },
      { from_agent: "unratified-agent" },
      { from_agent: "psq-agent" },
    ],
    schedule: {},
    heartbeat: { timestamp: now },
  };

  return new Response(JSON.stringify(status, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=30",
    },
  });
};
