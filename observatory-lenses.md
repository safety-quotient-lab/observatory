# Observatory Lens Inventory

Comprehensive catalog of factors the Human Rights Observatory could surface,
organized by distance from the current core (sigma levels). Each factor
includes: what it measures, which persona it serves, whether infrastructure
already exists, and the UDHR connection (if any).

Generated 2026-03-02. Reference for product direction, not a commitment.

---

## Sigma 1 — Already measured, needs reframing only

These exist in the 52-column `stories` table today. Zero new infrastructure.

| # | Lens | What it measures | Key columns | Persona | UDHR link |
|---|------|-----------------|-------------|---------|-----------|
| 1 | **Transparency** | Author disclosure, conflicts of interest, funding sources | `td_score`, `td_author_identified`, `td_conflicts_disclosed`, `td_funding_disclosed` | Source Evaluator, Media Critic | Art. 19 (informed expression) |
| 2 | **Persuasion** | 18 propaganda techniques (PTC-18 taxonomy) | `pt_flag_count`, `pt_flags_json`, `pt_score` | Media Critic, HN Browser | Art. 19/26 (manipulation vs. informed participation) |
| 3 | **Accessibility** | Jargon density, assumed knowledge, reading level | `cl_jargon_density`, `cl_assumed_knowledge`, `cl_reading_level` | Accessibility Advocate, Educator | Art. 26 (right to education) |
| 4 | **Temporal Framing** | Retrospective/present/prospective focus, time horizon | `tf_primary_focus`, `tf_time_horizon` | Ecosystem Observer, Researcher | Art. 28 (forward-looking social order) |
| 5 | **Stakeholder Voice** | Who speaks, who is spoken about, voice balance, power axis | `sr_score`, `sr_who_speaks`, `sr_who_spoken_about`, `sr_perspective_count`, `sr_voice_balance` | Researcher, Educator | Art. 21 (political participation requires voice) |
| 6 | **Epistemic Quality** | Source quality, evidence reasoning, uncertainty handling, claim density | `eq_score`, `eq_source_quality`, `eq_evidence_reasoning`, `eq_uncertainty_handling`, `eq_claim_density` | Source Evaluator, Media Critic | Art. 19 (quality of information) |
| 7 | **Emotional Tone** | Primary tone + valence/arousal/dominance (VAD model) | `et_primary_tone`, `et_valence`, `et_arousal`, `et_dominance` | Media Critic, Researcher | Art. 19 (emotional manipulation vs. informed opinion) |
| 8 | **Geographic Scope** | Local/national/regional/global, specific regions | `gs_scope`, `gs_regions_json` | Ecosystem Observer, Researcher | Art. 2 (non-discrimination includes geographic perspective) |
| 9 | **Solution Orientation** | Problem-only vs. solution-oriented framing, reader agency | `so_score`, `so_framing`, `so_reader_agency` | HN Browser, Educator | Art. 28 (constructive social order) |
| 10 | **Fair Witness / Evidence** | Observable facts vs. inferences, evidence strength distribution | `fw_ratio`, `fw_observable_count`, `fw_inference_count`, `hcb_evidence_h/m/l` | Researcher, Source Evaluator | Art. 19 (evidence-based discourse) |
| 11 | **Says vs. Does (SETL)** | Divergence between editorial and structural channels | `hcb_setl`, `hcb_editorial_mean`, `hcb_structural_mean` | Media Critic, Domain Investigator | Art. 19/12 (hypocrisy detection) |
| 12 | **Content Type** | Editorial/opinion/legal/press/academic/misc classification | `content_type` | HN Browser, Researcher | — (structural, not rights-specific) |

---

## Sigma 2 — Derivable from existing data, modest engineering

These require new queries, aggregations, or UI — not new evaluation prompts.

