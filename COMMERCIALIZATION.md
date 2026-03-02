# Commercialization Roadmap

Notes on potential expansion into a commercial product. The core insight: the
**dataset is a marketing surface, not the product**. The product is the live,
continuously-updated evaluation pipeline and the methodology behind it.

---

## What We're Actually Selling

### 1. API-as-a-Service (tiered access)

The `/api/v1/` endpoint already exists and has rate limiting. The natural
commercialization path is API key tiers:

| Tier | Rate | Price | Features |
|------|------|-------|----------|
| Free | 200 req/hr (IP-based) | $0 | Read access, public data only |
| Research | 2,000 req/hr | $? | API key, bulk pagination, domain history |
| Pro | 20,000 req/hr | $? | Priority SLA, webhook notifications, exports |
| Enterprise | Unlimited | Negotiated | White-label, private instance, methodology access |

**What changes architecturally:**
- D1 table: `api_keys` (key_hash, tier, quota_per_hour, owner, created_at, active)
- Replace KV IP-based rate limit with key-based quota tracking
- Stripe webhook → update `api_keys.tier` on payment events
- Key issuance flow (email-based or OAuth)

### 2. Evaluation-as-a-Service

Decouple from HN entirely. Accept any URL via API, run the HRCB evaluation
pipeline, return a scored result. The methodology + prompt + model ensemble is
the value — not the HN-specific data.

```
POST /api/eval
{ "url": "https://example.com/article" }
→ { hrcb: 0.42, eq: 0.7, classification: "positive", ... }
```

- Per-evaluation pricing (credit-based)
- Async flow: submit → poll status → retrieve result
- Could expose light eval (fast, cheap) vs full eval (slow, thorough) as tiers
- Architecture: existing queue + consumer pipeline, new API front-end

### 3. Domain Intelligence Reports

Per-domain HRCB profiles, trend history, faction membership, SETL tracking.
Useful for:

- **Brand safety** — ad buyers wanting to avoid rights-controversial placements
- **ESG research** — asset managers evaluating tech company media presence
- **Media monitoring** — NGOs tracking coverage quality across sources
- **Fact-checker tooling** — automated first-pass source credibility signal

The `domain_profile_snapshots` table (already implemented) is the data
foundation for time-series domain reports.

### 4. White-Label / B2B Licensing

Sell the methodology + pipeline to organizations that want their own private
instance:

- News organizations (internal editorial alignment tools)
- NGOs and human rights orgs (monitor their own coverage)
- Governments / IGOs (policy research, academic use)
- Legal / compliance teams (due diligence on media partners)

**Key advantage:** The HRCB methodology (dual-channel scoring, SETL, Fair
Witness, signal channels, multi-model consensus) is the differentiator — not
the HN data. A white-label deployment would evaluate their own corpus.

---

## Competitive Moat

*(Updated 2026-02-27 based on open-source strategy analysis — see GitHub
Publishing Strategy below.)*

A static dataset snapshot is not the moat. The moat is:

1. **Live pipeline** — continuously evaluated, model-agnostic, model-versioned
2. **Accumulated data** — months of multi-model evaluation history, domain temporal
   profiles, consensus scores, calibration runs. A competitor starting today has
   none of this and cannot retroactively create it.
3. **Domain temporal history** — `domain_profile_snapshots` accumulates daily;
   this time-series depth is not clonable from the code alone
4. **Multi-model consensus** — no single model is trusted; ensemble + trust
   index is a feature; replicating the validated calibration set takes months
5. **First-mover positioning** — "UDHR-based content evaluation" is an
   unoccupied niche; brand recognition and research citations compound over time
6. **Operational engineering** — 41 migrations of battle-tested distributed
   systems work (eval_queue pull model, rater health auto-disable, content gate,
   truncation weight discounting); the complexity of getting this right is a
   real barrier

