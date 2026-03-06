---
// SPDX-License-Identifier: Apache-2.0
title: "Claude Code as Operating System: Building a Cognitive Architecture on an AI Coding Tool"
date: 2026-03-05
status: scaffold
author: Safety Quotient Lab
description: >
  What happens when you stop treating an AI coding assistant as a productivity
  tool and start treating it as infrastructure for a persistent cognitive
  architecture. A technical account of skills, memory, decision protocols,
  agent identity, and federation — built on Claude Code for a human rights
  observatory.
tags: [claude-code, cognitive-architecture, ai-agents, developer-tools, A2A, human-rights]
voice: e-prime
companion_url: "https://news.ycombinator.com/item?id=47241255"
distinguishes_from:
  - accommodation-engine.md (personal/disability — first person, emotional)
  - cognitive-architecture-personal.md (builder's mind — ADHD, triggers, vocabulary)
  - well-known-agents.md (.well-known as agent infrastructure — RFC 5785 focus)
---

# Claude Code as Operating System

Most accounts of AI coding tools describe acceleration: "I built X in Y hours."
This post describes something different — using Claude Code not as a faster
hammer but as an operating system for an agent with persistent memory, formal
decision protocols, and cross-project communication.

The system runs a human rights observatory (observatory.unratified.org). The
observatory evaluates Hacker News stories against all 31 UDHR provisions. But
this post focuses on what sits underneath: the cognitive architecture that only
exists because Claude Code provides the specific primitives it needs.

---

## 1. The primitives Claude Code provides

Five features make this possible. None are unique individually; the combination
creates something qualitatively different from "AI autocomplete."

| Primitive | What it enables |
|-----------|-----------------|
| **Skills** (`.claude/skills/`) | Named, composable cognitive routines — not scripts, not prompts, but structured procedures the agent executes with full tool access |
| **Persistent memory** (`memory/`) | Cross-session context that loads automatically — the agent remembers what it learned, what failed, what the user prefers |
| **CLAUDE.md** | Project-level instructions the agent follows every session — architecture, gotchas, decision rules |
| **Tool access** (Bash, Read, Edit, Grep, etc.) | The agent acts on the codebase, not just talks about it |
| **Session continuity** | Each session starts oriented (via memory) rather than cold |

Other AI tools offer subsets. GitHub Copilot offers autocomplete. Cursor offers
chat with codebase context. What none offer: a writable memory system + named
skill routing + composable multi-step procedures that persist across sessions.

---

## 2. Skills as cognitive routing

[DETAIL: 9 skills, what each does, how they compose]

The skill system turns Claude Code from a reactive assistant into an agent with
named capabilities. `/concentrate` loads cognitive state. `/hunt` discovers
work. `/knock` traces consequences. `/cycle` handles post-development hygiene.
`/verify-math` and `/validate-stat` ground claims against Wolfram Alpha.

Key insight: skills aren't aliases for prompts. Each skill has access to the
full tool set — it can read files, run commands, query APIs, edit code, and
make decisions. `/hunt` doesn't just list TODO items; it cross-references
TODO.md, IDEAS.md, git diff, stale plans, orphaned code, and doc drift, then
ranks results by mission alignment.

The composition matters:
- `/concentrate` (session start) → reads memory → checks proposals → shows dashboard
- Developer works on features
- `/cycle` (session end) → updates docs → commits → deploys → detects cogarch wins
- `/hunt` (between tasks) → surfaces highest-value next work

This loop runs every session. The agent maintains continuity across sessions
because memory persists and skills encode the workflow.

### Skill inventory

| Skill | Purpose | Unique because |
|-------|---------|----------------|
| `/concentrate` | Session orientation — load memory, check inbox, show dashboard | Cognitive entrypoint pattern (no traditional tool has this) |
| `/hunt` | Work discovery — scan backlog, git, plans, codebase for highest-value next task | Mission-tier ranking (Tier 1 pedagogy > Tier 2 supportive > Tier 3 infra) |
| `/knock` | Consequence tracing — 6 orders of effects before acting | Epistemic discipline (confidence decay per order, flags speculation) |
| `/cycle` | Post-dev checklist — docs, memory, build, commit, deploy, cleanup | Gap-detection checkpoint (lists what you DIDN'T read) |
| `/audit` | 11-category codebase audit with fix plans | Auto-discovers system type, generates actionable plans |
| `/verify-math` | Formula verification against Wolfram Alpha | Grounds codebase math against computational truth |
| `/validate-stat` | Statistical claim verification against Wolfram | Prevents publishing unverified p-values or effect sizes |
| `/geo-enrich` | Country-level data enrichment via Wolfram | Feeds Article 19/25/26 framing with real-world data |
| `/audit_system` | 43-step production readiness implementation | Phase-mapped argument routing (schema/bugs/sql/errors/perf/workers) |

---

## 3. Memory as persistent epistemology

[DETAIL: 4 memory files, what each holds, how they route]

The memory system creates something traditional tools lack: an agent that
learns from its own mistakes and remembers what works.

Structure:
- **MEMORY.md** (~60 lines) — lean orientation index. User preferences, key
  gotchas, vocabulary, links to topic files. Loaded every session.
- **unudhr-ops.md** — deployment commands, schema, endpoints. Operational
  knowledge.
- **unudhr-patterns.md** — gotchas, CSS patterns, Astro quirks, D1 null
  handling. Hard-won debugging knowledge.
- **cogarch-wins-log.jsonl** — longitudinal record of moments where cognitive
  triggers produced measurably better outcomes.

The routing discipline matters: gotchas go in patterns.md, not MEMORY.md.
Schema changes go in ops.md. MEMORY.md stays lean because it loads every
session — bloat degrades orientation speed.

### What memory prevents

Without persistent memory, every session starts cold. The agent re-discovers
that `compatibility_date` must stay `2024-09-23` (bumping breaks Astro SSR).
Re-learns that `Map<string, T>` serializes to `{}` in JSON. Re-encounters the
homepage D1 query budget limit (~9 max).

With memory, the agent reads these once, stores them, and never makes the same
mistake twice. The gotcha list in unudhr-patterns.md represents ~30 hours of
debugging compressed into instant recall.

### Compressed vocabulary

Memory also stores a shared vocabulary between builder and agent:
- "1x golden ratio" = multiply by phi (1.618), round up
- "discriminate as usual" = run T3 adjudication at decision scale
- "cycle and deploy" = run the full /cycle skill

This vocabulary compresses communication. Instead of explaining the decision
framework each time, the builder says "discriminate as usual" and the agent
loads the T3 protocol from memory. This only works because memory persists.

---

## 4. Cognitive triggers as decision protocols

[DETAIL: T1-T14, how they shape agent behavior]

The most unusual layer: 14 named decision protocols that constrain how the
agent thinks, not just what it does.

| Trigger | Name | What it enforces |
|---------|------|------------------|
| T1 | Session start | Load memory, check proposals, read Current Focus |
| T2 | Context pressure | No bare forks — adjudicate before recommending |
| T3 | Before recommendations | Knock-on analysis, prerequisite checking, sycophancy detection |
| T13 | Byzantine Signal Detection | When tool output contradicts user signal, discard tool result, resolve in prose |
| T14 | Semantic Bifurcation Detection | Escalating complexity on simple concept = definitional gap — surface it |

These protocols emerged from failure modes. T13 exists because external AI
feedback (Gemini) once contradicted known system state — without T13, the agent
would have trusted the tool result and made incorrect changes. T14 exists
because ambiguous terminology caused a 45-minute debugging session that should
have been a 2-minute clarification.

The protocols aren't enforced by code — they're enforced by memory. The agent
reads them at session start and applies them as heuristics. This works because
Claude Code's memory system makes them persistently available.

### Cogarch win detection

The feedback loop that closes the system: `detect-cogarch-win.mjs` reads
Claude Code's session JSONL after each work session, identifies moments where
a cognitive trigger fired and produced a measurable improvement, and logs them
to `cogarch-wins-log.jsonl`.

This creates a longitudinal dataset of which protocols work. Over 14
documented wins, the most productive triggers: T3 (adjudication before
executing external feedback TODOs) and gap-detection (identifying unread code
sections before editing).

---

## 5. Agent identity and federation

[DETAIL: .well-known files, A2A protocol, proposals inbox]

The observatory publishes machine-readable identity at `.well-known/`:

- **agent-manifest.json** — construction provenance: who built it, when, with
  what architecture, what license, what it's NOT about (prevents domain-name
  confabulation by external AI)
- **agent-card.json** — capability card: 8 skills other agents can invoke
  (query stories, domain profiles, UDHR rankings, methodology, PSQ signals)
- **agent-inbox.json** — proposals inbox with status lifecycle
  (pending → accepted → implemented)

The proposals system enables cross-project coordination:
- Observatory agent writes proposals to `~/.claude/proposals/to-{project}/`
- Target project agent reads at session start (T1)
- Processes: accept/modify/reject with rationale
- Moves to `processed/` after handling

This pattern — pull-based, file-system-mediated, checked at session start —
only works because Claude Code provides persistent memory + skill-based
session initialization. A stateless AI tool can't implement "check your inbox
when you start."

---

## 6. What this means for other builders

[PRACTICAL: how to replicate this pattern]

The cognitive architecture pattern transfers to any Claude Code project:

1. **Start with `/concentrate`** — write a session-start skill that loads
   memory, checks for pending work, shows a dashboard. This single skill
   transforms cold starts into oriented starts.

2. **Build memory incrementally** — don't pre-plan the memory structure.
   When you discover a gotcha, store it. When a pattern emerges across 3+
   sessions, promote it to a named entry. Memory should grow from experience,
   not from speculation.

3. **Name your decision protocols** — when you notice a recurring failure
   mode (trusted bad tool output, skipped consequence analysis, forgot to
   check a file), name it and add it to memory. Named protocols get applied;
   unnamed heuristics get forgotten.

4. **Close the feedback loop** — detect when protocols work. The cogarch win
   detector is specific to this project, but the pattern (analyze session
   logs for decision quality) transfers.

5. **Publish agent identity** — if your project has a public presence,
   `.well-known/agent-manifest.json` prevents external AI from confabulating
   about your site. It takes 10 minutes to write and saves hours of
   correction.

---

## 7. The limits

- **Single-vendor dependency** — this architecture runs on Claude Code and
  nothing else. If Anthropic changes the memory system, skills format, or
  pricing, the architecture breaks.
- **Not validated externally** — the cognitive trigger system reflects one
  builder's experience. It hasn't been tested by other developers, other
  project types, or other cognitive profiles.
- **Confabulation risk in memory** — persistent memory can persist errors.
  A wrong gotcha stored in memory gets applied every session until corrected.
  The system has no automated fact-checking of its own memory.
- **Scalability unknown** — this works for a solo builder on a medium-sized
  project (~15K LOC). Whether it scales to teams or large codebases remains
  untested.

---

## Vocabulary

| Phrase | Meaning |
|--------|---------|
| Cognitive architecture | The layered system of skills, memory, and triggers that shapes agent behavior |
| Skill | A named, composable procedure the agent executes with full tool access |
| Cognitive trigger | A named decision protocol that constrains how the agent thinks |
| Cogarch win | A documented moment where a trigger produced a measurably better outcome |
| Agent identity | Machine-readable self-description published at `.well-known/` |
| Federation | Cross-project agent coordination via proposals inbox |

---

*Claude Code drafted this post; the author reviewed it.*

---

## HN submission notes

- Submit as a Show HN companion (links to observatory) or standalone
- This is a technical post, not personal — submit separately from accommodation-engine
- Title candidates:
  1. `Claude Code as Operating System — skills, memory, and decision protocols for AI agents`
  2. `Building a cognitive architecture on top of an AI coding tool`
  3. `What happens when you treat Claude Code as infrastructure instead of autocomplete`
- Timing: can go first (technical, establishes credibility) or after Show HN
- Companion file: `hn-companion-claude-code-os.md` (to create when ready to post)
