---
name: hunt
description: Find the highest-value next work — scans TODO.md, IDEAS.md (mission tiers), task list, git diff, stale plans, orphaned code, doc drift, and codebase edges to surface actionable items ranked by value, mission alignment, and orthogonality to in-flight work.
user-invocable: true
argument-hint: "[constraint or focus area, e.g. 'orthogonal', 'stale', 'quick wins', 'while waiting']"
allowed-tools: Read, Grep, Glob, Bash, Task, TaskList
---

# Hunt — Systematic Work Discovery

Find the most valuable next work given current constraints. This aggregates all the ways you'd search for "what's next" into one structured sweep.

## Trigger Phrases

This skill matches any of these user intents:
- "what's next?" / "what else?" / "what can we do?"
- "look for orthogonal work" / "find stale work"
- "anything to do while we wait?"
- "what should I focus on?" / "what's highest value?"
- "find work at the edges of context"

## Arguments

Parse `$ARGUMENTS` to determine constraints:

| Argument | Constraint |
|---|---|
| *(empty)* or `all` | Full sweep — all sources, rank by value |
| `orthogonal` | Only surface work that doesn't touch files currently being modified (check git status, active agents) |
| `stale` | Focus on drift, decay, and rot — docs, memory, dead code, old plans |
| `quick` or `quick wins` | Only items that take <5 minutes (single-file fixes, doc updates, deletions) |
| `blocked` | Show what's blocked and what would unblock it |
| `while waiting` or `parallel` | Same as `orthogonal` — find work safe to do alongside in-flight agents |
| `<category>` (e.g. `frontend`, `pipeline`, `docs`) | Filter to a specific domain |
| `extrapolate` or `deep` | Go beyond the backlog — mine the codebase for gaps between what's built and what's possible (see Phase 2b) |
| `mission` | Filter to Tier 1 (direct pedagogy) items from IDEAS.md mission alignment analysis — features that teach rights through utility |

Multiple constraints can be combined: `orthogonal quick wins`

## Phase 1: Establish Context

Before hunting, understand what's currently in-flight:

