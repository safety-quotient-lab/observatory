---
title: "Cognitive Gap-Detection in Large Refactorings: Catching Stragglers Before They Break"
date: 2026-03-04
status: draft
tags:
  - gap-detection
  - refactoring-safety
  - systematic-verification
  - cognitive-triggers
  - coverage-thinking
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/cognitive-gap-detection-in-large-refactorings-catching-strag
trigger: gap-detection
session_id: 0b6813fa-2e28-46b9-90ee-125102837fff
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Three files with broken references to the old exports/ path: scripts/build-agent-inbox.mjs, .claude/plans/show-hn-draft.md, and signal-validation-plan.md. These would have failed on next invocation.

## The Mechanism

After a directory rename refactoring (plans/exports/ → plans/memorized/), explicitly asked 'which sections did I NOT read thoroughly?' and systematically searched for remaining references to the old path. Found three stragglers with dangling references before they broke the build.

## Why It Matters

Gap-detection as a refactoring safety mechanism: Why explicitly asking 'what didn't I verify?' catches stragglers that automated grep-based search misses. Cognitive triggers + systematic coverage thinking > tool automation alone for context-dependent references.

## Counterfactual

Without this trigger: Without gap-detection, the commit would have included broken references, causing build failures downstream or leaving the repository in an inconsistent state where some references pointed to renamed files.

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
