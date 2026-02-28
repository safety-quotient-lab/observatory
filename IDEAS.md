# Ideas

Architectural options, deferred enhancements, and someday-maybe features.
Items here are **not committed work** — they're pre-researched options to
pull from when the time is right. Active work lives in `TODO.md`.

---

## Shipped Ideas (archive)

These were the original brainstorm. All built as of 2026-02-28.

1. **New/Best Stories feeds + Seldon Index** — `/api/v0/{new,best}stories.json`, `/seldon` with rolling averages and regime change detection
2. **Ask HN + Show HN polling** — `hn_type` filtering, dedicated feed sources
3. **User Profiles** — `hn_users` table, `/users`, `/user/[username]`, karma-HRCB correlation
4. **Score Velocity tracking** — `story_snapshots`, `/velocity`, `/dynamics`
5. **Cross-Article Correlation Network** — `/rights/network` with MST + Pearson
6. **Domain Factions** — `/factions` with 8D clustering, PCA, 3D Three.js viz
7. **SETL Temporal tracking** — `getGlobalSetlHistory()`, spike detection on `/seldon`
8. **Job Stories** — polled, stored, evaluated in pipeline
9. **Psychohistory Dashboard** — `/seldon` with rolling 7/30-day averages, regime changes

---

## Enhancement Ideas (built features, unbuilt extensions)

### Comment Sentiment Divergence *(the "fnord detector")*
Comment trees are crawled and stored (`story_comments` table) but not evaluated.
- Per-comment HRCB lean score — compare aggregate comment lean vs story HRCB
- Flag stories where comments strongly disagree with assessment
- Divergence badge on item page, comment sentiment distribution chart
- *Prerequisite*: Enhanced comments (TODO Round 5) builds the crawl depth + refresh infra first

### Faction Drift + Force-Directed Network
Factions page has static clustering. Extensions:
- Track faction membership changes over time (which domains migrate between clusters)
- Force-directed network visualization of inter-faction affinity
- "Chapel Perilous" detector — moments when a domain's SETL maximally diverges

### Seldon Confidence Bands + Event Annotations
Seldon has rolling averages and regime detection. Extensions:
- Per-article daily trend lines (not just global)
- Confidence interval bands on rolling averages
- Real-world event annotation layer (manual or automated via news API)

### Rights Network Temporal Evolution
Network page shows static correlations. Extensions:
- Cluster detection (community finding algorithm)
- Temporal network evolution — how article correlations shift over months

### Story Comparison View
`/compare/[id1]/[id2]` — side-by-side scores, classification, sentiment.
Section-by-section score differences, E vs S channel divergence.

### Structured Knowledge Graph *(rough sketch — uncertain feasibility)*

A cross-entity graph where stories, users, domains, and UDHR articles are **nodes**
and relationships between them are **edges**. Clustered by rights-category engagement
rather than editorial signal. Different from factions (domains clustered by 8D editorial
character) — this would connect *across* entity types.

**Entities (nodes):**
- Stories — HRCB fingerprint = 31-dimensional vector (one score per UDHR article section)
- Users — aggregate fingerprint = mean of their submitted stories' section scores
- Domains — aggregate fingerprint = from `domain_aggregates` (already materialized)
- UDHR Articles (1–30) — fixed nodes; become hubs for clustering

