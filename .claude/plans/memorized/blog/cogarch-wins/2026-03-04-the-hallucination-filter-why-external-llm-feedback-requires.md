---
title: "The Hallucination Filter: Why External LLM Feedback Requires Adjudication Before Incorporation"
date: 2026-03-04
status: draft
tags:
  - external-evaluation
  - LLM-feedback-hygiene
  - hallucination-detection
  - backlog-integrity
  - adjudication-pattern
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/the-hallucination-filter-why-external-llm-feedback-requires
trigger: T3 (adjudication)
session_id: a224d270-0201-4150-989d-3b2180a946ed
novelty_score: 4/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

5-6 non-existent features (community forums, recursive agent loops, fake E-Prime constraint implementation) were prevented from polluting the TODO backlog. Without this filter, the actionable items list would have included architectural work on features that don't exist.

## The Mechanism

Before creating TODOs from external LLM feedback, agent systematically separated Gemini's hallucinated claims (community forums, recursive agents, fake scores, E-Prime violations) from valid critiques. Explicitly evaluated what was correct vs fabricated before generating action items.

## Why It Matters

LLM-generated feedback (external evals, reviews, suggestions) is high-confidence but not high-accuracy. The gap between 'sounds credible' and 'actually happened' is where backlog corruption happens. This mechanism shows how systematic adjudication prevents synthetic work items from masquerading as real problems.

## Counterfactual

Without this trigger: Agent accepts Gemini feedback wholesale, creates TODOs for 'add community forums', 'implement recursive agents', 'enforce E-Prime in prompts' (hallucinations). Team wastes cycles investigating or implementing ghost requirements before discovering they were LLM fabrications.

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
