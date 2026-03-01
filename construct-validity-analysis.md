# Construct Validity Analysis

```
================================================================
Date:        2026-03-01
Status:      ACTIVE — 7 Perspectives + Planning Frameworks
Purpose:     Foundational analysis of what HRCB measures and
             what constructs could replace or decompose it
================================================================
```

---

## 1. The Problem with HRCB as a Construct

HRCB (HR Compatibility Bias) is the project's core measured quantity: a [-1.0, +1.0]
score representing how aligned web content is with the UDHR. It aggregates 31
per-section scores (Preamble + Articles 1-30) into a weighted mean.

Three structural problems prevent HRCB from being psychometrically validated:

### 1a. Formative measurement model

HRCB is **formative** — the 31 section scores *define* the construct by
aggregation. Factor analysis (and most psychometric validation tools) assumes a
**reflective** model where a latent factor *causes* the observed scores.

```
REFLECTIVE (FA valid)              FORMATIVE (FA invalid)

    ┌──────────┐                     ┌──────────┐
    │ Latent   │                     │ HRCB     │
    │ Factor   │                     │ Score    │
    └────┬─────┘                     └────▲─────┘
         │ causes                         │ defined by
    ┌────┼────┐                      ┌────┼────┐
    ▼    ▼    ▼                      │    │    │
  Art1 Art2 Art3                   Art1 Art2 Art3
```

Running FA on a formative construct reveals correlations in the *input data*
(which UDHR articles co-occur in tech content), not the structure of an
underlying latent trait. That's content analysis, not construct validation.

References:
- Aguirre-Urreta (2024). "Reconsidering formative vs reflective measurement
  model misspecification." Information Systems Journal.
- Diamantopoulos & Siguaw (2006). "Formative vs Reflective Indicators in
  Organizational Measure Development." British Journal of Management.

### 1b. Simultaneous generation contamination

The LLM generates all 31 section scores in a single JSON response. This creates
artificial correlations through anchoring and halo effects:

