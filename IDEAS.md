# Ideas: Untapped HN API & System Data

## From the HN API (untapped endpoints)

### 1. New Stories + Best Stories Feeds
`/v0/newstories.json` + `/v0/beststories.json` — Currently only fetching `topstories`. These two additional feeds give a different population: new stories catch content *before* community filtering (raw signal), and best stories represent the *curated consensus*. Comparing HRCB distributions across all three feeds would reveal whether community voting amplifies or suppresses rights-aligned content.

*Asimov / Psychohistory angle*: With all three feeds over time, build a **"Seldon Index"** — statistical prediction of how the HN hivemind's rights-alignment drifts over weeks and months. Not individual prediction, but macro-trend forecasting of collective attention.

### 2. Dedicated Ask HN + Show HN Polling
`/v0/askstories.json` + `/v0/showstories.json` — `hn_type` column already exists in the schema but these are only captured incidentally. Dedicated polling would enable comparison: do Ask HN discussions (community deliberation) score differently from Show HN (product launches)?

### 3. User Profiles
`/v0/user/<id>.json` — `karma`, `created`, `about`, `submitted` — `hn_by` is stored but the poster is never looked up. User karma, account age, and submission history are all available.

*Heinlein / Competent Man angle*: **Poster Profiles** — Does a high-karma, decade-old account submit content that scores differently than a new account? Are there "competent posters" whose submissions reliably align with (or against) specific UDHR articles? Pattern recognition on public data already in the DB.

### 4. Full Comment Trees
`/v0/item/<id>.json` — `kids` (comment tree), `text`, `dead`, `deleted` — Some comments are fetched, but the full recursive comment tree is available. Each comment has its own `score`, `by`, `kids`, `text`.

*Robert Anton Wilson / Reality Tunnels angle*: **Comment Sentiment Divergence** — When a story scores strong-positive on Article 19 (freedom of expression), do the *comments* argue for or against that framing? The story and its comment section may inhabit completely different reality tunnels. Evaluate top-level comments against the same UDHR rubric and measure the *divergence* between what content says and what the community says about it. A **"fnord detector"** — finding hidden tension between surface content and community interpretation.

### 5. Updates Feed (Changed Items & Profiles)
`/v0/updates.json` — Real-time stream of modifications. Score changes, comment additions, title edits. Track *score velocity* (how fast a story gains points) and correlate with HRCB.

*Gibson / Pattern Recognition angle*: **Cayce Pollard Mode** — Track stories whose HN score is rising fastest and evaluate them in near-real-time. The "viral moment" of a story is when it's most culturally relevant. Does high-velocity content lean differently than slow-burner content?

## From Within the System (existing data, new combinations)

### 6. Cross-Article Correlation Network
`getArticlePairStats` already computes Pearson correlations, but the *network* isn't visualized. Which UDHR articles form clusters? If Article 12 (privacy) and Article 19 (expression) are anti-correlated in HN content, that reveals how the tech community frames rights as zero-sum.

*Stephenson / Cryptonomicon angle*: **The Rights Graph** — Force-directed graph where articles are nodes and correlation strength is edge weight. Reveals the **hidden information architecture** of how rights relate to each other in practice — not in theory (where they're "universal and indivisible") but in actual tech-world content.

### 7. Domain Factions via DCP + Fingerprints
`domain_dcp` stores privacy policies, ToS, accessibility, ownership. Combined with domain fingerprints (per-article score profiles), each domain becomes a "faction" with a characteristic rights profile.

*Stackpole / BattleTech angle*: **Domain Factions** — Treat domains as factions in a political simulation. Each has a "mech loadout" (DCP + fingerprint). Compute **faction similarity** (cosine similarity between fingerprint vectors), identify **alliances** (domains that cluster together), track **faction drift** over time. Is `nytimes.com`'s rights profile converging with or diverging from `theguardian.com`?

### 8. SETL Temporal Tracking (Hypocrisy Index)
SETL (Structural-Editorial Tension Level) is already computed. A site that *says* the right things (high editorial) but *does* the wrong things (low structural) has high SETL. But SETL over time per domain isn't tracked.

*Wilson / Illuminatus! angle*: **The Hypocrisy Index** — Track domain SETL trends. When a company is in a PR crisis, does their editorial score spike (damage control) while structural stays low? Build a **"Chapel Perilous" detector** — moments when a domain's editorial and structural signals maximally diverge.

### 9. Job Stories as Corporate Rights Signals
`/v0/jobstories.json` is completely untapped. Job postings reveal what companies *value* structurally — remote work (Article 24, rest/leisure), equal opportunity language (Article 2, non-discrimination), benefits (Article 25, standard of living). Structural signals from inside the hiring process.

*Heinlein / TANSTAAFL angle*: Job postings are the one place companies can't hide behind editorial polish. The lunch is never free — what a company offers in a job post reveals what it demands. HRCB-evaluating job posts would give the most honest structural signal in the entire dataset.

### 10. Temporal Psychohistory Dashboard
`getDailyHrcb` exists but only renders a simple line chart. With accumulating daily data, build something deeper.

*Asimov / Foundation angle*: **The Seldon Dashboard** — Rolling 7/30/90-day averages of overall HRCB, per-article HRCB, per-content-type HRCB, per-domain HRCB. Detect **regime changes** (statistical breakpoints where the distribution shifts). Correlate with real-world events. When a major privacy law passes, does Article 12 content shift? Psychohistory for a microcosm — the HN readership is small enough to measure, large enough to matter.

## The Synthesis

The most powerful thing buildable from all of this is what Stephenson might call a **"Primer"** — a self-updating, interactive document that teaches you about the state of human rights in the tech information ecosystem by simply watching what Hacker News reads, discusses, and votes on.

The data is all there or one API call away.
