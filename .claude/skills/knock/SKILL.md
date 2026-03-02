---
name: knock
description: Trace knock-on effects of a change or decision out to the 6th higher order — direct effects, triggered systems, downstream consequences, aggregate/systemic effects, trust/quality/metrics effects, and long-term structural effects. Works on code changes, data migrations, architectural decisions, operational changes, or product/business decisions.
user-invocable: true
argument-hint: "<description of the change or decision to analyze>"
allowed-tools: Read, Grep, Glob, Bash
---

# Knock-On Effects Analysis

Trace the causal chain of any change or decision through six orders of consequence. Each order follows causally from the previous — not a brainstorm, a chain.

---

## Step 1: Establish the subject

Parse `$ARGUMENTS`:
- **Provided** → use it directly as the subject
- **Empty** → infer from context: recent git diff, current task, or last conversation turn

Open your output with: **"Analyzing: [subject]"**

---

## Step 2: Classify the domain

Identify which domain(s) apply — this determines what effect vectors to trace at each order:

| Domain | Signal | Effect vectors |
|---|---|---|
| **Code** | function/type/module change | compilation, runtime, API contracts, type consumers |
| **Data** | schema/query/migration change | consistency, caches, materialized tables, downstream readers |
| **Pipeline** | worker/cron/queue change | reliability, ordering, retry behavior, observability |
| **Infrastructure** | config/deploy/env change | environment drift, cost, scaling, secrets exposure |
| **UX/Frontend** | layout/component/CSS change | mobile, accessibility, progressive disclosure, trust |
| **Operational** | process/tooling/script change | developer velocity, debugging, onboarding |
| **Product/Business** | feature/policy/strategy change | user behavior, trust, team morale, technical debt |

State the domain(s). A change often spans multiple.

---

## Step 3: Ground the analysis in real dependencies (code/data domains)

Before tracing effects, answer these — using Read/Grep/Glob if needed:
- What does the changed thing actually do?
- What imports it, calls it, or depends on its behavior?
- What does it write to, and who reads those writes?
- What caches, materialized tables, or dashboards consume its output?

Grounding prevents speculation at low orders. Skip this step for non-code domains.

---

## Step 4: The six-order cascade

Use this exact format — one line (or a tight 2–3 sentences) per order, bold descriptive label, concrete specifics:

---

**Knock-on analysis (6 orders) — [subject summary]:**

**1. [Label]** *(certain)*
The direct, immediate effect. Name specific functions, tables, endpoints, workers, or UI elements. No vagueness.

**2. [Label]** *(certain–likely)*
What systems, processes, or data flows are activated by Order 1. Trace the execution path — what gets called next, what gets written, what gets invalidated.

**3. [Label]** *(likely)*
What consumes Order 2's outputs. Downstream readers of changed data, callers of changed APIs, caches that go stale, dashboards that show changed metrics.

**4. [Label]** *(likely–possible)*
Aggregate or systemic effects — what emerges from accumulation or system-wide behavior rather than individual calls. Materialized view drift, metric skew, monitoring gaps, performance degradation under load. Note assumptions if required.

**5. [Label]** *(possible)*
How Order 4 affects what humans observe or trust: dashboards, alerts, calibration scores, user-visible quality signals, debugging capability. This is where silent corruption becomes visible — or permanently hidden.

**6. [Label]** *(speculative)*
How Orders 1–5 compound over time or constrain future work: technical debt, architectural lock-in, open-source readiness, contributor onboarding difficulty, cost trajectory, trust erosion.

---

**Confidence discipline:**
- Orders 1–2: state as fact (direct causal effects — you can verify with code reads)
- Order 3: "likely" — based on known data flow; read code if uncertain
- Orders 4–5: "possible" — requires accumulation or compounding; state key assumptions
- Order 6: "speculative" — be honest; say "orders 5–6 are too speculative without knowing X" if true
- If a branch diverges into multiple significant paths at any order, note both

---

## Step 5: Key mitigations

After the cascade, list the top actions to proactively address significant effects:

```
**Key mitigations:**
- [Concrete action] — addresses Order N: [specific risk]
- [Concrete action] — addresses Order N: [specific risk]
- ...
```

Rules:
- Prioritize non-obvious mitigations (Order 3+) — don't list things the change already handles
- Be specific: name the file, function, query, or config to change
- Include monitoring/observability suggestions if effects are hard to detect
- Note if a mitigation is "now" vs "before next deploy" vs "watch for"
- Push into "radical" territory if asked — self-healing, circuit breakers, alerting, auto-rollback

---

## Step 6: Assumptions and blind spots

If the analysis required assumptions at Order 4–6, state them:

```
**Assumptions made:**
- [Assumption] — if wrong, Order N changes to [alternative]
```

If you cannot reason confidently to Order 6 without more information, say so explicitly rather than fabricating effects.

---

## Cross-domain effect patterns (always check these)

These are recurring knock-on vectors — scan for any that apply to the subject:

**Code changes:**
- Shared type/interface changed → grep for all importers; any unhandled new field = silent data loss
- Return value changed → callers that pattern-match on old shape silently get wrong results
- Error now thrown where before it returned null → callers that assumed null now crash
- Side effect removed → anything that relied on that side effect now broken silently

**Data changes:**
- DB write path changed → what KV caches keys derived from this table? (stale cache = wrong data served)
- Schema column added/removed → what queries use `SELECT *`? what type definitions diverge?
- Query behavior changed → what materialized/aggregate tables get populated from this query?
- Soft delete vs hard delete → downstream analytics count differently

**Pipeline changes:**
- Worker now throws where before it returned → message goes to DLQ vs retried → different consumer behavior
- Queue message shape changed → existing in-flight messages use old shape → deserialization errors
- Cron schedule changed → overlapping runs possible? distributed lock needed?
- Timeout changed → what was relying on the old timeout as an implicit circuit breaker?

**Infrastructure changes:**
- New env var required → what happens in environments where it's not set? silent default or crash?
- New binding required → local dev `.dev.vars` and all wrangler configs need updating
- Cost increase → what budget caps or daily limits does this push against?

**UX changes:**
- New CSS class → does it conflict with existing global rules? mobile breakpoints?
- Component removed → is it referenced in other pages? dead imports = build warnings or errors
- Layout changed → does the new layout work at all viewport sizes? with long content?

**Operational changes:**
- Script replaced → are there cron jobs, CI pipelines, or documented procedures that reference the old script?
- Log format changed → are there log parsers, alerts, or dashboards that depend on the old format?
- Process changed → what tribal knowledge was embedded in the old process that needs to be documented?

---

## Output style

- **Concrete over abstract**: "every eval write triggers `refreshDomainAggregate()` + `updateConsensusScore()`" beats "database performance may be affected"
- **Numbers when known**: "~5,500 false 'repair' events/day", "278 affected rows", "300s TTL"
- **Label orders descriptively**: "Aggregate pollution", "Dashboard contamination", "Trust erosion" — not just "Order 3"
- **Lean format**: each order fits in 1–3 sentences. The cascade is a spine, not an essay.
- **End with action**: the point of the analysis is to generate mitigations, not just observations