- **Anchoring**: The score for Article 1 anchors subsequent articles. LLMs
  exhibit documented anchoring bias (O'Leary 2025, Feng et al. 2024).
- **Halo effect**: A generally-positive holistic impression inflates all section
  scores together.
- **Recency bias**: In long outputs, later sections may weight recent context
  more heavily than the full rubric.

Any factor structure extracted from this data primarily reflects LLM response
generation patterns, not the actual covariance structure of rights-compatibility
in web content.

References:
- O'Leary (2025). "An Anchoring Effect in Large Language Models." IEEE.
- Feng et al. (2024). "Anchoring Bias in Large Language Models: An Experimental
  Study." arXiv:2412.06593.

### 1c. Single-domain sample

N=647 stories with full section scores, all from Hacker News (tech news). Any
factor structure discovered reflects "how UDHR articles covary in tech content,"
not "how UDHR articles covary in general." Privacy (Art. 12) and expression
(Art. 19) might anti-correlate in tech news but positively correlate in human
rights reporting.

---

## 2. Messick's Framework: Where HRCB Stands

Messick's (1995) unified validity framework identifies six aspects of construct
validity. HRCB's current status:

```
ASPECT              WHAT IT ASKS                        HRCB STATUS
────────────────────────────────────────────────────────────────────
Content          Does it cover the right domain?         STRONG
                                                         31 UDHR articles,
                                                         E+S channels, DCP

Substantive      Do response processes match theory?     UNKNOWN
                                                         LLM reasoning opaque;
                                                         Fair Witness helps
                                                         but isn't proof

Structural       Does internal structure match           NOT TESTED
                 the construct?                          FA would go here,
                                                         but contaminated
                                                         (Section 1b)

Generalizability Does it work across contexts,           WEAK
                 raters, occasions?                      Multi-model helps;
                                                         single domain hurts;
                                                         no test-retest

External         Correlate with external criteria?       NOT TESTED
                 Diverge from unrelated measures?        No RDR/FH comparison,
                                                         no discriminant test

Consequential    Are consequences of use acceptable?     LOW RISK
                                                         Pedagogical, not
                                                         gatekeeping
```

The two critical gaps are **Structural** and **External**. Structural is
blocked by the contamination problem (Section 1b). External is unblocked
and most informative per unit of effort.

---

## 3. What Can Be Validly Measured?

Any construct must survive three tests:

1. **Measurement independence** — can indicators be scored without contaminating
   each other?
2. **External validatability** — does something exist outside our system to
   check against?
3. **Pedagogical value** — does it teach users something about rights?

### Measurement type taxonomy

```
OBJ = Objective/structural (no LLM, fully reproducible)
HOL = LLM-holistic (single score per eval, no cross-contamination)
ANA = LLM-analytic (multi-dimension, contamination risk)
AGG = Aggregate-derived (emerges from many evals, not per-story)
TMP = Temporal (requires time series)
```

---

## 4. Construct Inventory

### Layer 1 — Objective Foundation (no LLM needed)

| ID | Construct | Type | What it measures | External validation target |
|----|-----------|------|------------------|---------------------------|
| TQ | Transparency Quotient | OBJ | Author disclosed, sources cited, conflicts stated, corrections policy, funding | RDR disclosure indicators (58 indicators) |
| AC | Accessibility Compliance | OBJ | Reading level, jargon density, assumed knowledge, language availability | WCAG conformance evaluation |
| CAR | Consent Architecture Rating | OBJ | Dark pattern count, cookie opt-in/out, ToS readability, data collection scope | EU DSA compliance, DPAF taxonomy (68 types) |
| ISI | Information Sovereignty Index | OBJ | Ownership model, funding source, editorial independence, content licensing | Freedom House media independence |
| SRD | Semiotic Rights Density | OBJ | Rights-adjacent terms per 1000 words from fixed UDHR-derived vocabulary | Baseline discriminant check for all LLM constructs |

### Layer 2 — LLM-Holistic (single scores, minimal contamination)

| ID | Construct | Type | What it measures | External validation target |
|----|-----------|------|------------------|---------------------------|
| RS | Rights Salience | HOL | Does this content engage with rights at all? Binary per-article, count of provisions touched | Correlation with SRD (Layer 1 anchor) |
| NT | Normative Temperature | HOL | How far from mainstream rights consensus? Low = conventional, high = challenges norms | Content analysis research on norm deviation |
| PTD | Propaganda Technique Density | HOL | Count and severity of propaganda techniques per unit of content | Multi-model agreement (Krippendorff's alpha); existing PT annotation datasets |
| EQ | Epistemic Quality | HOL | Source citation density, claim-to-evidence ratio, logical structure | METI framework (expertise, integrity, benevolence); news quality scales |
| SPA | Stakeholder Power Asymmetry | HOL | Whose interests does this content serve? Producer-serving ↔ audience-serving | Communications research on source representation |
| NFI | Narrative Framing Index | HOL | Victim/agent framing, individual vs systemic attribution, retrospective vs prospective | Framing analysis codebooks (mature subfield) |

### Layer 3 — Aggregate/Temporal (emerge from many evaluations)

| ID | Construct | Type | What it measures | External validation target |
|----|-----------|------|------------------|---------------------------|
| ICI | Institutional Capture Index | AGG | Degree editorial output aligns with funding/ownership interests | RDR corporate accountability; Freedom House |
| REM | Rights Entanglement Map | AGG | Which rights systematically co-vary (positively or negatively) | Rights network correlation structure (already computed) |
| MCC | Model Consensus Construct | AGG | Agreement/disagreement patterns across models; construct boundary mapping | Inter-rater reliability literature (ICC, Fleiss' kappa) |
| RM | Rights Metabolism | TMP | How quickly a domain's rights profile changes over time | Domain profile snapshots (already collected daily) |
| ESC | Editorial-Structural Coherence | ANA(2D) | SETL: says one thing, does another. Only 2 dimensions (E, S) — manageable contamination | Hypocrisy/greenwashing research |

### Layer 4 — Far-tail constructs (novel, high pedagogical value)

| ID | Construct | Type | What it measures | Status |
|----|-----------|------|------------------|--------|
| RTS | Rights Tension Signature | ANA(structured) | Which rights conflict in this content, how they're resolved | Fundamentally different task than HRCB; highest pedagogical power |
| PR | Pedagogical Resonance | HOL | Will a reader think about rights after encountering this content? | The mission construct; no existing measure to validate against |
| DEI | Discourse Ecosystem Impact | HOL+AGG | Does this content contribute to or degrade healthy discourse? | Epistemic vulnerability frameworks |
| ARI | Anticipatory Rights Impact | HOL | What rights consequences will this technology/event create in the future? | Speculative by nature; policymaker-oriented |
| HA | Hermeneutic Accessibility | HOL | Can a non-expert correctly interpret the rights implications? | Article 26 connection; no existing measure |

---

## 5. Crosswise Knock-On Analysis

Choosing one construct affects what others become possible, necessary, or
redundant. Key interactions:

### 5a. TQ vs EQ — transparency vs quality

~40% shared variance. TQ is mostly objective (author disclosed: yes/no). EQ
requires LLM judgment (is the reasoning sound?).

- **Choosing TQ over EQ**: Clean, validatable construct. Loses "is this good
  reasoning?" dimension. Naturally leads to RDR convergent validation.
- **Choosing EQ over TQ**: Subsumes transparency into quality. Simpler model,
  but loses the binary objectivity that makes TQ independently validatable.
- **Choosing both**: Viable (complementary), but doubles maintenance. TQ anchors
  EQ — if they diverge wildly on same content, EQ is suspect.

### 5b. RS vs HRCB — salience vs alignment

The most consequential choice.

- **RS alone**: Binary detection is reliable, low bias. But loses evaluative
  dimension — can't say "this domain is rights-negative." Pedagogically
  moderate.
- **HRCB alone**: Rich evaluative signal but formative, contaminated,
  unvalidated. Pedagogically powerful but fragile.
- **RS + directional holistic score**: RS gates HRCB validity (how can something
  be strongly rights-aligned if it doesn't touch rights?). Best of both worlds.
  RS becomes the volume knob, direction becomes a separate holistic judgment.

### 5c. RTS vs 31 independent sections

```
CURRENT MODEL:                    TENSION MODEL:
  Art 12: +0.3                      Privacy ↔ Expression: -0.4
  Art 19: +0.6                        (resolved toward expression)
  Art 26: +0.1                      Access ↔ Property: +0.2
  ...28 more scores...                (resolved toward access)
  (31 independent dims)             Security ↔ Freedom: 0.0
                                      (unresolved tension)
                                    (3-5 tension pairs)
```

- **Switching to tensions**: Can't aggregate into a single score. Breaks
  leaderboard/ranking model. But creates the most pedagogically powerful output.
  Requires rebuilding the entire analytical layer (high sunk cost from 31-section
  model).
- **Keeping 31 sections**: Every downstream analysis depends on per-section
  scores. But the scores are contaminated and give false precision.

### 5d. Objective cluster vs LLM cluster

- **Objective only** (TQ, AC, CAR, ISI): Psychometrically defensible.
  Pedagogically dead. "3 dark patterns, reading level 14.2" doesn't teach
  anyone about human rights.
- **LLM only** (EQ, NT, PR, SPA): Pedagogically alive. Can't survive scrutiny.
  "High normative temperature" means "Claude said so."
- **Synthesis**: Objective constructs as validatable foundation; LLM constructs
  as interpretive layer, validated against the objective base.

---

## 6. Recommended Architecture

```
LAYER 1 — OBJECTIVE FOUNDATION (no LLM, fully reproducible)
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │ Transparency│  │Accessibility│  │  Consent   │
  │ Quotient    │  │ Compliance  │  │Architecture│
  │ (TQ)        │  │ (AC)        │  │ (CAR)      │
  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
         └───────────┬───────────────────┘
                     ▼
            Structural Rights Profile
            (validatable against RDR, WCAG, DSA)

LAYER 2 — LLM-HOLISTIC (single scores, minimal contamination)
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │   Rights   │  │ Normative  │  │ Propaganda │
  │  Salience  │  │Temperature │  │ Technique  │
  │ (RS)       │  │ (NT)       │  │ Density(PT)│
  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
         └───────────┬───────────────────┘
                     ▼
            Editorial Rights Profile
            (validated by Layer 1 anchoring +
             multi-model agreement)

LAYER 3 — AGGREGATE/TEMPORAL (emerge from many evals)
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │Institutional│  │  Rights   │  │   Model    │
  │  Capture   │  │Entanglement│  │ Consensus  │
  │ (ICI)      │  │ (REM)      │  │ (MCC)      │
  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
         └───────────┬───────────────────┘
                     ▼
            Ecosystem-Level Insights
            (the "mirror" the mission describes)
```

HRCB becomes a deprecated composite — replaced by its constituent parts, each
independently validatable. The weighted mean may persist as a convenience
summary, but is no longer presented as a single construct.

---

## 7. External Validation Roadmap

Ordered by informativeness per unit of effort:

| Priority | Validation | What it proves | Effort |
|----------|-----------|----------------|--------|
| 1 | Convergent: TQ vs RDR disclosure indicators (~20 overlapping domains) | Objective layer measures something real | M |
| 2 | Discriminant: RS/HRCB vs generic sentiment analysis | HRCB ≠ sentiment with extra steps | M |
| 3 | Known-groups expansion: 50+ pre-classified domains | Constructs discriminate between known categories | S-M |
| 4 | Test-retest: re-evaluate 50 stable-content stories | Temporal reliability of LLM-holistic constructs | S |
| 5 | Inter-rater (formal): Fleiss' kappa / ICC across models on shared stories | Multi-model agreement quantified properly | M |
| 6 | Convergent: ICI vs Freedom House media independence | Aggregate constructs correspond to expert assessment | L |

---

## 8. Perspective 2 — Pedagogical Effectiveness

Perspective 1 asked "is this a valid measurement?" Perspective 2 asks "does it
actually teach?" The mission is explicit: **users learn UDHR provisions by
encountering them naturally while doing something they already want to do.**

The teaching is a side effect. This isn't a classroom — it's a tool. The
question is which constructs create learning moments *incidentally*, without
the user seeking them.

### 8a. How Incidental Learning Works

Three mechanisms from learning science apply directly:

**Situated cognition** (Lave & Wenger, 1991): Knowledge is inseparable from the
activity and context in which it's used. Learning happens when people
participate in authentic practice — not when they're told facts. A user browsing
HN stories and noticing that privacy scores drop when expression scores rise is
learning through participation, not instruction.

**Expectation violation** (Aubert-Teillaud, 2023): Surprise is the primary
trigger for insight. When data contradicts a user's mental model, cognitive
dissonance creates curiosity. The "aha moment" (Kounios & Beeman, 2009) occurs
when the unconscious mind resolves conflicting information into a new pattern.
Constructs that produce surprise teach; constructs that confirm expectations
don't.

**Progressive disclosure** (cognitive load theory): Too much information at once
prevents learning. The pedagogical sequence is: notice → wonder → investigate.
Constructs must be surfaceable at different depths — a badge that catches
attention, a score that raises a question, a detail page that answers it.

### 8b. The Pedagogical Effectiveness Test

For each construct, ask:

1. **Does it produce surprise?** If the construct only confirms what users
   already expect (HR orgs score well, propaganda sites score poorly), it
   doesn't teach. The pedagogical value is in the *unexpected* — a respected
   outlet with poor transparency, a controversial site with strong privacy
   practices.

2. **Does it name something invisible?** The mission's key insight: "aggregate
   invisible patterns into visible statements about rights." The construct must
   make visible something the user couldn't see by reading individual stories.

3. **Can it be encountered naturally?** The user must stumble across the insight
   while doing something they already want (browsing stories, checking a domain,
   filtering feeds). If the construct requires a dedicated analytics page that
   only data nerds visit, it fails the situated cognition test.

4. **Does it provoke a rights-specific question?** Generic quality metrics
   (reading level, source count) don't teach about *rights*. The construct must
   lead the user to think about a specific UDHR provision or rights tension —
   even if they don't know the article number.

5. **Is the insight sticky?** After encountering the construct's output, does the
   user's mental model permanently change? "34% of tech articles don't name
   their author" is sticky — once you know it, you notice it everywhere. "This
   domain scores 0.42" is not sticky — it's a number that doesn't attach to
   anything in lived experience.

### 8c. Scoring the Construct Inventory

Applying the five tests to each construct:

```
                    SURPRISE  INVISIBLE  NATURAL   RIGHTS-    STICKY
                    produces  names the  encounter SPECIFIC   insight
                    surprise? invisible? naturally? question?  persists?
────────────────────────────────────────────────────────────────────────
LAYER 1 — OBJECTIVE
  TQ  Transparency    ✓✓       ✓✓        ✓         ✓✓        ✓✓
  AC  Accessibility   ✓        ✓✓        ✓         ✓         ✓
  CAR Consent Arch.   ✓        ✓         ✗         ✓         ✓
  ISI Info Sovereign  ✓        ✓         ✗         ✓         ✗
  SRD Semiotic Dens.  ✗        ✗         ✗         ✗         ✗

LAYER 2 — LLM-HOLISTIC
  RS  Rights Salience ✓✓       ✓✓✓       ✓✓        ✓✓        ✓✓✓
  NT  Norm. Temp.     ✓✓       ✓✓        ✓         ✓         ✓
  PTD Propaganda      ✓        ✓         ✓         ✓         ✓
  EQ  Epistemic Qual  ✓        ✓         ✓         ✗         ✓
  SPA Stakeholder     ✓✓       ✓✓        ✓         ✓         ✓✓
  NFI Narrative Frame ✓        ✓         ✗         ✓         ✓

LAYER 3 — AGGREGATE
  ICI Inst. Capture   ✓✓       ✓✓✓       ✓         ✓✓        ✓✓
  REM Rights Entangle ✓✓✓      ✓✓✓       ✗         ✓✓✓       ✓✓✓
  MCC Model Consensus ✗        ✓         ✗         ✗         ✗
  RM  Rights Metabol. ✓✓       ✓✓        ✓         ✓         ✓
  ESC E-S Coherence   ✓✓✓      ✓✓✓       ✓         ✓✓        ✓✓✓

LAYER 4 — FAR-TAIL
  RTS Rights Tension  ✓✓✓      ✓✓✓       ✓         ✓✓✓       ✓✓✓
  PR  Pedagog. Reson. ✓        ✓✓        ✓         ✓✓        ✓
  DEI Discourse Eco.  ✓        ✓✓        ✗         ✓         ✓
  ARI Anticipatory    ✓✓       ✓✓        ✗         ✓✓        ✓
  HA  Hermeneutic Acc ✓        ✓✓        ✗         ✓✓        ✓
────────────────────────────────────────────────────────────────────────
```

Key:  ✗ = fails test    ✓ = passes    ✓✓ = strong    ✓✓✓ = exceptional

### 8d. The Pedagogical Winners

**Tier A — highest pedagogical power** (≥4 strong/exceptional marks):

1. **Rights Tension Signature (RTS)** — "This article about facial recognition
   reveals a tension between privacy and security, resolved toward security."
   Every test aces. The user can't read this without thinking about rights
   tradeoffs. It names something invisible (the structural conflict), produces
   surprise (you didn't realize these rights were in tension here), is
   rights-specific by definition, and the insight is permanent — once you see
   rights as a system of tradeoffs, you can't unsee it.

2. **Editorial-Structural Coherence / SETL** — "This company talks about
   privacy but tracks everything." The hypocrisy detector. Maximum surprise
   value. Users encounter it naturally on any story page. The insight
   ("websites can say one thing and do another") is immediately applicable
   to every site they visit afterward.

3. **Rights Salience (RS)** — "42% of HN front page stories touch human rights
   provisions." This is the foundational "aha": most people don't realize how
   much of tech news is *about* human rights. It names the invisible (rights
   relevance of mundane tech stories), surfaces naturally (counts on every
   page), and the insight permanently changes how users read HN.

4. **Rights Entanglement Map (REM)** — "Privacy and expression are
   anti-correlated in tech content." Exceptional on every axis except natural
   encounter (requires visiting the network page). But the insight — that rights
   aren't independent, that improving one can degrade another — is the deepest
   pedagogical claim the system can make.

**Tier B — strong pedagogical value** (3 strong marks):

5. **Transparency Quotient (TQ)** — "Only 34% of stories identify their author"
   is already shipped and working on `/signals`. Surprise + invisible + sticky.
   Natural encounter via the signals dashboard. Strong but narrower than Tier A
   (teaches about transparency specifically, not rights generally).

6. **Institutional Capture Index (ICI)** — "This outlet's editorial output
   aligns 87% with its owner's commercial interests." High surprise, names the
   invisible, rights-specific. But it's an aggregate construct — can only be
   surfaced on domain pages, not on individual stories. Harder to encounter
   naturally.

7. **Stakeholder Power Asymmetry (SPA)** — "This article is written from the
   perspective of the platform, not the user." Surprise + names invisible +
   sticky. Teaches about power dynamics in information.

**Tier C — pedagogically weak** (≤2 strong marks):

- **MCC** (Model Consensus) — meta-measurement, no rights pedagogy
- **SRD** (Semiotic Density) — vocabulary counting, no insight
- **EQ** (Epistemic Quality) — teaches critical thinking, not rights
- **CAR** (Consent Architecture) — useful data, hard to encounter naturally
- **ISI** (Info Sovereignty) — structural, not pedagogically surprising

### 8e. The Pedagogical Sequence

Learning science says insight builds in stages: notice → wonder → investigate.
The construct architecture should map to this sequence:

```
NOTICE (badges, one-liners, counts on every page)
  │
  │  RS:  "4 rights touched"  ← badge on every story card
  │  ESC: "hypocrisy: HIGH"   ← SETL badge (already exists)
  │  TQ:  "author: unnamed"   ← transparency flag
  │
  ▼
WONDER (per-story detail that raises questions)
  │
  │  RTS: "Privacy ↔ Expression: resolved toward expression"
  │  SPA: "Perspective: platform-centric"
  │  NT:  "Normative temperature: HIGH (challenges consensus)"
  │
  ▼
INVESTIGATE (aggregate pages that reveal patterns)
  │
  │  REM: "Privacy and expression are anti-correlated in tech"
  │  ICI: "This outlet's editorial aligns 87% with owner interests"
  │  RS:  "42% of front page stories touch human rights"
  │
  ▼
INTEGRATE (user's mental model permanently changes)
  │
  │  "Rights aren't separate things — they're a system of tensions"
  │  "What a site says and what it does are often different"
  │  "Most tech news is about human rights without knowing it"
```

### 8f. Crosswise with Perspective 1

The pedagogical perspective reshuffles Perspective 1's priorities:

```
                        Psychometric    Pedagogical    Combined
                        Validity        Effectiveness  Priority
Construct               (Perspective 1) (Perspective 2)
────────────────────────────────────────────────────────────────
TQ  Transparency        ✓✓✓ (OBJ)      ✓✓ (Tier B)    HIGH
AC  Accessibility       ✓✓✓ (OBJ)      ✓  (Tier C)    MED
CAR Consent Arch.       ✓✓✓ (OBJ)      ✓  (Tier C)    MED
RS  Rights Salience     ✓✓  (HOL)      ✓✓✓ (Tier A)   HIGH ★
NT  Normative Temp.     ✓✓  (HOL)      ✓✓ (Tier B)    HIGH
PTD Propaganda          ✓✓  (HOL)      ✓✓ (Tier B)    HIGH
ESC SETL Coherence      ✓   (ANA-2D)   ✓✓✓ (Tier A)   HIGH ★
RTS Rights Tension      ✗   (ANA)      ✓✓✓ (Tier A)   CONFLICT ★★
REM Rights Entangle     ✓✓  (AGG)      ✓✓✓ (Tier A)   HIGH ★
ICI Inst. Capture       ✓✓  (AGG)      ✓✓ (Tier B)    HIGH
MCC Model Consensus     ✓✓✓ (meta)     ✗  (Tier C)    LOW
SRD Semiotic Density    ✓✓✓ (OBJ)      ✗  (Tier C)    LOW

★  = both perspectives agree: high priority
★★ = perspectives CONFLICT: psychometrically weak, pedagogically essential
```

**The critical conflict: Rights Tension Signature (RTS).** Perspective 1 flags
it as contaminated (multi-dimensional LLM output). Perspective 2 says it's the
single most powerful pedagogical construct. This tension must be resolved —
possibly by restructuring *how* tensions are elicited (structured pairs rather
than open-ended 31-section scoring) to satisfy both perspectives.

### 8g. The RTS Resolution Path

The contamination problem with RTS is solvable if we change the elicitation:

```
CURRENT (contaminated):              RESTRUCTURED (clean):
  "Score all 31 articles"              "Which 2-3 rights are in
   → single JSON response               tension in this content?
   → anchoring/halo                      For each pair, which
   → 31 correlated scores               direction is it resolved?"
                                        → 3-5 structured pairs
                                        → each pair is independent
                                        → no halo across pairs
```

This converts RTS from ANA (multi-dimension, contaminated) to HOL-structured
(small number of independent pair judgments). The LLM identifies tension pairs
and resolution direction — not 31 independent scores. The contamination risk
drops because:
- Each pair is a self-contained judgment (privacy vs expression)
- There's no numerical scale to anchor (it's a categorical choice)
- The number of pairs is small (3-5) and naturally bounded by content

This would give RTS the pedagogical power of the best construct AND the
measurement validity of a holistic judgment.

---

## 9. Open Questions for Future Perspectives

Perspectives 1 (Psychometric Validity) and 2 (Pedagogical Effectiveness) are
documented. The construct set that survives both:

- **Both agree, high priority**: TQ, RS, NT, PTD, ESC, REM, ICI
- **Conflict to resolve**: RTS (restructured elicitation as resolution path)
- **Valid but not pedagogical**: MCC, SRD, AC (keep as infrastructure)
- **Pedagogical but not valid**: NFI, DEI, HA (defer until elicitation method
  is solved)

---

## 10. Perspective 3 — Epistemic Warrant

Can we legitimately claim to measure what we say we measure? Not "is the
measurement accurate?" (Perspective 1) but "do we have the *right* to make
this kind of claim at all?"

### 10a. The Thick Concepts Problem

HRCB is a "thick concept" (Stanford Encyclopedia of Philosophy, 2025) — it
simultaneously describes and evaluates. "UDHR-compatible" bundles together:
- A descriptive claim (this content exhibits feature X)
- A normative claim (feature X is relevant to human rights)
- A weighting claim (this feature matters more than that one)

When thick concepts are operationalized as measurements, the normative judgment
embedded in operationalization cannot be treated as a technical decision — it
requires legitimacy from affected stakeholders (Alexandrova, 2021). Our
calibration set validates internal consistency but not normative grounding.

### 10b. LLMs and Epistemic Authority

AI systems do not possess epistemic authority in the classical sense — they lack
the agential and relational conditions required (Hauswald, 2025). However, they
can support *justified belief* if specific conditions are met:
- Transparency of reasoning (Fair Witness framework helps here)
- Traceability of evidence (witness_facts/witness_inferences)
- Revisability of conclusions (multi-model consensus, confidence weighting)

The critical distinction: we cannot claim "this content IS rights-incompatible."
We can claim "our models assessed this content and found these patterns, with
this confidence, based on this evidence."

### 10c. The WEIRD Bias Problem

LLMs predominantly reflect WEIRD (Western, Educated, Industrialized, Rich,
Democratic) cultural values. The UDHR itself is a product of post-WWII Western
liberal consensus. This creates double-Western-bias:

```
  UDHR (Western origin) → LLM rubric (Western training) → Score
                                                            ↓
                                              Non-Western content
                                              systematically penalized?
```

Research confirms LLMs show significant moral value bias when prompted in
non-English languages (LREC 2024). Our single-language (English), single-domain
(HN/tech) scope partially mitigates this — but it's a structural limitation
on any future expansion.

### 10d. The Moral Reasoning Gap

EACL 2024 finding: "there is a disconnect between a model's capability to
*discuss* moral concepts and its ability to *apply* these concepts consistently
in decision-making." LLMs can produce sophisticated rights discourse without
underlying moral sensitivity. This means our scores reflect linguistic pattern
matching against the UDHR text, not genuine moral reasoning.

### 10e. What Epistemic Warrant We DO Have

Despite these problems, five arguments ground our epistemic position:

1. **Pattern surfacing, not verdicts** — The mission-aligned use is aggregate
   patterns ("34% of stories don't name their author"), not individual
   judgments. Patterns can be epistemically valid even when individual scores
   are noisy.
2. **Explicit rubric** — The methodology is public, auditable, criticizable.
   This is more epistemically honest than implicit human editorial judgment.
3. **Multi-rater consensus** — Multiple models with confidence weighting is
   more epistemically careful than any single rater.
4. **Provisionality** — Scores are explicitly provisional, revisable, and
   presented with confidence. This is an epistemic virtue.
5. **Fair Witness** — Observable facts separated from interpretive inferences.
   The strongest epistemic discipline in the system.

### 10f. Implications for Construct Architecture

```
EPISTEMIC WARRANT STRENGTH BY CONSTRUCT TYPE:

  Strong    OBJ constructs (TQ, AC, CAR) — "this site has/lacks X"
  warrant   is a factual claim, not a normative one

  Moderate  HOL constructs (RS, NT, PTD) — "our model assessed..."
  warrant   framing preserves epistemic humility

  Weak      ANA constructs (RTS, 31 sections) — normative judgment
  warrant   embedded in multi-dimensional scoring

  Strong    AGG constructs (REM, ICI) — patterns across many
  warrant   evaluations, not individual verdicts
```

**Key principle**: Frame claims at the level warranted by the evidence.
"34% of stories don't identify their author" (factual, strong warrant) is
better than "this domain scores -0.3 on rights compatibility" (normative,
weak warrant).

---

## 11. Perspective 4 — Consequential Ethics

What happens when we publish these scores? Messick's 6th validity aspect.

### 11a. Goodhart's Law

"When a measure becomes a target, it ceases to be a good measure."

The ESG precedent is instructive: companies with *greenwashing accusations*
have *higher* ESG scores on average than those without (ScienceDirect, 2024).
The score optimization loop:

```
  Score published → Publisher learns score → Publisher optimizes
       ↑                                          ↓
  Score reflects     ← ← ← ← ← ←    Surface changes (add privacy
  surface changes                      policy link, change headlines)
  not reality                          without substantive change
```

**Mitigation**: Constructs that resist gaming are more consequentially valid.
Objective constructs (TQ, AC, CAR) are harder to game because they measure
verifiable structural features. LLM-holistic constructs (RS, NT) are easier
to game because the LLM's decision process is opaque to the publisher.

### 11b. The NewsGuard Cautionary Tale

NewsGuard — the closest existing analogue — demonstrates four failure modes:

1. **Political weaponization**: FCC/FTC accused NewsGuard of "blacklisting
   conservative sources." Congressional probe opened. Rating systems become
   partisan flashpoints regardless of methodological neutrality.
2. **Legal exposure**: $13M defamation suit (dismissed, but costly to defend).
   Scores framed as *opinions* get First Amendment protection; scores framed
   as *facts* don't.
3. **Advertiser pressure chain**: Low rating → excluded from ad campaigns →
   revenue loss. The score becomes a gatekeeping mechanism over publisher
   survival.
4. **Adaptive behavior**: 1 in 4 rated NewsGuard sites changed practices to
   improve their score. This is simultaneously the system *working* and
   Goodhart's Law *operating*.

### 11c. Chilling Effects

A scoring system that publishers know about and that affects their revenue
would suppress expression — ironic for a system promoting Article 19. The
risk is highest for content covering rights tensions (e.g., security vs
privacy) where taking any position risks a lower score.

### 11d. Consequential Assessment of Each Construct

```
GOODHART     LEGAL        CHILLING    WEAPONIZ-
RESISTANCE   EXPOSURE     EFFECT      ABILITY
──────────────────────────────────────────────────
TQ   HIGH    LOW (factual) LOW         LOW
AC   HIGH    LOW (factual) NONE        NONE
CAR  HIGH    LOW (factual) LOW         LOW
RS   MED     LOW (binary)  NONE        LOW
NT   LOW     MED (opinion)  MED        HIGH ★
PTD  MED     HIGH (accusation) MED     HIGH ★
ESC  MED     MED (implies hypocrisy) MED  MED
RTS  LOW     LOW (descriptive) LOW     LOW
REM  HIGH    NONE (aggregate) NONE     NONE
ICI  MED     HIGH (implies capture) HIGH HIGH ★
MCC  HIGH    NONE (meta)   NONE        NONE
```

★ = highest consequential risk

**Key finding**: NT (normative temperature) and PTD (propaganda technique
density) are consequentially dangerous — they can be weaponized as political
labels. ICI (institutional capture) is an accusation that invites legal
challenge. REM and MCC are consequentially safe because they're meta-level
patterns, not entity-level judgments.

### 11e. Presentation Framing as Mitigation

The same construct can be consequentially safe or dangerous depending on how
it's presented:

```
DANGEROUS:  "This domain is captured by its owners"
SAFE:       "Editorial alignment with ownership interests: 87%
             (methodology note: measured by...)"

DANGEROUS:  "This article uses propaganda techniques"
SAFE:       "Persuasion techniques detected by 3 of 4 models:
             appeal to authority, false dichotomy"

DANGEROUS:  "Rights compatibility: -0.4 (NEGATIVE)"
SAFE:       "Rights engagement: 4 provisions touched.
             Pattern: privacy and expression in tension."
```

The pattern: **descriptive + transparent methodology + multi-model agreement
= consequentially safe.** Evaluative + opaque + single judgment =
consequentially dangerous.

---

## 12. Perspective 5 — Comparative Landscape

Where do we sit relative to existing systems?

### 12a. Existing Systems

| System | Level | Framework | Scale | Coverage | Freq | Cost |
|--------|-------|-----------|-------|----------|------|------|
| RDR | Corporate | UDHR-grounded | 0-100 | 14 companies | Annual | Free |
| NewsGuard | Source | Journalism criteria | 0-100 | 35K sources | Ongoing | B2B paid |
| Ad Fontes | Article→Source | Bias+Reliability | 2 axes | Hundreds | Ongoing | Freemium |
| MBFC | Source | Factuality+Bias | Categorical | 10K sources | Ongoing | Free |
| Freedom House | Country | Internet freedom | 0-100 | 72 countries | Annual | Free |
| GNI | Corporate | Expression+Privacy | Qualitative | 15 companies | Biennial | Members pay |
| RSF | Country | Press freedom | 0-100 | 180 countries | Annual | Free |

### 12b. The Gap We Occupy

**No existing system does all of these simultaneously:**

1. Operates at the **individual article/story level**
2. Uses the **UDHR as the evaluative framework** (not journalism standards,
   not bias, not factuality)
3. Measures **specific UDHR provisions** (not just "privacy" in general)
4. Evaluates both **editorial and structural channels**
5. Surfaces **aggregate patterns** from individual scores

RDR is the closest neighbor (UDHR-grounded) but operates at the corporate
policy level only. Ad Fontes rates individual articles but uses bias/reliability
framing, not rights framing.

### 12c. What This Means for Construct Architecture

```
DON'T REPLICATE:          OUR UNIQUE NICHE:
  Bias scoring (Ad Fontes)   Article-level rights engagement
  Factuality (MBFC)          Provision-specific patterns
  Journalism quality (NG)    E/S channel divergence
  Corp policy (RDR)          Aggregate rights ecosystem insights
  Country-level (FH/RSF)     Cross-article rights tensions
```

**Implication**: Constructs that overlap with existing systems (EQ ≈ journalism
quality, PTD ≈ factuality) are less strategically valuable than constructs
that occupy our unique niche (RS, RTS, REM, ESC). We should build what nobody
else measures, not a worse version of what they already do.

---

## 13. Perspective 6 — Operational Feasibility

Can we compute these constructs within our constraints?

### 13a. Platform Constraints

```
CF Workers: 5 min CPU (paid); network wait time doesn't count
D1:         10 GB max; 1,000 queries/invocation (paid); 30s query timeout
KV:         TTL-based caching, 25 MB max value size
Workers AI: 10,000 neurons/day free (~15-20 evals on Llama 70B)
Budget:     ~$2.50-4/day at 500 stories with Haiku + prompt caching
```

### 13b. Feasibility by Construct

```
Construct    LLM needed?   Data exists?   Compute cost   Feasibility
──────────────────────────────────────────────────────────────────────
TQ           Partial       td_* fields    ~$0 (HTML parse) HIGH
AC           No            jargon/knowledge $0 (Flesch)    HIGH
CAR          No            Need new crawl  $0 (DOM parse)  MED (crawl)
RS           Yes (HOL)     Section scores  ~$0.005/story   HIGH
NT           Yes (HOL)     Need new prompt ~$0.005/story   HIGH
PTD          Already built pt_score exists $0 (exists)     DONE ✓
ESC/SETL     Already built E/S scores     $0 (exists)     DONE ✓
RTS          Yes (HOL)     Need new prompt ~$0.005/story   HIGH
REM          No            rater_scores   $0 (correlation) HIGH
ICI          No            domain aggs    $0 (query)       HIGH
MCC          No            rater_evals    $0 (query)       HIGH
RM           No            snapshots      $0 (query)       HIGH
SRD          No            Need text      $0 (regex)       HIGH
EQ           Already built eq score       $0 (exists)      DONE ✓
SPA          Already built sr score       $0 (exists)      DONE ✓
```

**Key finding**: Most constructs are either already computed (PTD, ESC, EQ,
SPA) or computable without additional LLM cost (TQ, AC, REM, ICI, MCC, RM,
SRD). Only RS, NT, and RTS require new LLM prompts — and these could
potentially be added to existing evaluation prompts.

### 13c. The "Free Lunch" Constructs

These constructs require zero additional LLM calls or cost:

- **TQ** — parse existing td_* fields + add HTML author/date detection
- **AC** — Flesch-Kincaid from existing text, existing jargon_density
- **REM** — correlations from existing rater_scores (rights network already
  computes this)
- **ICI** — query pattern from existing domain_aggregates + editorial alignment
- **MCC** — getModelAgreement() already exists (@internal)
- **RM** — query existing domain_profile_snapshots over time
- **SRD** — regex against UDHR vocabulary on already-fetched content

---

## 14. Perspective 7 — Personas & Jobs-to-Be-Done

Who uses this system and what are they trying to accomplish?

### 14a. User Personas

```
PERSONA 1: "The HN Browser" (primary, ~80% of traffic)
  Goal:     Browse HN stories with extra context
  Job:      "Help me decide which stories are worth reading"
  Encounter: Story cards, scores, badges on main feed
  Learns:   Incidentally, through repeated exposure to scores/labels
  Needs:    Glanceable signals, not deep analytics
  Constructs that serve: RS (badge), ESC (badge), TQ (flag)

PERSONA 2: "The Domain Investigator" (~15%)
  Goal:     Understand a specific source's rights profile
  Job:      "Tell me about this publication's relationship to rights"
  Encounter: Domain pages, domain comparison, factions
  Learns:   Deliberately, by investigating a source they care about
  Needs:    Aggregate patterns, comparative context
  Constructs that serve: ICI, RM, TQ (per-domain), ESC (per-domain)

PERSONA 3: "The Rights Researcher" (~3%)
  Goal:     Understand rights patterns across the tech ecosystem
  Job:      "Show me how human rights manifest in tech discourse"
  Encounter: Signals, rights network, Seldon, API
  Learns:   Analytically, through data exploration
  Needs:    Deep analytics, exportable data, methodology transparency
  Constructs that serve: REM, RTS, MCC, all Layer 3 constructs

PERSONA 4: "The Educator" (~2%)
  Goal:     Use the tool to teach about human rights
  Job:      "Give me examples that demonstrate rights concepts"
  Encounter: Article pages, comparison, curated feeds
  Learns:   Professionally, to teach others
  Needs:    Clear examples, exportable citations, pedagogical framing
  Constructs that serve: RTS (most), ESC, RS, filtered feeds
```

### 14b. Jobs-to-Be-Done Mapping

```
JOB                              CONSTRUCT           SURFACE
────────────────────────────────────────────────────────────────
"Is this story worth reading?"   RS (salience badge)  Feed card
"What should I notice?"          RTS (tension pair)   Story detail
"Is this source trustworthy?"    TQ + ESC + ICI       Domain page
"What patterns exist?"           REM + RM             Signals/Network
"Can I use this in teaching?"    RTS + ESC examples   Curated feeds
"How does this model work?"      MCC + methodology    Status/About
```

### 14c. The Pedagogical Funnel

Theory of Change: how does a user go from "browsing HN" to "understanding
human rights in tech"?

```
STAGE 1: EXPOSURE (100% of visitors)
  User sees scores/badges on story cards
  → "What does that number mean?"
  Constructs: RS badge, ESC badge, score color

STAGE 2: CURIOSITY (30% click through)
  User clicks a story, sees rights engagement detail
  → "I didn't realize this article is about privacy"
  Constructs: RS provision list, RTS tension pairs, TQ flags

STAGE 3: INVESTIGATION (10% explore further)
  User visits domain page, signals dashboard, rights network
  → "This publication never names its authors"
  → "Privacy and expression are anti-correlated"
  Constructs: ICI, REM, domain-level TQ/ESC, RM

STAGE 4: INTEGRATION (3% develop new mental model)
  User's understanding of tech news permanently changes
  → "Rights are a system of tensions, not a checklist"
  → "What a site says and does are different things"
  Constructs: RTS (repeated exposure), ESC (repeated exposure)
```

---

## 15. Additional Planning Frameworks

### 15a. Wardley Map: Component Evolution

Where each construct sits on the evolution axis:

```
GENESIS          CUSTOM           PRODUCT          COMMODITY
(novel,          (bespoke,        (standardized,   (utility,
 uncertain)       understood)      scalable)        invisible)
    │                │                │                │
    │   RTS          │                │                │
    │   NT           │                │                │
    │   PR           │   RS           │                │
    │   ICI          │   REM          │   TQ (via RDR) │
    │   RM           │   MCC          │   AC (via WCAG)│
    │                │   ESC/SETL     │   PTD          │
    │                │                │   EQ           │
    │                │                │                │
    │◄── build ──►│◄── leverage ──►│◄── buy/use ──►│
```

**Strategic implication**: Build where we're in Genesis (RTS, NT, ICI) — that's
our competitive advantage. Leverage where we're Custom (RS, REM, ESC). Buy/use
commodity (TQ can validate against RDR, AC against WCAG). Don't invest in
building what's already commoditized.

### 15b. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Political weaponization of scores | HIGH | HIGH | Descriptive framing, not evaluative |
| Goodhart gaming of surface signals | MED | MED | Objective constructs resist gaming |
| Defamation suit from rated domain | LOW | HIGH | Frame as opinion + methodology |
| WEIRD bias in non-English content | MED | MED | Scope limited to English HN |
| LLM model change alters all scores | MED | HIGH | Multi-model consensus, test-retest |
| Construct conflated with sentiment | HIGH | MED | Discriminant validation (P2 external) |
| User info overload, no learning | MED | MED | Progressive disclosure, badge → detail |
| Construct proliferation, no coherence | MED | MED | Max 7 primary constructs |

### 15c. Stakeholder Map

```
                    AFFECTED BY SCORES
                    ┌─────────────────────┐
                    │  Domain owners      │ ← consequential risk
                    │  Journalists        │ ← chilling effect risk
                    │  Advertisers        │ ← if scores become brand-safety
                    └─────────────────────┘
                              ▲
                    PRODUCES SCORES
                    ┌─────────────────────┐
                    │  LLM models         │ ← epistemic warrant
                    │  Methodology        │ ← normative choices
                    │  Calibration set    │ ← value-laden selection
                    └─────────────────────┘
                              ▲
                    USES SCORES
                    ┌─────────────────────┐
                    │  HN browsers        │ ← primary persona
                    │  Domain investigators│ ← secondary
                    │  Rights researchers │ ← tertiary
                    │  Educators          │ ← tertiary
                    └─────────────────────┘
```

---

## 16. Synthesis: The Construct Set That Survives All 7 Perspectives

```
              P1      P2      P3      P4      P5      P6      P7
              Valid?  Teach?  Warrant? Conseq? Niche?  Feasib? Serves
                                                               persona?
─────────────────────────────────────────────────────────────────────────
TQ            ✓✓✓     ✓✓      ✓✓✓     ✓✓✓     ✓       ✓✓✓     ✓✓
RS            ✓✓      ✓✓✓     ✓✓      ✓✓✓     ✓✓✓     ✓✓      ✓✓✓  ★
ESC/SETL      ✓       ✓✓✓     ✓✓      ✓✓      ✓✓✓     DONE    ✓✓✓  ★
RTS           ✗→✓✓    ✓✓✓     ✓✓      ✓✓✓     ✓✓✓     ✓✓      ✓✓✓  ★
REM           ✓✓      ✓✓✓     ✓✓✓     ✓✓✓     ✓✓✓     ✓✓✓     ✓✓   ★
PTD           ✓✓      ✓✓      ✓       ✗       ✓       DONE    ✓
NT            ✓✓      ✓✓      ✓       ✗       ✓✓      ✓✓      ✓
ICI           ✓✓      ✓✓      ✓       ✗       ✓✓      ✓✓✓     ✓✓
MCC           ✓✓✓     ✗       ✓✓✓     ✓✓✓     ✓       ✓✓✓     ✓
AC            ✓✓✓     ✓       ✓✓✓     ✓✓✓     ✗       ✓✓✓     ✓
─────────────────────────────────────────────────────────────────────────
★ = survives all 7 perspectives at ✓✓ or above
```

### The Final Four (+ infrastructure)

**Primary constructs** (serve all perspectives):
1. **RS — Rights Salience**: "does this content engage with rights?"
2. **ESC — Editorial-Structural Coherence**: "does it walk its talk?"
3. **RTS — Rights Tension Signature**: "which rights conflict here?"
   (restructured as pair elicitation per Section 8g)
4. **REM — Rights Entanglement Map**: "how do rights relate across the
   ecosystem?"

**Supporting constructs** (strong but narrower):
5. **TQ — Transparency Quotient**: objective anchor, RDR-validatable
6. **ICI — Institutional Capture Index**: powerful but consequentially risky

**Infrastructure constructs** (not user-facing, support validity):
7. **MCC — Model Consensus Construct**: meta-measurement, maps validity boundary
8. **AC — Accessibility Compliance**: objective, validates Article 26 claims

**Deprioritized** (fail one or more perspectives):
- NT: consequentially dangerous (weaponizable as political label)
- PTD: consequentially dangerous (accusation framing)
- SRD: no pedagogical value
- NFI, DEI, HA, ARI, PR: insufficient epistemic warrant or feasibility

### HRCB Fate

HRCB persists as a **convenience summary** of RS + RTS + ESC, but is no
longer presented as a standalone construct. The four primary constructs
tell the story; the weighted mean is a legacy artifact for backwards
compatibility.

---

## References

- Aguirre-Urreta (2024). Reconsidering formative vs reflective measurement
  model misspecification. Information Systems Journal.
- Diamantopoulos & Siguaw (2006). Formative vs Reflective Indicators in
  Organizational Measure Development.
- Feng et al. (2024). Anchoring Bias in Large Language Models. arXiv:2412.06593.
- Mathur et al. (2019). Dark Patterns at Scale: Findings from a Crawl of 11K
  Shopping Websites. ACM CSCW.
- Messick (1995). Validity of Psychological Assessment. American Psychologist.
- O'Leary (2025). An Anchoring Effect in Large Language Models. IEEE.
- Ranking Digital Rights (2025). Methods and Standards.
  https://rankingdigitalrights.org/methods-and-standards/
- Vigo & Brajnik. Automatic web accessibility metrics: evaluation framework.
- WCAG-EM (W3C). Website Accessibility Conformance Evaluation Methodology.
  https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/
