---
title: "The CSP Blindspot: Why Adding Analytics Requires a Security Policy Audit"
date: 2026-03-03
status: draft
tags:
  - gap-detection
  - infrastructure-debt
  - CSP
  - silent-failures
  - cross-file-dependencies
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/the-csp-blindspot-why-adding-analytics-requires-a-security-p
trigger: gap-detection
session_id: 0b6813fa-2e28-46b9-90ee-125102837fff
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

Silent infrastructure failure: the beacon would have been deployed but silently blocked by existing CSP restrictions, leaving analytics non-functional without visible error.

## The Mechanism

Before deploying CF Web Analytics beacon, agent checked whether CSP policy in middleware.ts needed updating — asking 'which files govern security rules that this new external beacon would trigger?'

## Why It Matters

Infrastructure changes often split across security layers (analytics script, CSP headers, middleware). Catching these cross-file dependencies *before* deployment prevents a class of silent-failure bugs that are expensive to debug post-incident.

## Counterfactual

Without this trigger: Without gap-detection, the beacon ships, CSP violations occur in production silently, analytics partial-fails, root cause is invisible for weeks (CSP blocks don't surface in UX).

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
