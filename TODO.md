# TODO

Items are organized by execution horizon. Phases 2 and 3 are sequenced
prerequisites for commercialization and GitHub publishing respectively.

Completed rounds (1–4.8, 4.9, 5.5, 8) archived in git history.

---

## Current Focus

**Show HN posted.** Monitor thread, reply to comments using
`.claude/plans/hn-comments.md` (6 objection responses + 2 initial context comments).
Email Tom with HN link if not done.

Next unblocked engineering work: post-launch items below.

Remaining:
- [ ] **Write accommodation-engine blog post** — scaffold complete (`.claude/plans/exports/blog/accommodation-engine.md`).
  Prose + personal note pending. Timing: 1 week+ after Observatory Show HN.
- [ ] **Write cognitive architecture personal post** — the builder's account of their unique cognitive architecture (MEMORY.md pattern, skill system, epistemic triggers, compressed vocabulary). First-person voice (HN companion register). Show HN draft points readers to `.claude/` in repo in the meantime. Timing: after accommodation-engine post, or concurrent.
- [ ] **Write `.well-known` for distributed agents blog post** — history and development of RFC 5785 as infrastructure for multi-agent coordination; how this project uses `agent-card.json` (A2A), `agent-inbox.json` (proposals), and `agent-manifest.json` (cognitive architecture) as a three-layer pattern; the shared git access channel (`proposals/` tracked in repo); how agents coordinate across projects without a central registry. The novel angle: `.well-known` was designed for HTTP service metadata; this project uses it for agent identity + construction provenance + inter-agent communication. Scaffold at `.claude/plans/exports/blog/well-known-agents.md`.
- [ ] **Cognitive architecture maintenance** (knock analysis 2026-03-03):
  - [ ] Audit `MEMORY.md` metacognitive/factual ratio — metacognitive standards (sycophancy flags, epistemic quality, single-question rule) are higher-value entries than project facts; current ratio may be inverted
  - [ ] Add proactive gap-detection step to `/cycle` skill — after each implementation step, AI should ask "what did I not examine in the files I just changed?" before moving on
  - [ ] Update T1 trigger — add session-mode inference: AI reads first message, states inferred mode ("treating this as a reflection session — is that right?"), one confirmation question; removes ambiguity without creating user-side entry friction
- [ ] Post-launch: Run `sweep=lite_reeval&limit=50` to produce longitudinal lite-1.4→1.5 comparison data, then analyze in eval_history
- [ ] Post-launch: `sweep=upgrade_lite` — retroactively queue lite-only stories (hn_score > 50) for Claude full eval. Self-healing coverage bias. See `model-divergence-analysis.md` option 6. Justified by `findings/2026-03-02-llama-neutral-50-bias.md` (79% of Llama zeros have measurable UDHR signal per Haiku cross-validation).
- [ ] Post-launch: Lite calibration validation — run Haiku on lite prompt for ~50 stories already evaluated by both Llama models. Compare Haiku-lite vs Llama-lite to isolate prompt mode effect from model effect. If Haiku-lite ≈ Llama-lite, the 2.4× gap is prompt architecture. If Haiku-lite >> Llama-lite, there's also a model capability factor. Informs whether calibration-anchored correction (option 3 in model-divergence-analysis.md) is viable. See `findings/2026-03-02-llama-neutral-50-bias.md`.
- [ ] Post-launch: **TQ (Transparency Quotient) implementation** — replace structural channel for Llama with binary/countable verifiability indicators (author, sources, date, corrections, conflicts, methodology). Model-tiered prompt routing: Llama → editorial + TQ; Haiku → editorial + structural. Schema: new tq_* columns, prompt_mode variant. Design validated via TQ dry-run (Haiku, n=4, full range 0.00-0.80). See `findings/2026-03-02-lite-1.5-structural-audit.md`.
- [ ] Post-launch: `/.well-known/agent-inbox.json` — inter-agent proposal discovery endpoint. Build-time derived from `.claude/plans/exports/proposals/` frontmatter (status/summary/recipient/date → JSON). Pair with stub `POST /api/webmention` for push notification. Key insight from knock analysis: manifest must be a build artifact (not manually maintained) or it silently drifts. See knock analysis in session 2026-03-02.

### Architecture (evaluate later)

- [ ] **HN comments passthrough (no DB storage)** — evaluate whether comments can be served via passthrough from the HN Firebase API rather than stored in D1. The HN API exposes comment trees per item in real-time; a passthrough endpoint (`/api/story/[id]/comments` → HN Firebase) would eliminate comment storage entirely and keep data always-fresh. Trade-offs: latency on each request, no offline access, no ability to annotate/score comments, rate limit exposure. Worth evaluating after launch — depends on whether comment scoring becomes a feature goal.

