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

---

## The Synthesis

The most powerful thing buildable from all of this is what Stephenson might call
a **"Primer"** — a self-updating, interactive document that teaches you about
the state of human rights in the tech information ecosystem by simply watching
what Hacker News reads, discusses, and votes on.
