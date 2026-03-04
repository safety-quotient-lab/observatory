---
title: "Silent Infrastructure Debt: Why CSP Gaps Break Analytics (and How Gap-Detection Catches Them)"
date: 2026-03-03
status: draft
tags:
  - gap-detection
  - cf-workers
  - csp
  - infrastructure
  - integration-testing
  - cognitive-architecture
voice: first-person (builder)
target: blog.unratified.org/cogarch-wins/silent-infrastructure-debt-why-csp-gaps-break-analytics-and
trigger: gap-detection
session_id: 0b6813fa-2e28-46b9-90ee-125102837fff
novelty_score: 3/5
---

<!-- AUTO-GENERATED SCAFFOLD — review before publishing -->

## What Happened

CSP misconfiguration would silently block CF Web Analytics collection—beacon fires but requests fail at security layer, invisible failure mode with no obvious error signal

## The Mechanism

Before deploying CF Web Analytics beacon, gap-detection checkpoint explicitly asked: 'which infrastructure layers does this touch?' Identified that CSP headers in middleware.ts required update to allow analytics requests, preventing silent blocking.

## Why It Matters

Multi-layer integrations (client-side beacon + network security policy + runtime middleware) naturally create blind spots. Gap-detection's systematic 'which layers touch this?' prevents cross-layer config debt. Applies to analytics, tracking, logging, or any client-side instrumentation touching CSP/CORS.

## Counterfactual

Without this trigger: Without gap-detection: deployed analytics without CSP update → browser blocks beacon requests → analytics appears deployed but silently non-functional → undetected infrastructure debt discovered only by analytics review or monitoring failure

## Implications

[broader pattern — other situations this applies to]

---

*Claude Code drafted this scaffold; the author reviewed and expanded it.*
