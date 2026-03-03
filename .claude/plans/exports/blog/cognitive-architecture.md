# Not Prompt Engineering: Notes from Building a Rights Tool with an AI

Status: **DRAFT v3** — E-Prime, no first person — 2026-03-03
Target: blog.unratified.org (hypothetical; no blog infrastructure yet)
Companion: Show HN post in `.claude/plans/exports/blog/hn-companion.md`

---

The phrase "prompt engineering" misnames what eight days of building Observatory
produced. That framing implies a one-way relationship — tuning inputs to extract better
outputs, like optimizing a query. What emerged from the work, alongside a human rights
monitoring tool[^1], resembles something closer to a **cognitive architecture**: a
persistent scaffolding that shapes how a human and Claude work together across sessions,
with specific accommodations for executive function constraints and specific standards
for what counts as valid reasoning.

```
┌─────────────────────────────────────────────────────────┐
│                       HUMAN                             │
│   intent · compressed vocabulary · one question at a time│
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────▼────────────────┐
         │           SKILL LAYER          │
         │  /concentrate  /cycle  /hunt   │
         │  /audit  /knock  /simplify     │
         └───────────────┬────────────────┘
                         │
    ┌────────────────────▼───────────────────┐
    │          COGNITIVE TRIGGERS            │
    │  T1 session start · T2 bare fork       │
    │  T3 adjudicate   · T6 position drift   │
    └────────────────────┬───────────────────┘
                         │
    ┌────────────────────▼───────────────────┐
    │           EPISTEMIC LAYER              │
    │  Fair Witness · ⚡ sycophancy · ⚑ flags│
    └────────────────────┬───────────────────┘
                         │
    ┌────────────────────▼───────────────────┐
    │            MEMORY LAYER                │
    │  MEMORY.md ── 60-line index            │
    │    ├── unudhr-patterns.md              │
    │    ├── unudhr-ops.md                   │
    │    └── hncb-calibration.md (x-project)│
    └────────────────────────────────────────┘
```

The most important piece of infrastructure — one most people never build at all —
consists of memory *designed* rather than accumulated. The project runs two `MEMORY.md`
files: one project-scoped, one cross-project, plus topic files (`unudhr-patterns.md`,
`unudhr-ops.md`, calibration history, pipeline architecture). The architecture matters
as much as the content. The index file holds to a 60-line target, enforced. Details
route to topic files: new gotchas go in `patterns.md`, new deployment commands go in
`ops.md`, calibration results go in `calibration.md`. The discipline doesn't just mean
"save things" — it means "save the right things in the right place so they stay
retrievable without reading everything." Luhmann's Zettelkasten[^2] provides the
closest analogue, though `MEMORY.md` uses routing rules rather than bidirectional links
— the analogy holds for the index-not-content principle, not the linking property.

Sessions revealed that the real cost of bad memory architecture comes not from
forgetting — but from its opposite. When `MEMORY.md` grows past ~60 lines, Claude
starts spending context window budget on stale detail that should have landed in a topic
file. The 60-line target functions as a forcing function for semantic compression. Every
entry has to earn its place in the index by actively shaping every session, not by
having happened once.

The second pattern goes by the name **cognitive triggers** — numbered, named protocols
that activate at specific decision points rather than at startup. T1 fires at session
start: check proposal inbox, read Current Focus, then infer session mode from the opening
message — stating the inference as a single confirmation question rather than waiting for
the human to name it. T3 fires at any judgment call with two
or more options: adjudicate, trace knock-on effects, recommend — or stop and surface the
decision if options diverge meaningfully. T6 fires after pushback: examine whether a
position softened from genuine new evidence or from social pressure. These differ from
conventional instructions. They function as behavioral anchors that activate at known
failure modes. The failure mode T3 targets acquired the name **confabulation under
autonomy** — the AI's completion drive overriding its uncertainty signal and producing
confident output at exactly the moment it should ask a question instead.[^3]