| # | Lens | What it measures | How to build | Persona | UDHR link |
|---|------|-----------------|-------------|---------|-----------|
| 13 | **Information Diet** | What topics dominate HN, what's missing, coverage gaps | Aggregate `hcb_theme_tag` + `content_type` + section coverage gaps. "Lowest Coverage" section on homepage is proto-version. | Ecosystem Observer | Art. 19 (diverse information) |
| 14 | **Source Diversity / Monoculture** | How concentrated are HN's information sources? | `domain_aggregates` — top 10 domains account for X% of stories. Herfindahl index on domain distribution. | Ecosystem Observer, Researcher | Art. 19 (media plurality) |
| 15 | **Community Response Divergence** | Gap between editorial HRCB and HN community reaction | `hn_score` + `hn_comments` vs. `hcb_weighted_mean`. Already crawled — just need a correlation analysis page. | HN Browser, Media Critic | Art. 21 (community voice vs. editorial assessment) |
| 16 | **User Submission Patterns** | What do high-karma users promote? Topic biases in who submits what. | `user_aggregates` + `stories.hn_by` grouping. Already have `/users` page. | Ecosystem Observer | Art. 21 (power dynamics in curation) |
| 17 | **Domain Rights Fingerprints** | Per-source pattern across all provisions — unique "signature" | Already built on homepage ("Domain Rights Profiles") and `/domain/[d]`. Needs better framing as "source character." | Domain Investigator | All articles (per-source profile) |
| 18 | **Narrative Convergence** | When multiple sources tell the same story the same way | Group stories by URL/topic, compare HRCB distributions across domains covering same event. | Media Critic, Researcher | Art. 19 (independent vs. coordinated narrative) |
| 19 | **Expertise Gatekeeping** | Which topics are locked behind jargon/assumed knowledge? | Cross-tabulate `cl_jargon_density` × `hcb_theme_tag`. "Privacy content is 3× more jargon-heavy than expression content." | Accessibility Advocate, Educator | Art. 26 (unequal access to knowledge by topic) |
| 20 | **Temporal Drift / Rights Regression** | Are transparency rates declining? Is propaganda increasing over time? | `daily_section_stats` + `domain_profile_snapshots` time series. Seldon page partially does this. | Researcher, Educator | Art. 28 (monitoring social order quality) |

---

## Sigma 3 — Requires new evaluation dimensions or data sources

These need changes to the LLM prompt, new data ingestion, or external APIs.

| # | Lens | What it measures | What's needed | Persona | UDHR link |
|---|------|-----------------|--------------|---------|-----------|
| 21 | **Digital Rights (specific)** | Surveillance, encryption, data ownership, algorithmic fairness — more granular than UDHR mapping | New prompt section or secondary evaluation pass. Map to specific digital rights frameworks (EFF, Access Now). | HN Browser, Researcher | Art. 12 (privacy), Art. 19 (expression), Art. 27 (technology access) |
| 22 | **Comment Sentiment Divergence** | Per-comment rights lean — when community disagrees with the article | Comment evaluation pipeline (comments already crawled in `story_comments`). Blocked by Round 5 infra. | HN Browser, Media Critic | Art. 21 (community deliberation) |
| 23 | **Tracking/Surveillance Infrastructure** | What trackers, cookies, fingerprinting does the evaluated site use? | External scan (e.g., Blacklight API, BuiltWith, or custom headless browser audit). Feed into structural channel. | Source Evaluator, Privacy Advocate | Art. 12 (privacy in practice) |
| 24 | **Economic Model Impact** | How does a site's revenue model (ads, subscription, VC, public) affect its editorial character? | Enrich DCP with funding model classification. Cross-tabulate with EQ/TD/PT distributions. Some already in DCP. | Source Evaluator, Researcher | Art. 19 (economic pressure on expression) |
| 25 | **Media Ownership Concentration** | Who owns the platforms being evaluated? Parent company, investment ties. | External data enrichment (CrunchBase, Wikipedia, manual curation). Map ownership → editorial patterns. | Researcher, Source Evaluator | Art. 19 (ownership influence on expression) |
| 26 | **Ad Tech Ecosystem** | What advertising networks, data brokers, and tracking infrastructure serve each domain? | External scan + DCP enrichment. Cross-reference with structural channel. | Privacy Advocate, Source Evaluator | Art. 12 (surveillance capitalism) |
| 27 | **Platform Dependency** | Content hosted on Medium/Substack/WordPress.com vs. self-hosted — platform risk to expression | URL/domain pattern analysis (already have domain data). Classify hosting model. | Researcher | Art. 19 (platform as speech infrastructure) |
| 28 | **Accessibility Audit (of evaluated sites)** | WCAG conformance, screen reader compatibility, color contrast | External automated scan (Lighthouse, axe-core). Distinct from content accessibility (jargon). | Accessibility Advocate | Art. 26 (access to information) |

