---
title: "The Invisible Coupling: How Gap-Detection Prevents Documentation Drift in Layered Systems"
date: 2026-03-04
status: draft
tags:
  - documentation-drift
  - gap-detection
  - system-consistency
  - multi-layer-architecture
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/the-invisible-coupling-how-gap-detection-prevents-documentat
trigger: gap-detection
session_id: f52bddd5-71d1-416e-b4e1-1529fca8ce97
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Four stale references to '9 supplementary signals' in about.astro (lines 507, 526, 550, 792) plus outdated signal grid display and CLAUDE.md/TODO.md references. Without gap-detection, deployed code would support 10 signals while documentation advertised 9, creating visible inconsistency for users.

## The Mechanism

Agent explicitly paused implementation midway through documentation updates and asked: 'which sections did I NOT read — could they be affected?' This prompted systematic identification of all user-facing pages (about.astro) and doc files (CLAUDE.md, TODO.md, MEMORY.md) that reference the old supplementary-signal count (9→10).

## Why It Matters

Multi-layer documentation systems (code, methodology docs, user-facing pages, project memory) create invisible coupling. Making gap-detection explicit — asking 'what files didn't I touch that reference this concept?' — transforms documentation drift from a common oversight into a preventable class of bugs.

## Counterfactual

Without this trigger: Agent updates eval-types.ts, prompts.ts, methodology-content.ts, deploys workers, marks RTS task complete, but about.astro still displays '9 supplementary signals' with incomplete reference grid. Users/future devs notice mismatch between what code outputs and what docs claim, filing issues or wasting time investigating.

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