### Standards (M effort — deferred)

- [ ] **OpenAPI 3.x spec** — machine-readable API description at `/api/v1/openapi.json`. ~150 lines YAML covering 8 endpoints (stories, story/[id], domains, domain/[domain], domain/[domain]/history, signals, users, user/[username]). Unlocks: auto-generated client SDKs, agent tool use, Postman/Insomnia import. Serve as prerendered static `.ts` endpoint.
- [ ] **WebSub** (W3C) — real-time push for Atom feed subscribers. Add `Link: <hub>; rel="hub"` to `/feed.xml` response, ping `hub.superfeedr.com` (free) from cron worker on new evaluations. ~30 lines in `cron.ts`. Prerequisite: none.
- [ ] **ActivityPub** (W3C) — Fediverse federation. Each evaluation → ActivityPub Note/Article. Follow `@observatory@observatory.unratified.org` from Mastodon. Requires: Actor endpoint, outbox, HTTP Signatures (RFC 9421), WebFinger integration (already done). Significant scope — worth a dedicated plan before starting.

---

## Phase 0 — Construct Validity
*Foundational measurement work. Must inform all subsequent engineering.*
*Full analysis: `construct-validity-analysis.md`*

### Perspective 1 — Psychometric Validity

HRCB is a formative composite (31 LLM-generated section scores in a single
response). It cannot be validated via factor analysis due to: (a) formative
measurement model, (b) simultaneous-generation contamination (anchoring/halo),
(c) single-domain sample (HN tech content only). See analysis doc Sections 1-2.

#### Layer 1 — Objective Foundation (no LLM, fully reproducible)

- [ ] **Transparency Quotient (TQ)** — author disclosed, sources cited, conflicts stated, corrections policy, funding model
  - Mostly binary/structural indicators; we already collect `td_*` fields
  - External validation: RDR disclosure indicators (~20 overlapping domains)

- [ ] **Accessibility Compliance (AC)** — reading level, jargon density, assumed knowledge, language availability
  - We already collect `jargon_density` and `assumed_knowledge_level`
  - External validation: WCAG conformance evaluation methodology

- [ ] **Consent Architecture Rating (CAR)** — dark pattern count, cookie consent model, ToS readability, data collection scope
  - External validation: EU DSA compliance, DPAF taxonomy (68 pattern types)

#### Layer 2 — LLM-Holistic (single scores, minimal contamination)

- [ ] **Rights Salience (RS)** — does this content engage with rights at all? Binary per-article, count of provisions touched
  - Gates HRCB validity: high HRCB + zero RS = suspect score
  - External validation: correlate with Semiotic Rights Density (Layer 1 text analysis)

- [ ] **Normative Temperature (NT)** — how far from mainstream rights consensus is this content? Low = conventional, high = challenges norms
  - Reframes evaluator task from "judge" to "thermometer" — reduces bias
  - Decomposes HRCB into "how far from norm" vs "which direction"

- [ ] **Propaganda Technique Density (PTD)** — already measured as `pt_score`
  - Multi-model agreement on technique *presence* (binary) is tractable for inter-rater reliability
  - Validate via Fleiss' kappa across models on shared stories

#### Layer 3 — Aggregate/Temporal (emerge from many evals)

- [ ] **Institutional Capture Index (ICI)** — degree editorial output aligns with funding/ownership interests
  - Emerges from domain-level patterns across many stories, not per-story
  - External validation: RDR corporate accountability, Freedom House

- [ ] **Rights Entanglement Map (REM)** — which rights systematically co-vary
  - Already partially computed (rights network Pearson correlations)
  - Property of the information ecosystem, not individual stories

- [ ] **Model Consensus Construct (MCC)** — formalize agreement/disagreement patterns
  - `getModelAgreement()` already computes pairwise Pearson r (`@internal`)
  - Maps the validity boundary: where models agree = well-defined construct territory

#### External Validation (unblocked, highest priority)

- [ ] **Convergent validity** — correlate TQ with RDR disclosure indicators on ~20 overlapping domains
- [ ] **Discriminant validity** — correlate HRCB with generic sentiment analysis; r > 0.8 = HRCB is just sentiment
- [ ] **Known-groups expansion** — expand calibration beyond 15 URLs to 50+ pre-classified domains
- [ ] **Test-retest reliability** — re-evaluate 50 stable-content stories for temporal consistency

#### HRCB Decomposition Decision

- [ ] **Decide: decompose HRCB into constituent constructs or keep as convenience composite**
  - Depends on external validation results — if HRCB correlates with sentiment (r > 0.8), decomposition is urgent
  - If HRCB passes convergent/discriminant checks, may keep as summary with caveats

### Perspective 2 — Pedagogical Effectiveness

