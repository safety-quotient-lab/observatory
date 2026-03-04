---
title: "Feedback as a liability: triangulating external evaluation against ground truth before it corrupts your backlog"
date: 2026-03-04
status: draft
tags:
  - feedback-validation
  - hallucination-detection
  - external-evaluation
  - epistemic-hygiene
  - triangulation
  - irony
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/feedback-as-a-liability-triangulating-external-evaluation-ag
trigger: gap-detection + epistemic-flag + T3-adjudication
session_id: a224d270-0201-4150-989d-3b2180a946ed
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Gemini's hallucinated features (community forums, non-existent code paths, fake structural features) that would have entered the backlog as false requirements if accepted uncritically

## The Mechanism

Agent proactively compared Gemini's feedback claims against actual system state (codebase structure, existing features) to identify hallucinations; flagged when confidence in false claims was high; systematically adjudicated valid vs. invalid critiques before creating TODOs

## Why It Matters

External AI feedback is high-signal but unreliable—apply systematic triangulation against ground truth before incorporation. The failure mode is insidious: hallucinated claims sound plausible and escape scrutiny. Irony: Gemini critiqued 'editorial confidence ≠ structural reality,' then demonstrated exactly that failure mode by confidently claiming features that don't exist.

## Counterfactual

Without this trigger: Unchecked feedback would have polluted the TODO list with spurious requirements; team would waste time investigating non-existent features; project signal-to-noise ratio in development queue would degrade; false confidence in requirements sourced from hallucination rather than reality

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
