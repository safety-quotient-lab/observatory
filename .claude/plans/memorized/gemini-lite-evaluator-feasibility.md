# Gemini Lite Evaluator Feasibility — 2026-03-04

## Verdict: FEASIBLE (supplement, not replace Workers AI)

## Models
| Model ID | Generation | Free Tier |
|---|---|---|
| `gemini-2.5-flash-lite` | 2.5 | Stable — 15 RPM, 1,000 RPD, 250K TPM |
| `gemini-3.1-flash-lite-preview` | 3.1 | Preview (released 2026-03-03) — limits TBD, likely similar |

## Free Tier Limits (post-Dec 2025 cuts)
- 1,000 requests/day (RPD) — resets midnight Pacific
- 15 requests/minute (RPM)
- 250,000 tokens/minute (TPM)
- Per project, not per key

## Structured JSON: YES
- `responseMimeType: "application/json"` + `responseJsonSchema` in generationConfig
- Supports object, array, string, number, integer, boolean, enum, min/max, required
- Good fit for lite eval schema

## CF Workers Compatibility
- Standard `fetch()` to `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Auth: `x-goog-api-key` header (already have GOOGLE_API_KEY)
- **Geo-restriction risk**: Google checks origin IP. CF Workers run on nearest PoP. If PoP is in restricted region → `FAILED_PRECONDITION`. Mitigable with Durable Objects locationHint or colo-checking. US-based accounts likely fine.

## Integration Strategy
- Add as 3rd lite provider alongside Workers AI (Llama 4 Scout + Llama 3.3 70B)
- Use `gemini-2.5-flash-lite` (stable) initially
- 1,000 RPD ≈ fits daily lite volume but no headroom for surges
- Workers AI remains primary free lite provider (no daily limit)
- Gemini adds model diversity for consensus scoring

## Implementation Scope (M effort)
1. New consumer worker: `consumer-gemini.ts` (or extend consumer-openrouter pattern)
2. New wrangler config: `wrangler.consumer-gemini.toml`
3. New queue: `hrcb-eval-gemini`
4. Add to MODEL_REGISTRY in models.ts
5. Adapt lite prompt for Gemini's JSON schema enforcement
6. Rate limit handling: KV-based daily counter (1,000 RPD)
7. Geo-restriction guard: check `request.cf.colo` or use Durable Object

## Source
Gemini exchange 2026-03-04 + web research. Model names verified against ai.google.dev docs.