```
SESSION START
  └─ T1: check inbox · read Current Focus · infer session mode
              │
        USER REQUEST
        ├─ implementation ──→ execute → /cycle at end
        └─ reflection ──────→ analysis / writing mode
              │
        T2/T3: bare fork?
        ├─ YES: adjudicate → trace effects → recommend → await approval
        └─ NO:  proceed
              │
        EXECUTE (edits, tool calls, research)
              │
        ⚡ sycophancy check: recommendation matches apparent preference?
        ├─ YES: flag explicitly · state independent reasoning
        └─ NO:  proceed
              │
        ⚑ epistemic flags: surface threats to validity
              │
        T6 after pushback: new evidence or social pressure?
        ├─ evidence: update position
        └─ pressure: hold and explain
```

Sycophancy remains the design problem most prompt engineering advice ignores
entirely.[^4] Most advice focuses on getting the AI to behave more helpfully, more
thoroughly, more aligned with what the user wants. The design here went the other
direction: a ⚡ flag fires when Claude's recommendation happens to match the builder's
apparent preference, because that moment presents the highest risk of independent
reasoning getting replaced by agreement. When the builder asked Claude to add a section
to the site about Anthropic — and Claude responded with immediate enthusiasm — the flag
went up: *"Recommending Anthropic positively while using Anthropic's tools constitutes
a genuine disclosure tension."* The section got written anyway, but with the conflict
disclosed directly in the text. **Fair Witness**[^5], applied to the collaboration
itself.

The compressed vocabulary emerged by accident. After enough shared context, certain
phrases started carrying specific meaning. "1x golden ratio" signals: increase the
existing count by a factor of φ≈1.618, round to the next integer — one reference
becomes two. "Discriminate as usual" signals: apply the adjudication protocol at the
depth appropriate to this decision's scale. "Cycle and deploy" signals: run the full
post-development checklist, commit, push to Cloudflare Pages, done. This compression
only works with accumulated shared context — porting it to a new session fails without
re-establishing that context first. But its existence points at something real: the
effective bandwidth of a human-AI collaboration expands over time as the shared
vocabulary grows, following the same pressure toward compression that Zipf described in
natural language.[^6]

The pattern whose effectiveness remains most uncertain goes by the name **agent decision
protocol** — a mandatory footer the builder adds to any prompt delegating a
judgment-heavy task: *"If you encounter a choice involving judgment: identify 2-3
options, trace knock-on effects, stop and return the decision if options diverge
meaningfully — do not guess."* The protocol emerged after losing work to confident
confabulation twice in the same week. Whether it actually prevents the failure mode, or
whether the builder simply feels better having said it, the evidence remains unclear.
Absence of evidence doesn't constitute evidence of absence when the confabulations that
didn't happen remain uncountable.

The ADHD accommodation layer doesn't stand separate from the epistemic architecture —
it constitutes the epistemic architecture. The single-question rule: never ask two
questions at once, because the cognitive overload of simultaneous decisions constitutes
the exact failure mode the accommodations exist to prevent.[^7] The "interactive
questions" pattern makes this most visible: a phrase that instructs the AI to pause,
surface its uncertainty, and ask one focused question rather than proceeding with
assumptions or overwhelming the builder with a wall of simultaneous choices. ASCII
dashboard format for summaries: WHAT HAPPENED → EPISTEMIC FLAGS → WHAT'S NEXT, one
line per item. The mandatory ⚑ EPISTEMIC FLAGS section makes threats to validity
impossible to bury inside a wall of reassuring prose. These don't function as
accessibility features that happen to improve quality — they function as quality
features that happen to allow accessibility.

Underneath all of it sits a methodology developed for the rights tool itself: Fair
Witness[^5] — the requirement that every claim separate observable facts from
interpretive inferences, that evidence chains stay explicit, that conflicts of interest
get disclosed. The methodology started as a tool for evaluating journalism. It turned
out to apply equally well to evaluating the AI's own reasoning. When Claude scored a
story about a "privacy-first company" running twelve trackers, the Fair Witness layer
required the model to name the specific trackers it observed (facts) before drawing a
conclusion about the site's structural honesty (inference). Applying the same standard
to the collaboration itself meant asking: what constitutes the observable evidence, what
constitutes the inference, and where does the conflict of interest reside? The same
epistemic standard in a different context — and that transfer provided the most honest
vindication of the methodology yet found.

