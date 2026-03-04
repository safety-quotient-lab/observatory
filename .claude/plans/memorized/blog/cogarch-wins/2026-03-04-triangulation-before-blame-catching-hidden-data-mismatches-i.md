---
title: "Triangulation Before Blame: Catching Hidden Data Mismatches in Evaluation Pipelines"
date: 2026-03-04
status: draft
tags:
  - measurement-integrity
  - pipeline-debugging
  - verification-pattern
  - error-diagnosis
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/triangulation-before-blame-catching-hidden-data-mismatches-i
trigger: triangulate-before-destructive-action
session_id: 0b6813fa-2e28-46b9-90ee-125102837fff
novelty_score: 4/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Model naming inconsistency (claude-haiku-4-5 vs claude-haiku-4-5-20251001) in test-retest comparison — would have corrupted reliability analysis and possibly triggered unnecessary re-evaluations

## The Mechanism

Multi-point verification when tool output doesn't match expectations: (1) direct database query, (2) raw output inspection, (3) root cause analysis. Prevents premature blame assignment.

## Why It Matters

When measurement tools produce unexpected output, how do you know if it's a tool bug or a data mismatch? The triangulation pattern (verify → inspect → trace) catches these before they become published errors or wasted re-runs.

## Counterfactual

Without this trigger: Would have published test-retest findings based on mismatched data, or filed false bug report against ingest endpoint, or re-run evaluations assuming pipeline failure

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
