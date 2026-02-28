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

### Materialize getUserIntelligence
Currently a live CTE scan over full stories table. Could create `user_aggregates`
materialized table (like `domain_aggregates`). Deferred because the query depends
on user-controlled sort/filter params — simple cachedQuery won't work,
full materialization adds a write-path step for marginal gain.

### Dark Data Surfacing

- **Transparency disclosure rates** — `td_author_identified`, `td_conflicts_disclosed`, `td_funding_disclosed` have no corpus/domain aggregate view. "Only 34% of stories identify their author."
- **Temporal framing aggregate** — `tf_primary_focus` (retrospective/present/prospective) collected per-story but never aggregated. Distribution chart on `/signals`.
- **Jargon/knowledge-level aggregate** — `cl_jargon_density`, `cl_assumed_knowledge` have no aggregate view beyond reading level tier.
- **Lite reasoning viewer** — `rater_evals.reasoning` stored but invisible. Surface on item page audit trail.
- **Methodology drift detector** — `getMethodologyDistribution()` implemented, never called. Show % of evals on current vs old methodology hash on `/status/models`.
- **Batch regression isolation** — `eval_batch_id` links evals to cron cycles. Per-batch quality view: avg HRCB, failure rate, latency.

### Structural Extensions

- **Content type browse page** — `/content-types` or content_type filter on feed. Only HN type (ask/show/job) filterable, not HRCB content type (ED/PO/LP/PR/AC/MI).
- **User API endpoints** — `/api/v1/users` + `/api/v1/user/[username]`. DB functions exist, no API surface.
- **Signals API endpoint** — `/api/v1/signals`. `getSignalOverview` exists, no API route.
- **Domain → factions cross-link** — domain page has no "See in factions" link.
- **Filtered RSS feeds** — `/feed.xml?filter=negative&domain=example.com`. Currently global-only.
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
| **Transparency disclosure rates** | "Only 34% of stories identify their author" — makes Article 19's relationship to accountability visible at corpus scale. TD is a core UDHR dimension; surfacing corpus-wide rates makes the invisible visible. **This is the mission distilled.** |
| **Comment sentiment divergence** | "The article scored +0.4 on Article 19 but commenters disagree" — directly exposes tension between editorial assessment and community perception. That's a human rights discussion happening naturally. |
| **Rights network temporal evolution** | Shows users that UDHR articles aren't independent — privacy and expression are in tension in tech. Temporal shifts reveal how discourse changes. This is rights-relationship pedagogy. |
| **Story comparison view** | "Why did this story score differently on Article 19 vs Article 12?" — the comparison forces engagement with specific provisions. The comparison *is* the pedagogy. |
| **Filtered RSS feeds** | A "rights-negative stories" RSS feed is a daily rights awareness tool. Per-article feeds ("new content affecting Article 12") are even stronger — ongoing passive pedagogy. |
| **Jargon/knowledge-level aggregate** | Directly relates to Article 26 (right to education). "Average jargon density of HN content is X" exposes who rights discourse is for — if it's all expert-level, that's exclusionary. |
| **Content type browse page** | "How do editorial articles differ from policy documents on Article 12?" — browsing by content type teaches that the medium shapes the rights message. Policy docs have high structural weight (0.7) for a reason. |

### Tier 2 — Mission-Supportive
Ideas that improve accuracy, trust, or reach — don't teach directly but make the teaching more credible.

- **Seldon event annotations** — regime changes teach that rights-alignment is dynamic; event annotations ("EU AI Act passed → Article 12 content shifted") directly connect rights to real events
- **Faction drift** — pedagogical only if framed as "this outlet's relationship with privacy rights is shifting"
- **Lobsters** — cross-community comparison ("Lobsters cares more about privacy, HN more about expression") is pedagogically interesting *if framed*
- **Temporal framing aggregate** — "80% of privacy content is retrospective (analyzing breaches) vs 5% prospective (preventing them)" — powerful with the right framing
- **Confidence-weighted consensus** / **Outlier rejection** / **Cross-model PT agreement** / **Calibration negative site** — accuracy serves the mission; better propaganda detection = better pedagogy about information manipulation (Article 19)
- **Signals API** — enables researchers and educators to programmatically access rights data; "build your own UDHR dashboard" is meta-pedagogical

### Tier 3 — Infrastructure
No direct mission connection — serve the tool, not the mission.

Analytics Engine, rate limit forecasting, velocity alerts, A/B testing, getUserIntelligence materialization, lite reasoning viewer, methodology drift detector, batch regression isolation, date-range filter, DCP staleness fix.

### Implication
Tier 1 ideas should be prioritized when they become feasible. Tier 3 should stay in IDEAS but deprioritized — they serve the tool, not the reason the tool exists. The highest-leverage single feature is **Transparency Disclosure Rates** — requires no new data collection, just aggregating existing `td_*` fields into a visible dashboard section.

---

## The Synthesis

The most powerful thing buildable from all of this is what Stephenson might call
a **"Primer"** — a self-updating, interactive document that teaches you about
the state of human rights in the tech information ecosystem by simply watching
what Hacker News reads, discusses, and votes on.