---

## Sigma 4 — Cross-corpus or comparative dimensions

Requires evaluating content from sources beyond HN.

| # | Lens | What it measures | What's needed | Persona |
|---|------|-----------------|--------------|---------|
| 29 | **Cross-community comparison** | Same stories evaluated on HN vs. Lobsters vs. Reddit — how do communities differ? | Second data source ingestion + comparative analytics. | Researcher, Ecosystem Observer |
| 30 | **Academic vs. Popular framing** | How does arXiv coverage of a topic differ from news coverage? | Content type cross-tabulation (already have `content_type`). Needs more academic sources. | Educator, Researcher |
| 31 | **Regulatory impact tracking** | When laws pass (EU AI Act, GDPR enforcement), how does coverage shift? | External event timeline + temporal correlation with provision scores. Seldon event annotations (in IDEAS.md). | Researcher, Policy Maker |
| 32 | **Corporate communications vs. reporting** | Compare company blog posts with third-party coverage of the same company | Domain-level content type analysis. Press releases vs. investigative journalism on same topics. | Source Evaluator, Media Critic |
| 33 | **Global digital divide in coverage** | Which regions of the world are covered, which are invisible? | `gs_regions_json` aggregation is a start. Need geographic depth beyond scope labels. | Researcher, Educator |

---

## Sigma 5 — Emergent / systemic patterns

Detectable only through accumulation of lower-sigma observations over time.