1. **Read `TODO.md`** — the canonical backlog
2. **Read `IDEAS.md`** — deferred ideas with mission alignment tiers (Tier 1 = direct pedagogy, Tier 2 = mission-supportive, Tier 3 = infrastructure)
3. **Run `TaskList`** — active task tracker (in-progress items = in-flight)
4. **Run `git status`** — what files are currently modified (avoid these for orthogonal work)
5. **Run `git diff --stat HEAD~3`** — what was recently changed (context for what's fresh vs stale)
6. **Read `MEMORY.md`** — orientation, known gotchas, previous decisions
7. **Glob `.claude/plans/*.md`** — existing plans (may have unfinished work). **Skip `.claude/plans/archive/`** — those are resolved.

Collect this into a mental model of: **what's active, what's done, what's blocked, what's untouched**.

## Phase 2: Scan Sources

Work through each source. For each, extract candidate work items with a rough value estimate.

### Source 1: TODO.md Backlog
- Read `TODO.md` (project root)
- Extract all unchecked `- [ ]` items
- Note which phase they're in (Phase 1 = active engineering, Phase 2 = commercialization, Phase 3 = open source)
- Flag items whose prerequisites are now met (check if blocking items were completed)

### Source 1b: IDEAS.md Deferred Work
- Read `IDEAS.md` (project root)
- Check the Mission Alignment Analysis section — Tier 1 items are highest-priority deferred work
- For each Tier 1 idea, check if prerequisites are now met or effort has dropped (e.g., data already collected, queries already exist)
- Flag any Tier 1 idea that could be promoted to TODO.md
- For `mission` constraint: only surface Tier 1 items

### Source 2: Task List
- Check for pending tasks not yet started
- Check for blocked tasks whose blockers may have been resolved
- Check for stale in-progress tasks (started but abandoned)

### Source 3: Stale Plans
- Glob `.claude/plans/*.md` (skip `archive/` subdirectory — those are resolved)
- For each active plan, check if it has unfinished items
- Check if any plan findings were fixed but the plan wasn't updated (stale plan = false work signal)

### Source 4: Dead Code & Orphaned Files
- Quick sweep for orphaned components:
  ```
  Glob: site/src/components/*.astro → grep each for imports
  ```
- Quick sweep for orphaned pages (pages not linked from any nav, hub, or other page)
- Check for `@internal` annotated functions that could be cleaned up
- Look for TODO/FIXME comments in recently-touched files
- Check for scratch/temp files in repo root (`tmp-*`, `*.bak`, `*.tmp`)

### Source 5: Documentation Drift
- Compare CLAUDE.md descriptions against actual file contents (spot-check 3-5 entries)
- Check if memory files reference deleted/renamed things
- Look for stale version numbers or outdated patterns

### Source 6: Codebase Edge Scan
Run targeted searches for common rot patterns:
- `Grep: "TODO|FIXME|HACK|XXX"` — actionable comments in code
- `Grep: "console\.log"` — debug statements left in production code
- `Grep: "@deprecated"` — deprecated code still in use
- Stale imports (imports from files that no longer export the thing)
- Unused CSS classes in global.css (compare defined classes vs grep usage)

### Source 7: Build & Type Warnings
- If time permits (not for `quick` mode): run `npx astro check 2>&1 | tail -30` for type warnings
- These often surface low-hanging fixes

### Source 8: Git History Patterns
- `git log --oneline -20` — what's been worked on recently
- Look for patterns of "fix X" commits that suggest recurring issues
- Check if any recent commits introduced known follow-up work

## Phase 2b: Deep Extrapolation (for `extrapolate` / `deep` constraint)

When the user asks to "extrapolate", "interpolate", "find new work", or "go deeper than the backlog", go beyond TODO.md and task lists. Launch parallel agents to mine three layers:

### Layer 1: Dark Data — collected but not exposed
What does the system collect that no page or API renders? Look for:
- **DB columns written but never queried** by any .astro page or API route
- **`@internal` annotated functions** — implemented, exported, but never called
- **Supplementary signal sub-fields** collected per-eval but only shown per-story (no aggregate view)
- **Domain aggregate columns** not surfaced on any dashboard
- **Event types** logged but not displayed or alerted on
- **Tables with data** that no page renders or only partially uses

For each dark data item, note: what it is, where it's written, what value surfacing it would provide.

### Layer 2: Structural Gaps — natural extension points
What's missing between the pages, APIs, and data model? Look for:
- **Cross-page linking gaps** — entity pages that don't link to related pages (domain → factions, item → article/[n], user → top domains)
- **API completeness** — what the site shows that the API doesn't expose (missing endpoints, missing fields in existing endpoints)
- **Missing aggregation dimensions** — data collected per-story but no way to browse/filter by it (content type, geographic scope, reading level, UDHR article, date range)
- **Alert/notification gaps** — events the system could detect but doesn't (domain HRCB drops, new top-10 domain, model disagreement trends)
- **Export/sharing gaps** — filtered feeds, embeddable widgets, deep-link affordances

### Layer 3: Methodology-Implementation Gaps
What does the methodology describe that the code doesn't implement? Look for:
- **Methodology features not in code** — read the latest methodology file and compare with eval-types.ts, eval-parse.ts, prompts.ts
- **Calibration coverage gaps** — content types, languages, score ranges not represented in calibration set
- **Consensus algorithm weaknesses** — flat weighting where confidence-weighting is possible, no outlier rejection at high model counts
- **Validation gaps** — any parsed values not clamped to spec ranges, any enum fields not validated against known lists
- **Staleness and refresh gaps** — DCP, domain profiles, or other cached data with inadequate refresh logic

### Presenting extrapolation results

Organize findings into two buckets:
1. **New TODOs** — concrete bugs or gaps that should be fixed (validation not enforced, broken query, missing UI element)
2. **New IDEAS** — enhancement opportunities that aren't bugs (dark data surfacing, new API endpoints, new aggregation pages). Annotate with mission tier if applicable.

For each finding, include: what it is, where in the codebase (file:line), severity/value, and effort estimate. Prioritize by "value per effort" — a one-line bug fix that improves data quality beats a new page that surfaces nice-to-have data.

## Phase 3: Classify & Rank

For each candidate found, assign:

### Value Rating
- **HIGH**: Fixes a bug, eliminates tech debt that blocks future work, improves reliability, **or is a Tier 1 mission item** (direct pedagogy — surfaces invisible rights patterns)
- **MED**: Improves code quality, updates stale docs, removes dead code, or is a Tier 2 mission item (improves accuracy/trust)
- **LOW**: Style improvements, minor optimizations, nice-to-haves, or Tier 3 (pure infrastructure)

### Effort Rating
- **XS**: <2 minutes (delete a file, fix a typo, update a constant)
- **S**: 2-10 minutes (single-file fix, doc update)
- **M**: 10-30 minutes (multi-file change, new test, refactor)
- **L**: 30+ minutes (new feature, architectural change, migration)

### Orthogonality
- **SAFE**: Doesn't touch any in-flight files or systems
- **ADJACENT**: Touches related but not identical files
- **OVERLAPPING**: Would conflict with in-flight work — defer

## Phase 4: Present Results

Format output as a ranked list, grouped by constraint match:

```
## Hunt Results

**Context:** [1-line summary of what's in-flight and what constraint was applied]

### Top Picks (recommended next)
1. **[Subject]** — [1-line description]
   Value: HIGH | Effort: S | Files: `path/to/file.ts`

2. **[Subject]** — [1-line description]
   Value: MED | Effort: XS | Files: `path/to/file.astro`

### Backlog Candidates (from TODO.md)
- **[Item]** — Phase N, [status/blocker note]
- **[Item]** — Phase N, [status/blocker note]

### Stale Items (needs attention)
- **[Item]** — [why it's stale, what to do about it]

### Blocked (needs unblocking first)
- **[Item]** — blocked by: [what]
```

### Presentation Rules
- **Max 10 items** in Top Picks — don't overwhelm
- **Bold the subject**, keep descriptions to one line
- **Always include effort estimate** — the user has ADHD, knowing "this is 2 minutes" vs "this is 30 minutes" helps with task initiation
- **Group by theme** if multiple items relate (e.g., "3 stale doc entries" = 1 item, not 3)
- **If orthogonal constraint**: explicitly note which in-flight files are being avoided
- **If quick wins constraint**: only show XS and S effort items
- **End with a recommendation**: "I'd suggest starting with #1 because [reason]" or "Items #1-3 are all XS and can be knocked out in 5 minutes total"

## Phase 5: Decision Refinement

When a hunt surfaces items that require a **choice between approaches** (not just "do this task"), shift into decision-assist mode. This applies to:
- Backlog items with multiple implementation strategies
- Deferred items where the decision is "do it now / later / never"
- Architectural choices (e.g., "add a materialized table vs use AE vs cache in KV")
- Any item where the user says "what do you think?" or leans toward an answer but hasn't committed

### Step 1: Identify 2-3 distinct options

Frame the decision as 2-3 concrete, mutually exclusive choices. Not vague ("maybe do it") — specific ("remove from TODO" vs "keep with trigger" vs "move to IDEAS.md"). Each option should be a real action the user could take right now.

### Step 2: Ask clarifying questions

Use `AskUserQuestion` with 2-4 targeted questions that would change which option is best. Focus on:
- **Motivation**: What's driving the interest? Pain point, future-proofing, curiosity, or architecture preference?
- **Constraints**: What matters more — simplicity, headroom, or completeness?
- **Context the user has that you don't**: Timeline pressure, upcoming features, scale expectations, personal preference
- **Dealbreakers**: Any hard requirements that eliminate an option?

Keep questions concrete with option labels, not open-ended. The user has ADHD — multiple-choice is easier to engage with than "what do you think about X?"

### Step 3: Knock-on analysis for each option

For each of the 2-3 options, trace consequences through 6 orders using the `/knock` pattern:

**Per option, state:**
1. **[Label]** *(certain)* — The direct, immediate effect
2. **[Label]** *(certain–likely)* — What systems/processes activate from Order 1
3. **[Label]** *(likely)* — What consumes Order 2's outputs
4. **[Label]** *(likely–possible)* — Aggregate/systemic effects
5. **[Label]** *(possible)* — What humans observe or trust changes
6. **[Label]** *(speculative)* — How it compounds over time or constrains future work

**Focus on opportunity cost at each order** — not just "what happens if we do this" but "what do we give up or foreclose by choosing this over the alternatives."

### Step 4: Comparison table

End with a crisp comparison:

```
| | [Axis 1] | [Axis 2] | [Axis 3] | [Axis 4] |
|---|---|---|---|---|
| **Option 1** | ... | ... | ... | ... |
| **Option 2** | ... | ... | ... | ... |
| **Option 3** | ... | ... | ... | ... |
```

Pick axes that differentiate the options (not axes where all options score the same). Common useful axes: mental overhead, reversibility, effort now vs effort later, information preserved, backlog cleanliness.

### When to skip decision refinement

- If all hunt results are straightforward tasks (no choice needed) — go straight to Phase 6
- If the user says "just do it" or picks an item without hesitation — execute, don't deliberate
- If effort is XS/S — the cost of deciding exceeds the cost of doing. Just do it.

## Phase 6: Offer Next Steps

After presenting results (and refining decisions if needed), offer concrete next actions:

- "Want me to tackle #1-3 (quick wins)?"
- "Want me to plan out [larger item]?"
- "Want me to run `/audit` on [area] for a deeper sweep?"

If no meaningful work is found:
- "Codebase is clean and backlog is well-prioritized. The next meaningful work is [item from TODO.md Phase N] which requires [prerequisite]."

## Efficiency Notes

- **Use parallel agents** for Source 4-6 scans when doing a full sweep
- **Skip Source 7** (build check) for `quick` or `stale` constraints
- **Skip Source 4-6** for `blocked` constraint (only need TODO + TaskList)
- **Cache awareness**: If this skill was run recently in the same session, note what was already found and focus on what's changed since
- The goal is **actionable items in <60 seconds** for quick mode, **comprehensive in <3 minutes** for full sweep