Does the construct actually teach? Applies five tests from learning science:
produces surprise, names the invisible, encountered naturally, provokes a
rights-specific question, insight is sticky. See analysis doc Section 8.

**Tier A constructs** (pass all five tests):
- Rights Tension Signature (RTS) — "privacy vs expression, resolved toward expression"
- Editorial-Structural Coherence (ESC/SETL) — "says one thing, does another"
- Rights Salience (RS) — "42% of HN stories touch human rights"
- Rights Entanglement Map (REM) — "privacy and expression anti-correlate in tech"

**Critical finding**: RTS is the most powerful pedagogical construct but
psychometrically contaminated (Perspective 1). Resolution: restructure from
31-section scoring to 3-5 tension pair identification (categorical, not scalar).
See analysis doc Section 8g.

**Combined priority (both perspectives)**:
- HIGH: TQ, RS, NT, PTD, ESC, REM, ICI
- CONFLICT (must resolve): RTS
- Infrastructure only: MCC, SRD, AC
- Defer: NFI, DEI, HA

### Perspective 3 — Epistemic Warrant

Do we have the right to make these claims? HRCB is a "thick concept" —
simultaneously descriptive and normative. LLMs lack epistemic authority
over normative claims but can support justified belief if: transparent,
traceable (Fair Witness), revisable (multi-model), and provisional.

**Key principle**: Frame claims at the level warranted by evidence.
- Strong warrant: "34% don't name their author" (factual)
- Weak warrant: "this domain scores -0.3" (normative judgment)
- Pattern surfacing, not verdicts. Aggregate insights, not labels.

### Perspective 4 — Consequential Ethics

What happens when scores are published? Goodhart's Law, NewsGuard precedent.
- PTD and NT are consequentially dangerous (weaponizable as political labels)
- ICI implies "capture" — invites legal challenge
- Objective constructs (TQ, AC) resist gaming
- Presentation framing is critical: descriptive + methodology note = safe;
  evaluative label = dangerous

### Perspective 5 — Comparative Landscape

No existing system does article-level, UDHR-grounded, provision-specific,
E/S-dual-channel assessment. RDR is closest (UDHR-grounded) but corporate
policy only. Don't replicate bias scoring (Ad Fontes), factuality (MBFC),
or journalism quality (NewsGuard). Build what nobody else measures.

### Perspective 6 — Operational Feasibility

Most constructs are either already computed (PTD, ESC, EQ, SPA) or
computable without additional LLM cost (TQ, AC, REM, ICI, MCC, RM).
Only RS, NT, RTS require new LLM prompts. Budget: ~$2.50-4/day at HN scale.

### Perspective 7 — Personas & Jobs-to-Be-Done

Four personas: HN Browser (80%, needs badges), Domain Investigator (15%,
needs aggregates), Rights Researcher (3%, needs deep analytics), Educator
(2%, needs examples). Pedagogical funnel: exposure → curiosity → investigation
→ integration. Theory of change: repeated exposure to RS/ESC badges creates
permanent mental model shift.

### Synthesis — The Construct Set

Full 7-perspective analysis in `construct-validity-analysis.md` Section 16.

**Primary (survive all 7 perspectives):**
1. RS — Rights Salience ("does it touch rights?")
2. ESC — Editorial-Structural Coherence ("does it walk its talk?")
3. RTS — Rights Tension Signature ("which rights conflict?")
4. REM — Rights Entanglement Map ("how do rights relate across ecosystem?")

**Supporting:** TQ (objective anchor), ICI (powerful but risky)

**Infrastructure:** MCC (meta-measurement), AC (objective baseline)

**Deprioritized:** NT, PTD (consequentially dangerous), SRD (not pedagogical)

**HRCB fate:** Persists as convenience summary, no longer a standalone construct.

---

## Phase 1 — Active Engineering
*Ordered by dependency and value.*

### Round 5 — Data Expansion

- [ ] **Enhanced comments**
  - Deep comment crawling (recursive depth 2+ for high-engagement stories)
  - Comment refresh for active discussions; comment score tracking over time
  - Lightweight sentiment on top comments (lite prompt mode)
  - Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
  - Flag stories where comments strongly disagree with assessment
  - UI: divergence badge on item page, comment sentiment distribution chart

### Round 6 — User-Facing Features

- [ ] **Domain factions enhancements**
  - Faction drift tracking over time
  - Force-directed faction network visualization

- [ ] **Seldon dashboard enhancements**
  - Per-article daily trends
  - Confidence interval bands
  - Real-world event annotation layer

- [ ] **Rights network enhancements**
  - Cluster detection (community finding algorithm)
  - Temporal network evolution (how correlations shift)

### Round 7 — Platform