**What is NOT the moat (revised):** The prompts in `prompts.ts` are not
defensible IP. They operationalize published academic frameworks (PTC-18
propaganda taxonomy, CRAAP epistemic quality, Russell's Circumplex emotional
tone) that are fully documented in the methodology `.txt` files. Keeping
`prompts.ts` private while publishing `methodology-v3.4.txt` is incoherent —
the prompt IS the methodology operationalized. It also makes open-source
contributions impossible (no one can run a local dev instance). The prompts
should be published.

---

## Dataset Strategy

The dataset being publicly accessible is a **strategic asset** for a service
business:

- Research citations → academic credibility → discovery
- Open data → trust → API adoption
- SEO surface → organic inbound

License split: **Apache 2.0 for the code, CC BY-SA 4.0 for the dataset.**
These require separate LICENSE files or headers.

A competitor cloning the code + dataset cannot replicate the live pipeline,
the model ensemble, the calibration infrastructure, or the accumulated temporal
history. The data is not the moat — but neither is code secrecy. The running
service and data depth are.

---

## GitHub Publishing Strategy

*(Added 2026-02-27 — three-phase plan based on Opus analysis)*

### Phase 1 — Repo cleanup (2–4 weeks)
- Remove raw eval output files and personal files from git history
- Add `.gitignore` entries for secrets and artifacts
- Write real `README.md` with architecture overview and screenshots
- Add `LICENSE` (Apache 2.0) and `LICENSE-DATA` (CC BY-SA 4.0)
- Verify no secrets appear in `git log --all`

### Phase 2 — Build the API moat (1–2 months)
- Implement `api_keys` D1 table and key issuance endpoint
- Replace IP-based rate limit with key-based quota on `/api/v1/`
- Ship at least one bulk export format (stories.jsonl → R2)
- Get `/data` page out of stub/501 state
- **This is the step that makes open-sourcing safe:** value shifts to the
  service and accumulated data, not the code

### Phase 3 — Publish (after Phase 2) ✅ DONE (2026-03-02)
- Open-sourced the full codebase under Apache 2.0 — **including `prompts.ts`
  and calibration files** — at `safety-quotient-lab/observatory`
- Methodology and data under CC BY-SA 4.0 (ShareAlike ensures modifications
  are shared back; no NonCommercial restriction — mission is served by
  maximum adoption, not by restricting commercial use)
- `IDEAS.md` kept private (roadmap protection)

### Why Apache 2.0 over AGPL
AGPL would deter HN community engagement and limit adoption. The moat is
the running service + accumulated data + temporal history, not the code.
Apache 2.0 maximizes adoption; CC BY-SA ShareAlike ensures methodology
modifications are shared back. A competitor starting from the code has zero
evaluation history, zero domain profiles, zero calibration runs.

---

## Implementation Sequence (when ready)

1. **API key system** — D1 `api_keys` table, key issuance endpoint, replace IP
   rate-limit with key-based quota on `/api/v1/`. This is the gate.

2. **Stripe integration** — webhook handler updates tier in D1. Simple: free →
   research → pro transitions. Enterprise is manual/negotiated.

3. **Evaluation endpoint** — `POST /api/eval` accepting arbitrary URLs. Reuses
   existing queue + consumer pipeline. Needs job ID / async polling pattern.

4. **Domain report exports** — PDF/JSON domain intelligence reports. Input:
   domain name. Output: trend chart, faction membership, SETL profile, top
   stories. Backed by `domain_profile_snapshots` + `domain_aggregates`.

5. **White-label packaging** — Terraform/wrangler config bundle for deploying a
   private instance. Methodology docs + calibration set included (not hidden).

---

## Security Before Publishing (Critical)

Before any `git push` to a public repo:

- Revoke/rotate credentials in `site/.dev.vars` (ANTHROPIC_API_KEY, OPENROUTER_API_KEY,
  TRIGGER_SECRET) before any public exposure
- Replace hardcoded Cloudflare account ID in `test-workers-ai.sh` with env var
- Replace real D1/KV resource IDs in `wrangler*.toml` with placeholder comments
- Run `git log --all --full-history -- site/.dev.vars`
  to confirm secrets were never committed; purge with `git filter-repo` if found