**Edges:**
- `user → story` (posted)
- `story → article` (weighted by that section's score magnitude)
- `domain → article` (avg score for that provision, already in `domain_aggregates`)
- `user → article` (derived: mean section score across all user's evaluated stories)
- `story ↔ story` (similar provision fingerprint — cosine similarity on 31D vector)

**Clustering dimension:**
Not HRCB lean (+/-) but **which articles a user/domain/story engages with most** —
a "rights fingerprint" showing that @pg mostly submits content touching Articles 17
(property) and 19 (expression) but rarely 12 (privacy) or 23 (labor). This is
orthogonal to whether they score positive or negative on those articles.

**Open questions (feasibility unknowns):**
- Do we have enough per-section data? `rater_scores` has section scores for full evals
  only (~5K stories). Lite evals have no section scores. Coverage may be too sparse.
- 31D fingerprint similarity is expensive at scale — may need dimensionality reduction
  (PCA already implemented for factions, could reuse). Or cap to top-N provisions only.
- User-level fingerprints depend on how many of a user's stories got *full* evals.
  Most users have 1-3 full evals — too sparse for a meaningful fingerprint.
- Graph storage: D1 can hold an edge table, but traversal queries are slow without
  dedicated graph DB. May need to precompute clusters and store as KV blobs.
- Incremental update path unclear — rebuilding the full graph on every eval write
  is expensive; batching via cron is feasible but introduces staleness.

**What it could produce (if feasible):**
- "Users who post privacy content" cluster — see which domains they read, which
  other rights their content touches, who else is in the cluster
- Per-UDHR-article hub page: "Article 12 ecosystem — top domains, top posters,
  most-linked companion articles"
- Story-to-story "similar rights fingerprint" recommendations on item page
- Cross-entity search: "show me users whose posting history most resembles
  the rights profile of nytimes.com"

**Relationship to existing features:**
- Factions page already does 8D clustering of domains — this extends to 31D + adds
  users and stories as node types
- Rights network already shows article-to-article correlations — this adds the
  entity layer (who/what activates those correlations)
- Primer vision (above) produces claims *from* the graph; the graph is the substrate

**Verdict: Needs feasibility study before committing.** Key gating questions:
section score coverage, user fingerprint sparsity, and graph traversal architecture
within D1/KV constraints. Worth an Opus analysis before any implementation.

---

## Architectural Options (researched, not actionable yet)

### Cloudflare Analytics Engine *(researched 2026-02-28)*
ClickHouse-backed write-once event store. Evaluated for replacing D1 time-series queries.

**Verdict: Not worth it at current scale.** Revisit when per-eval write latency
exceeds 3s or materialized table count reaches 12 (currently 7, ceiling ~10-12).

Key findings:
- Free tier fits easily: <1% writes (450/100K), 7-28% reads (700-2800/10K)
- 38% of analytics functions have good AE fit (daily velocity, latency, cost, DLQ trend)
- 47% structurally incompatible (mutable state, per-section data, cross-table JOINs)
- 3-month retention only — no all-time trends
- 20 doubles per data point — full eval needs 35 numerics, requires splitting
- KV caching already solves the read-performance problem for hot queries
- The expensive D1 queries (domain_aggregates ORDER BY) are the ones AE can't replace

### Lobsters (lobste.rs) as Data Source
Free JSON API, no auth: `/hottest.json`, `/newest.json`, `/active.json`.
Tagged content (no upvote-only ranking) gives different signal than HN.

Requirements:
- `source` column on stories (migration) — enables source-aware analytics downstream
- Cron extension for Lobsters polling
- Top-N auto-eval logic (Lobsters has lower volume than HN)
- Source-aware feed filtering on all dashboard pages

### Rate Limit Exhaustion Forecasting
Project time-to-exhaustion from rolling 1h token usage window.
Alert event when projected exhaustion <24h. Dashboard headroom widget.
No current pain point — self-throttle + credit pause handle rate limits adequately.

### Velocity Alerts + Decay Analysis
Stories hitting score threshold → alert event. Velocity decay analysis
(how fast HRCB momentum drops after initial eval). Nice-to-have analytics.

### A/B Testing Framework for Methodology
`eval_variant` column, dashboard comparing outcome distributions across variants.
Far-future platform feature — useful when methodology changes need controlled rollout.

### Materialize getUserIntelligence *(done 2026-02-28)*
`user_aggregates` table built (migration 0054). 4 refresh triggers. KV-cached per sort+minStories. `/users` and `/user/[username]` fully migrated.

### Dark Data Surfacing

- **Transparency disclosure rates** ✅ *(done 2026-02-28)* — `getTdSignalAggregates()` + Transparency Observatory on `/signals`. Non-null denominators per field.
- **Temporal framing aggregate** ✅ *(done 2026-02-28)* — `getTemporalFramingAggregates()` + Temporal Framing Observatory on `/signals`. Retrospective/present/prospective/mixed distribution + backward/forward ratio.
- **Jargon/knowledge-level aggregate** ✅ *(done 2026-02-28)* — `getComplexityAggregates()` + Content Accessibility section on `/signals`. Jargon density + assumed knowledge distributions, Article 26 framing.
- **Lite reasoning viewer** ✅ *(done 2026-02-28)* — Expandable reasoning in item page audit trail, matched by model from `rater_evals.reasoning`.
- **Methodology drift detector** ✅ *(done 2026-02-28)* — `getMethodologyDistribution()` wired to `/status/models` Measurement Integrity section. Hash, count, % on current, stale count.
- **Batch regression isolation** — `eval_batch_id` links evals to cron cycles. Per-batch quality view: avg HRCB, failure rate, latency.

### Structural Extensions

- **Content type browse page** — `/content-types` or content_type filter on feed. Only HN type (ask/show/job) filterable, not HRCB content type (ED/PO/LP/PR/AC/MI).
- **User API endpoints** — `/api/v1/users` + `/api/v1/user/[username]`. DB functions exist, no API surface.
- **Signals API endpoint** — `/api/v1/signals`. `getSignalOverview` exists, no API route.
- **Domain → factions cross-link** — domain page has no "See in factions" link.
- **Filtered RSS feeds** ✅ *(done 2026-02-28)* — `/feed.xml?filter=positive|negative|neutral&article=N&domain=...&limit=N`. OPML at `/feed/opml.xml`.
- **Date-range filter** in feed and API — only single-day (`/past?day=`) exists, no from/to range.

### Methodology Improvements

- **Confidence-weighted consensus** — use `hcb_confidence` in `updateConsensusScore` instead of flat 1.0/0.5.
- **Outlier rejection in consensus** — trimmed mean or IQR filter when 4+ models rate a story.
- **Calibration: add strongly-negative site** — EX class ranges -0.18 to -0.02. No site < -0.3 in cal set.
- **DCP staleness window fix** — KV expires at 7d, alert at 30d. Silent 8-30d gap where DCP refreshes without logging.
- **Cross-model PT agreement** — flag PT techniques only when N of M models agree (quorum filter).

---

## Mission Alignment Analysis *(2026-02-28)*

### The Mission

**Human rights pedagogy through utility.** Users learn UDHR provisions by encountering them naturally while doing something they already want to do — following tech news. The teaching is a side effect of the tool being useful.

### The Key Insight

The most mission-aligned features aggregate invisible patterns into visible statements about rights:
- "34% of stories identify their author" → transparency (Article 19)
- "Privacy and expression are anti-correlated in tech content" → rights tension
- "80% of privacy content is retrospective" → framing bias
- "Average jargon density excludes non-experts" → accessibility (Article 26)

These transform the site from "a score per story" into **a mirror for how the tech ecosystem relates to human rights.** That's the pedagogical leap.

### Tier 1 — Direct Pedagogy
Ideas that aggregate invisible patterns into visible statements about rights. Highest mission alignment.

| Idea | Why it teaches |
|---|---|
| **Transparency disclosure rates** ✅ *(done 2026-02-28)* | Transparency Observatory on `/signals`. "Only 34% of stories identify their author" — **shipped.** |
| **Comment sentiment divergence** | "The article scored +0.4 on Article 19 but commenters disagree" — directly exposes tension between editorial assessment and community perception. That's a human rights discussion happening naturally. |
| **Rights network temporal evolution** | Shows users that UDHR articles aren't independent — privacy and expression are in tension in tech. Temporal shifts reveal how discourse changes. This is rights-relationship pedagogy. |
| **Story comparison view** | "Why did this story score differently on Article 19 vs Article 12?" — the comparison forces engagement with specific provisions. The comparison *is* the pedagogy. |
| **Filtered RSS feeds** ✅ *(done 2026-02-28)* | Filter+article+domain params on `/feed.xml`, OPML index. Per-provision feeds live. |
| **Jargon/knowledge-level aggregate** ✅ *(done 2026-02-28)* | Content Accessibility on `/signals`. Jargon density + assumed knowledge distributions. Article 26 framing — **shipped.** |
| **Content type browse page** | "How do editorial articles differ from policy documents on Article 12?" — browsing by content type teaches that the medium shapes the rights message. Policy docs have high structural weight (0.7) for a reason. |

### Tier 2 — Mission-Supportive
Ideas that improve accuracy, trust, or reach — don't teach directly but make the teaching more credible.

- **Seldon event annotations** — regime changes teach that rights-alignment is dynamic; event annotations ("EU AI Act passed → Article 12 content shifted") directly connect rights to real events
- **Faction drift** — pedagogical only if framed as "this outlet's relationship with privacy rights is shifting"
- **Lobsters** — cross-community comparison ("Lobsters cares more about privacy, HN more about expression") is pedagogically interesting *if framed*
- **Temporal framing aggregate** ✅ *(done 2026-02-28)* — Temporal Framing Observatory on `/signals` — **shipped**
- **Confidence-weighted consensus** / **Outlier rejection** / **Cross-model PT agreement** / **Calibration negative site** — accuracy serves the mission; better propaganda detection = better pedagogy about information manipulation (Article 19)
- **Signals API** — enables researchers and educators to programmatically access rights data; "build your own UDHR dashboard" is meta-pedagogical

### Tier 3 — Infrastructure
No direct mission connection — serve the tool, not the mission.

Analytics Engine, rate limit forecasting, velocity alerts, A/B testing, batch regression isolation, date-range filter, DCP staleness fix.

### Implication
Tier 1 ideas should be prioritized when they become feasible. Tier 3 should stay in IDEAS but deprioritized — they serve the tool, not the reason the tool exists. Of the remaining unshipped Tier 1 items, **Story comparison view** is highest mission alignment per interaction but higher effort. **Content type browse page** is moderate effort and extends browsing pedagogy.

---

## The Synthesis

The most powerful thing buildable from all of this is what Stephenson might call
a **"Primer"** — a self-updating, interactive document that teaches you about
the state of human rights in the tech information ecosystem by simply watching
what Hacker News reads, discusses, and votes on.
