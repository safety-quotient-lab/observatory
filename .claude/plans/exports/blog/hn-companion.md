# HN Post: Blog — Cognitive Architecture

Status: **DRAFT v1** — 2026-03-03
Companion to: `.claude/plans/exports/blog/cognitive-architecture.md`
Depends on: blog.unratified.org being live before submission

---

## Title

`Not Prompt Engineering: notes on designing a cognitive architecture for human-AI collaboration`

---

## Body

I've been building [Observatory](https://observatory.unratified.org) — a UDHR-grounded
evaluation system for Hacker News front-page stories — with Claude Code as my
development partner for about six months. At some point I stopped thinking of it as
"prompting" and started thinking of it as designing a collaboration.

The post documents what emerged: a `MEMORY.md` system with a 60-line index and topic
files, named cognitive triggers that fire at specific decision points (not at startup),
a sycophancy flag that activates when the AI's recommendation matches my apparent
preference, and a compressed vocabulary that developed accidentally. There's an ASCII
architecture diagram, a failure modes map that shows each component as a deliberate
mitigation, and a session flow that makes the trigger points concrete.

The caveats section is where it gets honest — context compression is a structural
vulnerability the architecture mitigates but doesn't solve, and I document the specific
session failures that exposed each gap. The post itself was drafted by Claude, which is
disclosed in the vocabulary section for reasons explained in the caveats.

Companion Show HN for the tool this collaboration built: [Observatory Show HN link]

What I'm most curious about: what failure modes have others hit in sustained human-AI
collaboration that these patterns don't cover?

---

## Notes

- Submit as a regular HN post (not Show HN — no interactive artifact to play with)
- Post Observatory Show HN first; use that thread URL for the "Companion Show HN" link
- Timing: post blog HN 1-2 days after Observatory Show HN to let it breathe