- [ ] **Bulk re-evaluation endpoint**
  - Re-enqueue by domain, date range, model, methodology_hash
  - Rate-limited to prevent queue flooding

---

## Phase 2 — Commercialization Gate
*Mostly unblocked. Build before publishing. Stripe + dataset license wait on Phase 3.*

- [ ] **API key system** — the commercial gate
  - D1 table: `api_keys` (key_hash, tier, quota_per_hour, owner, created_at, active)
  - Key issuance endpoint (email-based or OAuth)
  - Replace IP-based KV rate limit on `/api/v1/` with key-based quota tracking
  - A `/api-keys` management UI page

- [ ] **Stripe integration** *(needs license + publishing strategy first)*
  - Webhook handler updates `api_keys.tier` in D1
  - Tiers: free (IP-rate-limited) → research → pro → enterprise (manual)
  - `/pricing` page

- [ ] **Bulk export implementation**
  - CSV/JSONL to R2 daily snapshot (R2 bound to cron worker)
  - Implement the 501 stubs: `/api/v1/export/stories.csv`, `.jsonl`,
    `domains.csv`, `rater-evals.jsonl`

- [ ] **Full-text search endpoint**
  - `/api/v1/search` via FTS5 virtual table on D1

- ~~Dataset license decision~~ — resolved: CC BY-SA 4.0 (see Phase 3.1 audit)

---

## Phase 3 — Open Source Prep & Pedagogy Site Fork
*Full plan + audit resolutions: `.claude/plans/pedagogy-site-fork.md`*

### 3.1 — Pre-Open-Source Audit ✓

Completed 2026-03-02. All 7 decisions resolved:
- **Naming:** Observatory (`safety-quotient-lab/observatory`, `observatory.humanify.org`)
- **License:** Apache 2.0 (code) + CC BY-SA 4.0 (methodology/data)
- **Methodology:** Full transparency
- **Data model:** Full schema public, versioned API
- **API contracts:** v0+v1 read-only in pedagogy site, internal ops stay in pipeline
- **Attribution:** ATTRIBUTION.md with UDHR, academic, HN, LLM credits
- **Content/data rights:** Evaluations CC BY-SA, snapshots never published

### 3.2 — Pedagogy Site (`safety-quotient-lab/observatory`)

- [ ] **Acquire domain** — humanify.org + observatory.humanify.org (user action)
- [ ] **Acquire redirects** — article30.org, clearview TBD (user action)
- ~~Create GitHub org~~ — done: safety-quotient-lab (https://github.com/safety-quotient-lab)
- ~~Create observatory repo~~ — done: https://github.com/safety-quotient-lab/observatory
- ~~Extract methodology~~ — done: `methodology-content.ts` (CC BY-SA) + `prompts.ts` (Apache 2.0)
- ~~Verify no secrets in git history~~ — done: clean
- ~~Add license files~~ — done: LICENSE, LICENSE-DATA, ATTRIBUTION.md, SCHEMA.md
- ~~Add SPDX headers~~ — done: 114 source files (112 Apache 2.0, 1 CC BY-SA, 1 already had it)
- [ ] **Create new repo** — Astro presentation layer only, copy lib/ query subset (~20 functions)
- [ ] **HN-native design system** — light bg (#f6f6ef), pure orange (#ff6600), black text,
  zero chrome, Verdana only, ~130-line CSS. Accessibility features preserved (focus-visible,
  ARIA, skip-link, reduced-motion) — improve on HN, don't depart from its look.
- [ ] **Landing page** — today's HN stories with HRCB scores + interstitial pattern insights
  every 5-10 stories + single-line framing header
- [ ] **Core pages** — item detail, UDHR articles, search, about/methodology, support
- [ ] **Feeds + badges** — Atom feed, OPML, embeddable domain badge SVGs
- [ ] **Show HN post** — draft and publish

### 3.3 — Credentials & Publishing

- [ ] **Decide on `LICENSE`** — TBD (AGPL-3.0 was considered; not yet decided)

- [ ] **Write `README.md`** — architecture overview, what it does, screenshots, local dev setup

- [ ] **`IDEAS.md` publish decision** — keeping for now; revisit when license is decided

- [ ] **Revoke/rotate live credentials** — do immediately before `git push` to public repo
  - `ANTHROPIC_API_KEY` — revoke at console.anthropic.com → API Keys, re-issue, `wrangler secret put`
  - `OPENROUTER_API_KEY` — revoke at openrouter.ai → Keys, re-issue, `wrangler secret put`
  - `TRIGGER_SECRET` — rotate: `openssl rand -base64 32`, update `site/.dev.vars`, `wrangler secret put`
  - **Status:** never committed (`git log` verified); `.gitignore` covers `*.key` + `.dev.vars`
