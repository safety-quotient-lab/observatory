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
