# Human Rights Observatory

**Real-time empirical monitoring of Hacker News tech discourse against the Universal Declaration of Human Rights.**

Every day, the Observatory evaluates Hacker News stories against all 31 UDHR provisions — not as a compliance audit, but as a measurement of directional lean. Each story gets a per-provision breakdown showing which rights it touches, whether content affirms or undercuts them, and whether the site hosting it practices what it publishes.

**Live site:** [observatory.unratified.org](https://observatory.unratified.org)

---

## What it measures

- **HRCB (Human Rights Compatibility Bias)** — directional lean of content relative to UDHR provisions. Scale: −1.0 (hostile) to +1.0 (affirming).
- **Editorial channel (E)** — what the content says
- **Structural channel (S)** — what the site does (privacy policy, access model, consent architecture)
- **SETL (Structural-Editorial Tension Level)** — "says one thing, does another" — divergence between E and S
- **Fair Witness** — every score separates `witness_facts` (directly observable) from `witness_inferences` (interpretive). No black boxes.
- **9 supplementary signals** — epistemic quality, propaganda technique detection (PTC-18), solution orientation, emotional tone, stakeholder representation, temporal framing, geographic scope, complexity level, transparency/disclosure

---

## Architecture

Cloudflare Workers + Astro 5 SSR + D1 + KV + R2 + Queues.

```
Cron Worker (1min) → Queues → 3 Provider-Specific Consumer Workers → D1 + R2
                                        ↓ (on failure)
                                  DLQ Worker → dlq_messages table
```

- **Models:** Multi-model LLM consensus (Anthropic Claude, OpenRouter, Cloudflare Workers AI)
- **Storage:** D1 (SQLite), KV (cache), R2 (content snapshots)
- **Frontend:** Astro SSR on Cloudflare Pages
- **API:** Public REST API at `/api/v1/` — stories, domains, users, signals, badges

See [`site/CLAUDE.md`](site/CLAUDE.md) for full architecture, storage schema, and deployment instructions.

---

## Public API

All endpoints are public, CORS-enabled, and rate-limited to 200 requests/hour per IP.

| Endpoint | Description |
|---|---|
| `GET /api/v1/stories` | Paginated evaluated story feed with HRCB scores |
| `GET /api/v1/story/{id}` | Single story with per-model rater evaluations |
| `GET /api/v1/domains` | Domain signal aggregates |
| `GET /api/v1/domain/{domain}` | Domain profile with recent stories |
| `GET /api/v1/signals` | Corpus-wide signal aggregates (transparency, accessibility, temporal framing) |
| `GET /api/v1/users` | User signal aggregates |
| `GET /api/v1/badge/{domain}.svg` | Embeddable domain HRCB badge |

---

## Methodology

The evaluation methodology is versioned and documented:

- Current canonical: [`methodology-v3.4.txt`](methodology-v3.4.txt)
- LLM prompt: [`methodology-v3.1.prompt.md`](methodology-v3.1.prompt.md)
- Calibration set: [`calibration-v3.1-set.txt`](calibration-v3.1-set.txt)

The methodology is designed around the **Fair Witness standard**: every scored section must separate what was directly observed from what was inferred. Evaluations that conflate the two are flagged and down-weighted in consensus scoring.

---

## Relation to ICESCR

Several UDHR provisions (Articles 22–27) correspond to economic, social, and cultural rights also covered by the International Covenant on Economic, Social and Cultural Rights (ICESCR) — ratified by 173 nations, signed but never ratified by the U.S. in 1977. The Observatory provides empirical grounding for policy work at [unratified.org](https://unratified.org).

---

## License

Apache 2.0. See [`LICENSE`](LICENSE).

Data (evaluated story scores, domain profiles, rater evaluations) is available under CC BY-SA 4.0. See [`LICENSE-DATA`](LICENSE-DATA).

Contributions welcome. See [`CLAUDE.md`](CLAUDE.md) for architecture and [`site/CLAUDE.md`](site/CLAUDE.md) for frontend/pipeline development guidance.
