# TODO

Items are organized by execution horizon. Phases 2 and 3 are sequenced
prerequisites for commercialization and GitHub publishing respectively.

Completed rounds (1–4.8, 4.9, 5.5, 8) archived in git history.

---

## Current Focus

**Construct validity work active.** Tom emailed. HN thread quiet.

Phase 0 external validation progress:
- ✓ DB hygiene — 8 gated-pending → skipped, 442 orphaned queued → failed, 107 null-editorial full evals retroactively failed + 28 re-queued
- ✓ Discriminant validity (r=0.08, PASS — `findings/2026-03-04-discriminant-validity-hrcb-vs-sentiment.md`)
- ✓ PTD inter-rater reliability (κ=0.325 fair — `findings/2026-03-04-ptd-inter-rater-reliability.md`)
- ✓ Test-retest preliminary (r=0.984, n=11, same-day — `findings/2026-03-04-test-retest-reliability-haiku-lite.md`)
- ✓ ET valence vs VADER (r=+0.376, WEAK — construct divergence explained — `findings/2026-03-04-et-cl-convergent-validity.md`)
- ✓ CL reading level vs FK (ρ=-0.063, FAIL — FK is wrong validator, CL measures domain expertise not syntax — `findings/2026-03-04-et-cl-convergent-validity.md`)

✓ TQ implementation (lite-1.6, migration 0059 — 2026-03-04)
✓ EQ/TQ external validity vs idiap/MBFC (2026-03-04, re-validated 2026-03-04): EQ ρ=+0.362 marginal (MBFC coverage ceiling ~22 — not a data volume problem), TQ ρ=-0.094 (construct mismatch confirmed at n=24 — MBFC reliability is wrong validator for per-article transparency)

Next: Phase 0 complete for core HRCB construct. Remaining open: CL validator (needs human ratings), TQ re-validation (needs NewsGuard sourcing sub-scores + ED/HR/MI content filter), EQ re-validation (needs NewsGuard — MBFC path fully exhausted at n=25). All gated on NewsGuard research access — email drafted at `.claude/plans/exports/newsguard-research-access-email.md`.

Remaining:
- [ ] **Write accommodation-engine blog post** — **MASSIVE work required** (not just a personal note). Draft at `.claude/plans/exports/blog/accommodation-engine.md` is a starting point only. Timing: defer until bandwidth exists for a full writing effort.
- [ ] **Write cognitive architecture personal post** — the builder's account of their unique cognitive architecture (MEMORY.md pattern, skill system, epistemic triggers, compressed vocabulary). First-person voice (HN companion register). Show HN draft points readers to `.claude/` in repo in the meantime. Timing: after accommodation-engine post, or concurrent.
- [ ] **Write gap-detection blog post** — full draft at `.claude/plans/exports/blog/gap-detection-csp-beacon.md`. Personal note + author review pending. Novelty: MED.
- [ ] **Flag don't fix post** — full draft at `.claude/plans/exports/blog/flag-dont-fix-instrument-failure.md`. Novelty: MED, author review before publishing.
- [ ] **Write `.well-known` for distributed agents blog post** — history and development of RFC 5785 as infrastructure for multi-agent coordination; how this project uses `agent-card.json` (A2A), `agent-inbox.json` (proposals), and `agent-manifest.json` (cognitive architecture) as a three-layer pattern; the shared git access channel (`proposals/` tracked in repo); how agents coordinate across projects without a central registry. The novel angle: `.well-known` was designed for HTTP service metadata; this project uses it for agent identity + construction provenance + inter-agent communication. Scaffold at `.claude/plans/exports/blog/well-known-agents.md`.
- [ ] Post-launch: Analyze `lite_reeval` data in eval_history — sweep dispatched (50 stories, 100 queue msgs), longitudinal lite-1.4→1.5 comparison data accumulating
- [ ] Post-launch: `sweep=upgrade_lite` — retroactively queue lite-only stories (hn_score > 50) for Claude full eval. Self-healing coverage bias. See `model-divergence-analysis.md` option 6. Justified by `findings/2026-03-02-llama-neutral-50-bias.md` (79% of Llama zeros have measurable UDHR signal per Haiku cross-validation).

### Architecture (evaluate later)