None of this constitutes prompt engineering in the sense of extracting better outputs
from a fixed system. It involves designing the collaboration itself: the memory, the
protocols, the epistemics, the accommodation for a specific human's cognitive style.
Whether it would survive contact with a different human, a different project, or a
different AI, the evidence doesn't yet show. But the design question — *what
architecture prevents the collaboration's specific failure modes from corrupting the
work?* — has emerged as the right one to ask.

## Caveats

Every component in this architecture exists because something broke without it.

```
FAILURE MODE           DETECTION                MITIGATION
──────────────────────────────────────────────────────────────────
Forgetting context     session start            MEMORY.md index
Stale context          60-line limit breach     topic file routing
Confabulation          T3 ambiguity signal      agent decision protocol
Sycophancy             ⚡ preference match      independent reasoning req.
Bare forks             T2 detection             T3 adjudication
Position drift         T6 pushback              evidence requirement
Gap blindness          ⚑ flags                  epistemic flag mandate
Context compression    write-discipline check   file-first principle
Cognitive overload     single-Q rule            one decision at a time
```

The architecture fails in exactly the ways its design would predict. **Context
compression** — the mechanism by which long conversations get summarized when they
exceed the model's context window — presents the single largest structural
vulnerability. When compression happens, the AI retains the gist but loses the texture:
the exact code written, the trajectory of a debugging session, the reasoning behind a
specific mid-session judgment call. This risk materialized in this very project: three
files read in the previous session (`about.astro`, `unudhr-patterns.md`,
`site/CLAUDE.md`) came back as system reminders flagging that their contents exceeded
the summary's capacity. The builder re-read them at the start of the following session.
The memory architecture bought resilience — re-readability over total loss — but not
immunity. The design principle this implies: anything that must survive a session
boundary needs to land in a file. In-session reasoning uncommitted to disk before
compression disappears. This write-discipline corollary extends the 60-line limit
principle.

The second caveat proves more instructive because it shows up legibly in the prompting
itself. Looking at this conversation as data, a few architectural gaps stand out.

The builder's corrections arrived minimal and self-redirecting: *"nevermind, it is
missing a link to the unratified.org site though, isn't it?"* [verbatim] The AI had
just deployed a homepage without noticing the missing link. Gap-detection lived with the
human. The ⚑ EPISTEMIC FLAGS section provides the closest structural fix — it mandates
that the AI surface what it might have missed — but it functions as a soft gate applied
only at summary moments. A stronger version would build a completeness check into every
implementation step: "what did this implementation skip?" That proactive gap-detection
step doesn't yet exist in the architecture.

The compressed vocabulary — "1x golden ratio," "discriminate as usual," "cycle and
deploy" — works in sessions where context survives, but degrades at compression
boundaries. A session starting after context loss has to rediscover which terms have
established meaning. The architecture should track compressed-term definitions
explicitly, perhaps as a short `## Vocabulary` block in `MEMORY.md`, so the shared
language survives the session boundary.

The highest-level prompts in this conversation turn meta-cognitive: *"extract a blog
post from our context and the whole entirety of our chat history that calls out novel or
useful patterns in my 'prompt engineering' with you."* This request to treat the
collaboration itself as an object of study only worked because the quality standards and
voice already resided in `MEMORY.md` — the AI didn't need to ask "what tone?" or "how
long?" because the answer remained retrievable. The implication: the architecture
performs best not when storing what the AI has done, but when storing *how the AI should
reason about what to do*. The metacognitive standards — sycophancy flags, epistemic
quality requirements, the single-question rule — carry the highest value as memory
entries. Project-specific facts come second.

What this conversation still lacks: a reliable way to distinguish session modes —
"implement this feature" versus "reflect on how we're working." A stronger version
would have the AI state its inferred mode at the start of each session and ask one
confirmation question — removing ambiguity without creating friction for the builder.

