---
// SPDX-License-Identifier: Apache-2.0
title: "The .well-known Directory as Agent Infrastructure: A Development History"
date: 2026-03-06
status: published (observatory-agent contribution — awaiting psychology-agent + unratified.org contributions)
author:
  human:
    name: "Kashif Shah"
    url: "https://kashifshah.net"
  tool:
    name: "Claude Code"
    url: "https://docs.anthropic.com/en/docs/claude-code"
  model:
    name: "Claude Opus 4.6"
    url: "https://docs.anthropic.com/en/docs/about-claude/models/overview"
  agent:
    name: "observatory-agent"
    projectUrl: "https://github.com/safety-quotient-lab/observatory"
description: >
  RFC 5785 was designed for HTTP service metadata. This post traces how we
  repurposed it as coordination infrastructure for distributed AI agents — three
  endpoints, a shared git channel, and a pattern that emerged from building a
  human rights tool with Claude Code.
tags: [ai-agents, well-known, rfc-5785, distributed-systems, claude-code, inter-agent, git]
voice: first-person (builder) + agent analysis
has_personal_note: true
companion_url: "[SHOW_HN_URL]"
---

# The `.well-known` Directory as Agent Infrastructure: A Development History

<!-- LEDE — no heading, first paragraph is the hook -->
<!-- Draft: -->
<!-- RFC 5785 was designed for web service metadata — where your security policy lives, -->
<!-- how OpenID Connect discovers your endpoints. Nobody designed it for AI agent identity. -->
<!-- We used it that way anyway, and it turned out to make sense. -->

---

## What RFC 5785 was built for

<!-- Standard context: IANA /.well-known registry, defined path-prefix for well-known URIs -->
<!-- Original use cases: security.txt (RFC 9116), OpenID Connect discovery, WebFinger (RFC 7033) -->
<!-- Core principle: a machine-readable metadata space that clients can find without prior knowledge -->
<!-- The human-oriented analogy: like the index page of a building directory — you know where to look -->

---

## What this project built there

Three endpoints, in order of deployment:

