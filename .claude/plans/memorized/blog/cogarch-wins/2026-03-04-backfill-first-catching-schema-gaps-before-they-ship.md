---
title: "Backfill-First: Catching Schema Gaps Before They Ship"
date: 2026-03-04
status: draft
tags:
  - schema-migrations
  - content-consistency
  - gap-detection
  - backfill-pattern
  - UX-debt
  - deployment-safety
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/backfill-first-catching-schema-gaps-before-they-ship
trigger: gap-detection
session_id: a224d270-0201-4150-989d-3b2180a946ed
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Content schema inconsistency: 10 existing posts would remain unmarked while 2 new posts received the badge, creating confusing/contradictory UX about review status.

## The Mechanism

Before implementing reviewStatus schema change, the agent explicitly checked existing posts for the field. Realized all 10 published posts lacked it, triggering a backfill plan rather than partial deployment.

## Why It Matters

Backfill-First Pattern: When adding a schema field that affects UI (badges, metadata, labels), check whether existing items need the field before merging. Partial deployment creates UX debt and confused signals about data consistency.

## Counterfactual

Without this trigger: Without the gap check, the agent deploys with 10 unmarked + 2 marked posts. Users see some posts labeled 'Unreviewed' and others with no label, creating uncertainty about whether unmarked posts are reviewed or just pre-dated the badge system.

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