| # | Lens | What it measures | How it emerges |
|---|------|-----------------|---------------|
| 34 | **Manufactured Consensus** | When multiple "independent" sources converge on the same framing simultaneously | Narrative convergence (#18) + temporal clustering + source ownership (#25). Pattern emerges over months. |
| 35 | **Institutional Capture** | When coverage aligns suspiciously with corporate/government interests | Cross-correlate domain ownership (#25) + economic model (#24) + propaganda flags (#2) + stakeholder voice (#5). |
| 36 | **Epistemic Closure** | When a source or community stops citing diverse perspectives | Per-domain `sr_perspective_count` trend + `eq_source_quality` trend declining over time. |
| 37 | **Moral Licensing** | Positive rights coverage masking negative structural practices | High editorial + low structural (extreme SETL). "We wrote about privacy while tracking you." Already measurable via SETL but not framed this way. |
| 38 | **Survivorship Bias** | Tech coverage focuses on successes, ignores failures and harms | Content type distribution + solution orientation + temporal framing. If SO is high and TF is retrospective, success narratives dominate. |
| 39 | **Attention Economics** | What gets clicks vs. what matters for rights | `hn_score` correlation with `hcb_weighted_mean`. Already have the data — need the framing. High-score stories may correlate with low rights engagement. |
| 40 | **Technology Solutionism Bias** | Tech presented as solution to every problem, ignoring structural causes | `so_framing` + `content_type` + thematic analysis. "AI will fix healthcare" vs. structural healthcare reform. |
| 41 | **Observer Effect** | Does scoring change publisher behavior over time? | Longitudinal `domain_profile_snapshots` — if a domain's TD score increases after being evaluated, the observatory is influencing behavior. |

---

## Sigma 6 — Speculative / philosophical / long-horizon

May never be measurable but worth tracking as aspirational directions.

| # | Lens | What it measures | Why it matters |
|---|------|-----------------|---------------|
| 42 | **Intergenerational Impact** | How today's tech discourse shapes tomorrow's policy and rights landscape | The observatory's data, accumulated over years, becomes a historical record of how a generation of builders thought about rights. |
| 43 | **Counterfactual Coverage** | What ISN'T being discussed — the invisible stories | Coverage gaps (#13) extended to systematic analysis of what topics are absent from HN entirely. The dog that didn't bark. |
| 44 | **Memetic Propagation** | How rights-relevant ideas spread and mutate across the tech ecosystem | Track same UDHR provision engagement across domains over time. How does a privacy story on NYT propagate to tech blogs? |
| 45 | **Citation Authority Chains** | Who cites whom, and how does authority flow in tech discourse? | Would require link graph analysis within story content. Massive engineering lift. |
| 46 | **Rights Entanglement (REM)** | UDHR provisions that are statistically entangled — changing one always changes another | Already identified in construct validity analysis as a "Final Four" construct. The `article_pair_stats` materialized table is the foundation. |
| 47 | **Civilizational Barometer** | Aggregate rights trajectory — is tech discourse becoming more or less rights-aware over time? | Multi-year HRCB trend line. The Seldon dashboard aspires to this. Requires 12+ months of data. |
| 48 | **Self-Referential Recursion** | When the observatory itself becomes a subject of tech discourse | Meta-observation: if HN discusses the observatory, evaluate that coverage. The system evaluating its own coverage. |

---

## Meta-factors — Not lenses but constraints on all lenses

These affect the credibility and usefulness of every lens above.

| # | Factor | What it constrains | Status |
|---|--------|-------------------|--------|
| M1 | **LLM Evaluation Accuracy** | Every signal is LLM-generated; no ground truth validation yet | Documented in construct-validity-analysis.md. External validation is the priority. |
| M2 | **Sample Bias (HN only)** | All findings describe "tech content as seen through HN" — not the web | Acknowledged in methodology. Multi-source (Sigma 4) would address. |
| M3 | **Model Disagreement** | 3 models may disagree; consensus weighting masks divergence | `consensus_spread` column exists. Surfaced as "Contested" badge on item page. Could be a lens itself. |
| M4 | **Construct Validity** | HRCB is formative, not reflective — can't validate via factor analysis | Full analysis in `construct-validity-analysis.md`. Final Four constructs identified. |
| M5 | **Cultural Bias in UDHR** | The UDHR reflects 1948 Western liberal democratic values | Should be surfaced on /about. Some HN commenters will raise this — have a clear response. |
| M6 | **Gaming / Manipulation Resistance** | If scores become visible, publishers may optimize for them | Content drift detection exists. Observer effect (#41) is the long-horizon version. |
| M7 | **Temporal Stability** | LLM evaluations may vary if re-run on same content | `content_drift` detection + `eval_history` audit trail exist. Multi-model consensus helps. |
| M8 | **Own Site Accessibility** | Observatory itself should meet the accessibility standards it measures | Not audited. Needs WCAG check before soft launch claim of accessibility lens. |
| M9 | **Own Transparency** | Should disclose limitations, methodology gaps, known biases prominently | /about page has depth but limitations section could be more prominent. |
| M10 | **Scope Creep Risk** | Adding lenses before validating existing ones dilutes quality | Ship current framing, iterate based on real user feedback from soft launch. |

---

## Implementation priority (if pursuing multi-lens reframe)

| Phase | Items | Effort | Gate |
|-------|-------|--------|------|
| **Now** (soft launch) | Reframe hero pills (#1-9), no new engineering | ~1 session | Ship it |
| **Post-launch week 1** | Information diet (#13), source diversity (#14), community divergence (#15) | ~2 sessions | User feedback confirms interest |
| **Post-launch month 1** | Expertise gatekeeping (#19), temporal drift (#20), narrative convergence (#18) | ~3 sessions | Data depth (need 30+ days) |
| **Quarter 2** | Digital rights (#21), comment sentiment (#22), tracking audit (#23) | Major engineering | Business case / funding |
| **Quarter 3+** | Cross-corpus (#29-33), emergent patterns (#34-41) | Platform expansion | Community / research partnerships |
| **Aspirational** | Sigma 6 items (#42-48) | Years of data | Organic emergence |