- [ ] **HN comments passthrough (no DB storage)** — evaluate whether comments can be served via passthrough from the HN Firebase API rather than stored in D1. The HN API exposes comment trees per item in real-time; a passthrough endpoint (`/api/story/[id]/comments` → HN Firebase) would eliminate comment storage entirely and keep data always-fresh. Trade-offs: latency on each request, no offline access, no ability to annotate/score comments, rate limit exposure. Worth evaluating after launch — depends on whether comment scoring becomes a feature goal.

### Standards (M effort — deferred)

- [ ] **OpenAPI 3.x spec** — machine-readable API description at `/api/v1/openapi.json`. ~150 lines YAML covering 8 endpoints (stories, story/[id], domains, domain/[domain], domain/[domain]/history, signals, users, user/[username]). Unlocks: auto-generated client SDKs, agent tool use, Postman/Insomnia import. Serve as prerendered static `.ts` endpoint. Prerequisite for API blog post.
- [ ] **Write API blog post** — announce the public REST API at `observatory.unratified.org/api/v1/`. Angles: what data is available, example queries (top negative domains, rights-under-pressure feed, TQ by domain), use cases (researchers, journalists, feed aggregators, agent tool use). Include OpenAPI link once spec is live. Publish after OpenAPI is done. Personal note + author review before publishing.
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

- ~~**Transparency Quotient (TQ)**~~ — ✓ DONE 2026-03-04. lite-1.6 schema: 5 binary indicators (tq_author/date/sources/corrections/conflicts), tq_score=sum/5, structural proxy injection. Migration 0059. External validation: TQ → RDR (unblocked — see External Validation section).

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
  - ~~Multi-model agreement on technique *presence* (binary) is tractable for inter-rater reliability~~ — **REVISED 2026-03-04**: Only `loaded_language` has usable κ (0.48). Overall κ=0.325 (fair). Haiku detects 3× more techniques than DeepSeek (45% vs 15% rate). Path forward: consolidate 17 techniques → 3 broad categories (Emotive/Logical/Rhetorical), or defer PTD to internal-only (recommended, given consequential ethics risk). See `findings/2026-03-04-ptd-inter-rater-reliability.md`.
  - ~~Validate via Fleiss' kappa across models on shared stories~~ — ✓ DONE 2026-03-04.

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

- ~~**Convergent validity (TQ → RDR)**~~ — DEFERRED. RDR domain overlap with HN corpus negligible. Used idiap/MBFC instead: TQ → MBFC reliability ρ=+0.014 (null — underpowered n=13 + construct mismatch). Re-run when n≥40 editorial-only domains. `findings/2026-03-04-eq-tq-external-validity-mbfc.md`.
- ~~**Convergent validity (EQ → Ad Fontes)**~~ — DONE 2026-03-04. Ad Fontes paywalled; used idiap/MBFC factual_reporting instead. EQ → MBFC FR: ρ=+0.362, p=0.098, n=22 — MARGINAL (direction confirmed, power-limited). `findings/2026-03-04-eq-tq-external-validity-mbfc.md`.
- ~~**Convergent validity (ET valence → VADER)**~~ — ✓ DONE 2026-03-04. r=+0.376 (WEAK). Construct divergence explained: rights-alert content is negative ET + high VADER (emotionally charged advocacy). `findings/2026-03-04-et-cl-convergent-validity.md`.
- ~~**Convergent validity (CL → FK)**~~ — ✓ DONE 2026-03-04. ρ=-0.063 (FAIL). FK is wrong validator: FK=syntactic complexity, CL=domain expertise. Technical jargon is monosyllabic → lower FK. Better validator = human ratings or Wikipedia topic level. `findings/2026-03-04-et-cl-convergent-validity.md`.
- ~~**Discriminant validity**~~ — ✓ DONE 2026-03-04. Pearson r=+0.08, R²=0.007 (0.7% shared variance). PASS. See `findings/2026-03-04-discriminant-validity-hrcb-vs-sentiment.md`.
- ~~**Known-groups expansion**~~ — ✓ DONE 2026-03-04. EP=0.348 > EN=0.205 > EC=0.137. Kruskal-Wallis H=23.4, p<0.0001. Strongest Phase 0 result. `findings/2026-03-04-known-groups-hrcb-editorial.md`.
- [ ] **Test-retest reliability** — ✓ Preliminary DONE 2026-03-04 (n=11, hours apart, r=0.984). Formal test still needed: n≥50, 1+ week gap. See `findings/2026-03-04-test-retest-reliability-haiku-lite.md`. Low priority — temporal instability not a primary concern.

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
