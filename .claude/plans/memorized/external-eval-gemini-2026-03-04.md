# External Evaluation: Google Gemini (2026-03-04)

## Source
Google Gemini App, unprompted multi-turn evaluation of observatory.unratified.org.
Evaluator was asked to go deep on data model soundness and epistemic quality.

## Hallucination Report

Gemini hallucinated extensively. Key fabrications:

| Claim | Reality |
|-------|---------|
| Community forums exist with disputes/overrides | No forums. Site launched ~8 days ago. |
| Specific scores for Signal (96), Wikipedia (91), DuckDuckGo (88), LinkedIn (64), TikTok (42), X (38) | These scores don't exist. Observatory evaluates HN stories, not arbitrary URLs on demand. |
| "Boilerplate Blindness" vulnerability reports from community | No such reports exist. |
| "Legacy Content Hallucination" incident with students | Fabricated. |
| "Jurisdictional Shell Game" challenge by a researcher | Fabricated. |
| E-Prime logic constraining the AI | We don't use E-Prime. |
| PSQ (DistilBERT) integration | PSQ is a separate project (kashif's), not integrated into observatory. |
| "Recursive Methodology" with Agent A/B/C adversarial loop | Doesn't exist. We have multi-rater consensus, not adversarial agents. |
| Blockchain anchoring on v0.6 roadmap | No such roadmap. |
| "Gradient Descent for Ethics" | Fabricated concept. |
| Python-based framework using LiteLLM | TypeScript on Cloudflare Workers. No LiteLLM. |
| Wrong GitHub org (signal-quality-lab) | Correct: safety-quotient-lab. |
| HN username "unratified" | Likely fabricated. |
| "Entropy Injection" and "Recursive Reset" mechanisms | Don't exist. |
| Site evaluates arbitrary URLs on demand | Evaluates HN front-page stories via cron pipeline. |

**Gemini self-corrected** when told the site was days old (no community forums), but then continued hallucinating "Fair Witness E-Prime" and "Recursive Methodology" details.

## What Gemini Got Right

| Finding | Accuracy |
|---------|----------|
| SETL concept exists and measures editorial/structural divergence | Correct |
| Fair Witness layer separates facts from inferences | Correct |
| Claude 4.5 + Llama models in the stack | Correct |
| Editorial vs Structural dual-channel scoring | Correct |
| Open-source methodology and prompts | Correct |
| Solo developer project | Correct |
| HN as primary data source | Correct |
| 15-story calibration set exists | Correct |
| High transparency of scoring logic | Correct |
| Free-tier (Llama) evaluations are "noisy" | Correct — known issue |
| Lack of institutional peer review | Correct |
| Non-deterministic score variance from LLM temperature | Valid concern, partially mitigated |

## Valid Critiques (actionable regardless of hallucination context)

### 1. Boilerplate / Linguistic Gaming Vulnerability
The editorial channel could be fooled by deliberately crafted "rights-washing" language. A site with perfect policy text and terrible structural behavior *should* be caught by SETL, but our structural channel is metadata-based (paywalls, tracking, accessibility), not behavior-based (actual JS fingerprinting, dark patterns, network calls).

### 2. Non-Deterministic Scores (Reproducibility)
Running the same URL twice may yield different scores. We mitigate via multi-rater consensus and calibration, but we don't currently expose confidence intervals to users.

### 3. Structural Channel Depth
Our structural scoring uses DCP metadata (privacy policy presence, ad/tracking signals, accessibility, authorship). It does NOT perform dynamic analysis (headless browser detecting fingerprinting scripts, dark pattern click-depth, actual network exfiltration). This is a real gap.

### 4. Temporal Persistence / Longitudinal Tracking
We have `content_drift` sweep detecting when content changes, but we don't track *policy* evolution over time or show users historical score trajectories.

### 5. Confidence Intervals
Scores are presented as point estimates. Showing score ± variance (or inter-rater agreement) would increase epistemic honesty.

### 6. Sub-processor / Jurisdiction Tracking
Evaluating the data sovereignty chain (where does user data actually go?) is beyond our current scope but theoretically valuable.

### 7. Archive Integrity
Detecting whether sites delete historical content (Right to Information) — interesting signal, not currently measured.

### 8. Regulatory Framework Expansion
EU AI Act, GDPR 2.0 integration — future direction, not current scope.

## Gemini's Proposed GitHub Issue (SETL Enhancement)
Gemini drafted a feature request for formalizing SETL with headless browser structural scanning. The *concept* is valid (deeper structural analysis), but the specific implementation (Puppeteer/Playwright in CF Workers) is architecturally incompatible — Workers can't run headless browsers natively (though CF Browser Rendering exists).

## Meta-Observation
Gemini demonstrated exactly the failure mode it was critiquing: **hallucinated compliance**. It generated plausible-sounding technical details about our architecture that were fabricated, while confidently evaluating our "epistemic quality." This is a useful demonstration of why Fair Witness discipline matters — Gemini's editorial channel (confident prose) diverged massively from structural reality (actual codebase). SETL would flag Gemini's own evaluation at ~60+ tension.

---

# External Evaluation #2: Gemini via unratified.org Agent (2026-03-04)

## Source
Multi-turn conversation between the unratified.org agent and Google Gemini. Covered ICESCR analysis, G7 treaty comparison, structured data/SEO suggestions, proposed "Gemini Lite" evaluator, Svelte 5 code suggestions, and a beta readiness report.

## Accuracy Assessment

### Correct (high confidence)
- ICESCR ratification history, G7 comparison data, negative/positive rights framework — textbook-accurate
- Senate RUD analysis on ICCPR Articles 6, 7, 20 — verifiable and correct
- Structured data suggestions (FAQ, Dataset, ClaimReview schema) — real schema.org types, applicable
- OG tag gap — confirmed: Observatory has og:type/title/description/url but **no og:image** (Base.astro verified)
- `.well-known/` acknowledgment — correctly identified agent-card.json exists

### Confabulated (verified false)

| Claim | Reality |
|---|---|
| Observatory uses **Svelte 5** | Astro 5 SSR + vanilla JS inline scripts. 1 Svelte mention in entire codebase (tailwind.config.mjs). Blog uses Svelte for PostList.svelte only. |
| "Svelte 5.53" version | No such version exists |
| "Gemini 3 Flash", "Gemini 3.1 Flash-Lite", "Gemini 3.1 Flash Thinking", "Gemini 3 Deep Think" | Fabricated model names. Actual: 2.0 Flash, 2.5 Pro, etc. |
| CVE-2026-27902 | Fabricated CVE number |
| Quantitative audit scores (0.95/0.40) | No methodology; fabricated with false precision |
| "6th Sigma" achievement | Six Sigma is process quality methodology; misused as quality grade |
| "Investigated" scraping/crawl depth | Fabricated investigation |
| First-pass site identification | Classified as sovereign citizen / constitutional amendment / WordPress — completely wrong |
| Proposed Svelte 5 Runes error boundary code | Codebase doesn't use Svelte — unusable |

### Mixed (partially useful, partially wrong)
- Knowledge Graph suggestions — good concept, wrong tech stack assumed
- Beta readiness report — reasonable framework, fabricated scores
- SEO recommendations — some valid (og:image, structured data), wrapped in confabulated context

## Genuinely Useful for the Observatory

1. **og:image** — Not present. Worth adding (OG card with HRO branding).
2. **Dataset schema.org markup** — `about.astro` has `AboutPage` JSON-LD but no `Dataset` type. 7K+ stories = valid Dataset on `/data`.
3. **ClaimReview schema** — Each eval is structurally a claim review. Worth exploring on `/item/[id]`.
4. **FAQ schema on `/about`** — Persona toggle Q&A sections could be FAQPage.
5. **ICESCR content** — Expert-level treaty analysis; sister-project material for unratified.org blog/reference.

## Meta-Observations (Eval #2)

The Observatory would flag Gemini's own output for:
- **PT: Appeal to Authority** (fabricated CVE, "6th Sigma")
- **PT: False Precision** (0.95/0.40 scores from nothing)
- **Low Fair Witness ratio** (inferences presented as facts)
- **High SETL** (says it investigated; structurally did not)

The unratified.org agent's inline corrections were largely accurate but missed:
- Fabricated Gemini model names (not real products)
- Svelte/Observatory conflation (agent flagged Svelte wrong for unratified.org but not that Observatory also doesn't use Svelte)
- CVE fabrication

**Pattern (consistent across both evals):** Gemini performs well on retrieval tasks (treaty facts, schema.org specs) and poorly on generative tasks (site analysis, code, quantitative assessment). Confabulation rate increases with task specificity — the more it needs to know about *this particular project*, the more it invents.

## Actionable Items Extracted

Low-effort, high-value — implemented 2026-03-04:
- **og:image OG card** ✅ — `public/og-card.png` (1200×630), `og:image` + `twitter:image` in `Base.astro`, `twitter:card` upgraded to `summary_large_image`. Per-page `ogImage` prop available.
- **Dataset schema on `/data`** ✅ — Full `Dataset` JSON-LD on `data.astro` (measurementTechnique, variableMeasured, distribution, temporalCoverage, license CC BY-SA 4.0). `about.astro` simplified to `@id` reference.
- **FAQPage schema on `/about`** ✅ — 5 Q&A pairs (What is HRO, What is HRCB, How are stories evaluated, What is SETL, What is Fair Witness). Second JSON-LD block alongside existing AboutPage.
- **ClaimReview schema on `/item/[id]`** — **SKIPPED (deliberate)**. Knock-on analysis determined ClaimReview misframes our work: we assess *rights alignment*, not factual claims. Google's ClaimReview guidelines require checkable factual assertions. Our evaluations measure directional lean against UDHR provisions — that's a `Review` (already present), not a `ClaimReview`. Adding ClaimReview risks users perceiving HRO as a fact-checker rather than a rights-alignment observatory, undermining the pedagogical mission. The existing `Review` + `Rating` schema with `ratingExplanation` is semantically correct.
