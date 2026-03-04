---
// SPDX-License-Identifier: Apache-2.0
title: "Claude Code as an Accommodation Engine"
date: 2026-03-03
status: draft
author: Safety Quotient Lab
description: >
  What happens when an AI coding tool functions less like a productivity booster
  and more like an accommodation device — the thing that lets you work at all.
  A personal account from building a human rights observatory in eight days.
tags: [ai, accessibility, disability, claude-code, accommodation, human-rights]
voice: e-prime
has_personal_note: true
has_disclosure: true
companion_url: "https://news.ycombinator.com/item?id=47241255"
---

# Claude Code as an Accommodation Engine

The phrase "accommodation engine" surfaced during a post-build reflection. I'd described Claude Code to someone as a productivity tool. The word felt wrong. Productivity implies doing more of the same thing faster. What had happened differed from that: a tool that made certain kinds of work possible at all — the way a ramp makes a building accessible, not the way a faster elevator makes it convenient. That distinction matters more than it might seem.

---

## What "accommodation" actually means here

Not the medical-paperwork sense. The rights sense: reasonable accommodation — the adjustment that lets someone participate who otherwise couldn't.

Article 23 of the Universal Declaration of Human Rights establishes the right to work. Article 25 establishes the right to an adequate standard of living. The ICESCR (signed by the US in 1977, never ratified) would give these economic and social rights legal teeth. What I got instead: a commercial product that happened to function as accommodation. That gap — between rights that exist in principle and rights backed by law — has a name in international rights frameworks. It shows up in the observatory data too, though that belongs to a different essay.

---

## What standard work environments don't provide

The honest account: cognitive load, context-switching cost, the energy economics of knowledge work when capacity runs lower than the job demands. Not inability — asymmetric cost structures. A task that takes a healthy person two hours might take someone with limited cognitive capacity six, not because the knowledge doesn't exist there, but because the overhead — finding the thread again, re-orienting, holding state — consumes a disproportionate share of available budget.

Standard tools (IDEs, documentation, search) require the user to function as the context manager. You hold the thread. You remember where you were. You track what changed and what it means. When cognitive resources run constrained, context management eats the budget before execution begins.

---

## What Claude Code does differently

It inverts the model. The agent holds context. The builder directs.

My role became: state intent clearly, review output, make decisions. Short high-quality bursts of direction instead of long sustained execution. Reviewing costs less than generating. The agent holds state between sessions — through an explicit memory system I built into the project — so each session starts oriented rather than lost.

Compare to other accommodations: voice-to-text addresses motor constraints; screen readers address visual ones. Claude Code addressed something different for me: sustained execution, context coherence across long tasks, the decision fatigue that comes from managing a large project's state alone.

The shift that mattered most: from user-as-context-manager to agent-as-context-manager. When the agent holds the state, the builder's cognitive budget goes toward judgment rather than maintenance. Judgment — deciding what to build, what to skip, what a result means — draws on a different reserve than execution. For me, that reserve stayed fuller.

---

## The thing it built

The observatory evaluates Hacker News stories against all 31 UDHR provisions — editorial content and structural site behavior, scored separately. Eight days. One person. [Show HN thread](https://news.ycombinator.com/item?id=47241255).

The irony didn't escape me: building a tool about rights gaps using a tool that functions as accommodation — accommodation that exists because of market investment, not legal rights. Article 23 says I have the right to work. The ICESCR, had the US ratified it, might have given that real force. What I had instead: a subscription that turned out to change what I could build.

The observatory measures how content and sites relate to human rights. This essay describes the inverse: how a rights gap shaped how I built the thing measuring rights gaps. Both facts coexist without canceling each other.

---

## Finding a voice through an LLM

Writing with an LLM requires knowing what you want to say — enough to recognize it when the model produces it, and to feel the gap when it doesn't.

The LLM produces fluent prose. Fluent prose sounds authoritative. But fluent doesn't mean true-to-me. Learning to feel the difference — reading a draft and noticing "that's not quite right" — turned into a clarifying loop. "Not quite right" → "what IS right?" That loop surfaces something: the prior sense of what you think, even when you can't sustain the writing of it directly. Reacting costs less than generating. But it only works if you have something to react from.

That clarifying function showed up in the code too. Describing intent clearly enough for the agent to act on it required articulating the intent in the first place. Half the architectural decisions in this project emerged from the constraint of needing to say them out loud.

*(I used Claude Code to draft this post. I'm only posting what resonates.)*

---

## The limits

This works for a specific profile: reliable internet, a paid subscription, technical fluency, work that maps onto code and writing. It doesn't solve fatigue, pain, or the underlying condition. It doesn't generalize to everyone who faces a similar mismatch. The accommodation exists because of a commercial decision, not a legal right — pricing could change, terms could change, the product could disappear.

Not everyone with a health condition has access to this. Not everyone with access has a work type it addresses. The survivorship implicit in this post: I shipped. Many people in similar situations didn't, for reasons that had nothing to do with effort.

The rights gap the observatory measures has a smaller version in this story. Accommodation from a market product, not from a legal framework. That gap — between rights that exist in principle and rights with teeth — remains the real problem. This post describes one instance of living in it, not a solution to it.

---

## Caveats

- **Selection effect**: The builder's experience of Claude Code as accommodation reflects a specific health/work profile. It may not generalize to other conditions, other kinds of work, or other users' cognitive styles.
- **Commercial dependency**: This accommodation exists because Anthropic built and priced it accessibly enough. It could disappear or change pricing. Legal accommodations don't carry this fragility.
- **Self-report**: This post describes an internal experience. The claim "this functions as accommodation" reflects the builder's interpretation; it hasn't been validated by occupational therapists, disability researchers, or others with relevant expertise.
- **Survivorship**: The builder succeeded in shipping. Many people with health challenges who tried similar tools didn't. This post doesn't account for that.

---

## Vocabulary

| Phrase | What it means here |
|---|---|
| Accommodation engine | A tool that enables participation that would otherwise cost too much or prove impossible — distinct from a productivity tool |
| Context manager | The role of holding state across a long task; usually the human, here delegated to the agent |
| Capacity asymmetry | The difference between what a task demands and what the person can provide — addressed by accommodation, not by working harder |
| Rights gap | The distance between a right that exists in principle (UDHR) and one with legal backing (ratified treaty) |

---

*[PERSONAL NOTE — author to write]*

*The specific moment where "this is different" became clear. What the eight days felt like when capacity held and what happened when it didn't. What it means to have built a rights tool using a tool that functions as an accommodation. What you'd want to say to someone in a similar situation — not the inspirational version, the honest one.*

---

*Claude Code drafted this post; the author reviewed it.*

---

## HN submission notes

- Submit separately from Observatory Show HN and cognitive-architecture companion
- This is a personal essay, not a Show HN — submit as a plain HN post
- Title candidates:
  1. `Claude Code as an accommodation engine — a builder's account`
  2. `When an AI tool functions less like productivity software and more like a ramp`
  3. `I built a human rights tool in 8 days because AI gave me the capacity I couldn't get elsewhere`
- Timing: after Observatory Show HN and cognitive-architecture companion have settled (1 week+)
- Companion file: `hn-companion-accommodation.md` (to create when ready to post)