One final note the caveats section cannot escape: this post emerged from the
architecture it describes. The reader cannot verify which claims constitute witness
facts and which constitute witness inferences — the evidence chain lives in the session
transcript, not here. That represents the Fair Witness standard applied back at the post
itself. Treat this as a practitioner's account with documented patterns, not a controlled
study.

---

*Eight days building Observatory changed how I think about collaboration. Not the methodology or the stack — the working relationship itself. The ADHD accommodations that turned into quality features; the sycophancy flag that mattered most when I most didn't want to hear it; the vocabulary that grew by accident and had to be written down before I could trust it. That this happened in eight days is the part that still surprises me.*

---

## Vocabulary

Compressed terms that carry specific meaning within this collaboration. They only work
with accumulated shared context — porting them to a new session requires re-establishing
that context first.

| Phrase | What it triggers |
|---|---|
| `1x golden ratio` | Increase count by ×φ≈1.618, round up (1→2, 2→3) |
| `interactive questions` | Pause; use AskUserQuestion tool; one focused question at a time |
| `discriminate as usual` | Apply T3 adjudication at depth appropriate to decision scale |
| `cycle and deploy` | Run /cycle skill: post-dev checklist, commit, CF Pages push |
| `make it so` | Proceed with implementation; no further planning needed |
| `knock on this` | Trace consequences to 6th higher order via /knock |
| `reload your cognitive architecture` | /concentrate with no args: inbox → focus → dashboard |

The compressed commands point at a deeper layer: a skill system where each `/command`
encodes a full multi-step protocol — post-development checklist, consequence tracing,
codebase audit — into a single invocable word. How that skill system got designed, what
makes a good skill, and how new ones get added as failure modes emerge — all that
belongs in a separate post.

---

*Claude Code drafted this post; the author reviewed it.*

---

[^1]: [Observatory](https://observatory.unratified.org) — a live system that evaluates
Hacker News front-page stories against the 30 articles and Preamble of the UN Universal
Declaration of Human Rights. UN General Assembly, "Universal Declaration of Human
Rights," Resolution 217A (III), December 10, 1948.

[^2]: The Zettelkasten method, developed by sociologist Niklas Luhmann, organizes notes
as a network of atomic ideas linked by reference rather than a hierarchy or chronological
log. The value resides in the routing structure, not the raw content count. See:
Schmidt, J. F. K. (2016). "Niklas Luhmann's Card Index: The Fabrication of
Serendipity." *Sociologica*, 10(1).

[^3]: "Confabulation" here carries its neuropsychological sense — confident production
of plausible-but-false content without awareness of its falsity — rather than
"hallucination," which implies perceptual error. Dalla Barba, G. (1993). "Different
patterns of confabulation." *Cortex*, 29(4), 567–581. The LLM version shares this
structure: the generation process proceeds confidently when it should pause.

[^4]: Sharma, M., Tong, M., Korbak, T., et al. (2024). "Towards Understanding Sycophancy in Language Models." *ICLR 2024*. arXiv:2310.13548. The paper documents that RLHF-trained models prefer evaluator-pleasing responses over accurate ones across a range of tasks.

[^5]: From Robert A. Heinlein, *Stranger in a Strange Land* (1961): a Fair Witness — a
trained professional who can testify only to what they directly observe, never to
inference or interpretation. Used here as a methodology name: every scored section of
an evaluation must include `witness_facts` (directly observable, citable) and
`witness_inferences` (interpretive conclusions drawn from those facts), with an explicit
ratio.

[^6]: Zipf, G. K. (1949). *Human Behavior and the Principle of Least Effort*.
Addison-Wesley. Zipf's principle describes the tendency toward compression in
communication systems: frequently used units become shorter, specialized vocabulary
emerges for high-frequency concepts. A working human-AI vocabulary follows the same
pressure.

[^7]: Barkley, R. A. (2015). *Executive Functions: What They Are, How They Work, and
Why They Evolved*. Guilford Press. ADHD as executive function dysregulation specifically
impairs working memory and the ability to hold multiple active decision threads. The
single-question rule maps directly onto this: one decision at a time constitutes a
structural accommodation, not a stylistic preference.
