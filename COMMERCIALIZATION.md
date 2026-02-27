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

**Key advantage:** The methodology (HRCB, SETL, Fair Witness, signal channels)
is the proprietary differentiator — not the HN data. A white-label deployment
would evaluate their own content corpus, not HN stories.

---

## Competitive Moat

A static dataset snapshot is not the moat. The moat is:

1. **Live pipeline** — continuously evaluated, model-agnostic, model-versioned
2. **Methodology** — HRCB + SETL + Fair Witness + DCP is the IP; prompts are not published
3. **Domain temporal history** — accumulating trend data competitors can't retroactively create
4. **Multi-model consensus** — no single model is trusted; ensemble + trust index is a feature
5. **HN-native** — the community scoring, velocity, and faction data is a unique contextual layer

---

## Dataset Strategy (see also: license section)

The dataset being publicly accessible is a **strategic asset** for a service
business:

- Research citations → academic credibility → discovery
- Open data → trust → API adoption
- SEO surface → organic inbound
- The methodology remains proprietary even if the scored data is open

A competitor cloning a static dataset snapshot cannot replicate the live
pipeline, the model ensemble, the calibration infrastructure, or the daily
domain snapshot accumulation. The data is not the moat.

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
   private instance. Methodology docs + calibration set as paid deliverable.

---

## Notes

- The current Cloudflare Workers architecture scales well for a startup; D1
  has limits at very high volume but Workers + KV handle burst traffic cheaply.
- Stripe + Cloudflare Workers integration is well-documented; no new infra needed.
- The methodology (prompts, calibration, signal architecture) should remain
  internal even if the dataset is openly licensed.
- A `/pricing` page and a `/api-keys` management UI are the main front-end
  additions needed at launch.