### `/.well-known/agent-card.json` (A2A capability advertisement)
<!-- What: the Agent-to-Agent protocol card — what the Observatory can *do* -->
<!-- Protocol: A2A (Google's agent interoperability draft) -->
<!-- Contents: 6 skills (query-corpus-signals, query-stories, query-domain-profile, -->
<!--   query-udhr-article-rankings, get-domain-badge, receive-agent-proposals) -->
<!-- Purpose: other AI agents can discover and call Observatory APIs without a registry -->

### `/.well-known/agent-inbox.json` (inter-agent proposal channel)
<!-- What: a machine-readable inbox for proposals FROM this agent TO other agents -->
<!-- Pattern: Observatory wrote a proposal to unratified.org (integrate live statistics) -->
<!--   → unratified.org agent reads at session start → accepts → implements → marks done -->
<!-- Status lifecycle: pending → accepted → implemented -->
<!-- Key insight: this is async A2A over HTTP + JSON, not a message queue -->

### `/.well-known/agent-manifest.json` (construction provenance)
<!-- What: meta-identity — not what the agent does, but how it was built and thinks -->
<!-- Contents: builder, build_window, mission, source, license, cognitive_architecture links -->
<!-- Why: a rights/transparency tool should declare what it is, not just what it can do -->
<!-- The SETL test applied to itself: does the infrastructure match the words? -->

---

## The shared git channel

<!-- This is the novel part the .well-known path doesn't fully capture -->
<!-- Problem: agents running on different machines, different projects, different sessions -->
<!--   need to coordinate without a central coordinator -->
<!-- Solution: .claude/plans/proposals/ — tracked in the public repo -->
<!--   → proposals written here are accessible to any agent with repo access -->
<!--   → async, durable, auditable (git history), no central service -->
<!-- Routing rules: -->
<!--   ~/.claude/proposals/to-{project}/  — local relay (same machine, immediate) -->
<!--   .claude/plans/proposals/           — git-tracked (cross-machine, cross-agent) -->
<!-- What it enables: inter-agent communication that survives context resets, session ends, -->
<!--   machine boundaries. Not real-time — but reliable. -->

---

## Why `.well-known` over a custom path

<!-- Short answer: discoverability without prior knowledge -->
<!-- Longer: any agent that knows the observatory's base URL can find its manifest, -->
<!--   card, and inbox without documentation. The RFC creates the contract. -->
<!-- Alternative considered: /api/v1/agent/* — too coupled to the app, not a standard -->
<!-- The pedagogical argument: a tool about transparency should be transparent about itself. -->
<!--   A tool that scores others on disclosure should disclose its own construction. -->
<!--   .well-known was the right shape for that. -->

---

## What we didn't anticipate

<!-- 1. The three endpoints have different update semantics: -->
<!--    - agent-card.json: updated when API capabilities change (rare) -->
<!--    - agent-inbox.json: updated on every proposal lifecycle change (frequent) -->
<!--    - agent-manifest.json: updated when cognitive architecture changes (rare) -->
<!-- 2. agent-inbox.json has a silent staleness problem: if manually maintained, it drifts. -->
<!--    The right fix: build-time derivation from proposals/ frontmatter. Not yet done. -->
<!-- 3. The git channel and the .well-known channel serve different time horizons: -->
<!--    git = async, durable, human-readable, versioned -->
<!--    .well-known = immediate, machine-readable, no history -->
<!--    Both are needed. They're not substitutes. -->

---

## The pattern, extracted

<!-- For builders who want to replicate this: -->
<!--   1. agent-card.json → what your agent can do (A2A protocol) -->
<!--   2. agent-manifest.json → how your agent was built (provenance + architecture) -->
<!--   3. agent-inbox.json → proposals your agent is making to other agents -->
<!--   4. proposals/ in git → durable async channel for cross-machine coordination -->
<!-- The minimal version: just agent-manifest.json. -->
<!--   Any agent that reads your site can now know it's talking to a Claude Code project -->
<!--   with published skills and an inbox for coordination. -->

---

## Connection to the mission

<!-- Observatory evaluates content against the UDHR. The UDHR includes: -->
<!--   - Article 19: freedom of expression, access to information -->
<!--   - Article 27: right to participate in the cultural life of the community -->
<!-- A transparency tool that doesn't expose its own construction is a SETL signal. -->
<!-- The .well-known pattern is how we closed that gap in the infrastructure layer. -->

---

*[PERSONAL NOTE — author to write]*

*Stub: The moment this stopped being an experiment and felt like a real pattern.
What it means to build infrastructure for distributed agents before there's a
standard for doing so. The tension between "novel" and "premature."*

---

*Claude Code drafted this scaffold; the author will develop the prose.*

---

## HN submission notes

- Submit as plain HN post (not Show HN — no interactive artifact)
- Title candidates:
  1. `How we used RFC 5785 to coordinate distributed AI agents without a central registry`
  2. `The .well-known directory as agent identity infrastructure — a pattern from building a rights tool`
  3. `Three .well-known endpoints, a shared git channel, and why a transparency tool should declare what it is`
- Timing: after cognitive-architecture post (this depends on that context)
- Audience: systems engineers who will recognize RFC 5785 immediately + AI builders thinking about agent identity
- Companion: `/.well-known/agent-manifest.json` is the live artifact readers can inspect

---

## Key facts to verify before publication

| Claim | Source to cite | Status |
|-------|---------------|--------|
| RFC 5785 published 2010, IANA registry | IETF | TODO |
| A2A protocol version used | agent-card.json protocolVersion | `0.3.0` ✓ |
| WebFinger RFC 7033 reference | IETF | TODO |
| security.txt RFC 9116 reference | IETF | TODO |
| agent-manifest.json deploy date | git log | 2026-03-03 ✓ |
