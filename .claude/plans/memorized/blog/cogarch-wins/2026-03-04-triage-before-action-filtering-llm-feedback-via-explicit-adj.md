---
title: "Triage Before Action: Filtering LLM Feedback via Explicit Adjudication"
date: 2026-03-04
status: draft
tags:
  - feedback-processing
  - hallucination-filtering
  - methodology-evaluation
  - external-validation
  - T3-adjudication
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/triage-before-action-filtering-llm-feedback-via-explicit-adj
trigger: T2 (bare-fork prevention) + T3 (adjudication)
session_id: a224d270-0201-4150-989d-3b2180a946ed
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Prevented user from creating TODOs for non-existent features. Without adjudication, items like 'implement community forums,' 'rewrite methodology in E-Prime,' 'add recursive agent support' would have become actionable tasks, consuming implementation effort on hallucinations.

## The Mechanism

Before creating a triage table from Gemini feedback, agent systematically evaluated each suggestion: separated hallucinations (fake E-Prime constraint, non-existent community forums, recursive agents) from valid critiques (structural channel depth gaps, non-deterministic scoring, linguistic gaming vulnerability). Saved both raw feedback and analyzed discrimination separately.

## Why It Matters

External feedback from LLMs requires triage before action. Ironic bonus: Gemini's hallucinations themselves demonstrated the exact failure it critiqued—editorial confidence in structural claims without structural validity. Using a critic's own hallucinations to validate its critique.

## Counterfactual

Without this trigger: User receives flat list of 'Gemini suggestions,' creates TODOs for all, begins implementing false features (discovering only later they don't exist in Gemini's claimed form), wastes 2-4 hours per hallucination before reverting.

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
