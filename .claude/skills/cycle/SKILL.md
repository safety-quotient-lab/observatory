---
name: cycle
description: Post-development checklist — update docs, about page, CLAUDE.md, memory, build, commit, deploy, and cleanup after code changes
user-invocable: true
argument-hint: [summary of what changed]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

# Post-Development Cycle

Run this after completing code changes to ensure all documentation, user-facing pages, and project memory stay in sync, then commit and clean up.

## Checklist

Work through each step. Skip any that don't apply to the changes described in $ARGUMENTS.

### 1. Identify what changed

- Read the recent git diff or summarize from context what files were modified
- Note any new features, renamed concepts, changed algorithms, reordered sections, or removed functionality
- **Gap-detection checkpoint**: For each changed file, list the sections you did NOT read during implementation. Ask: are any of those sections likely to have been affected by the change? For example — changed a component but didn't read its parent template; changed a query but didn't check all call sites; added a new field but didn't check the API response types. Identify any gaps before proceeding.

### 2. Update the About page (`site/src/pages/about.astro`)

- Check if any section descriptions are now stale
- Update methodology descriptions if algorithms changed
- Update section order descriptions if page layout changed
- Add new sections if new concepts were introduced
- Remove references to removed features

### 3. Update CLAUDE.md files

This project has **two** CLAUDE.md files — check both:
- **Root `CLAUDE.md`** — project overview, architecture, build/deploy commands, event types, methodology
- **`site/CLAUDE.md`** — lib file inventory, page taxonomy, storage schema, key patterns (gotchas live here)

For each:
- Check if architecture descriptions are still accurate
- Update key patterns if new gotchas were discovered (most go in `site/CLAUDE.md` Key Patterns)
- Update file descriptions if new files were added or responsibilities changed
- Update page listings if pages were added/removed/renamed
- Keep it concise — CLAUDE.md is for developer orientation, not full docs

### 4. Update project memory

Memory uses a **index + topic files** structure. MEMORY.md stays under 60 lines — it is a lean orientation doc, not a knowledge dump. Details live in topic files that are Read on demand.

**Memory locations:**
- `~/.claude/projects/-home-kashif-projects-unudhr/memory/` — unudhr-specific (loaded when CWD = `~/projects/unudhr/`)
  - `MEMORY.md` — orientation index: user prefs, quick facts, key gotchas, links to topic files
  - `unudhr-ops.md` — deployment commands, endpoints, daemon, Workers AI, schema, key files, calibration IDs
  - `unudhr-patterns.md` — gotchas, Astro/CSS patterns, site taxonomy, light prompt mode, module architecture
- `~/.claude/projects/-home-kashif-projects/memory/` — cross-project (loaded when CWD = `~/projects/`)
  - `MEMORY.md` — cross-project index (unudhr overview, PSQ, PJE)
  - `hncb-calibration.md` — calibration history, cal set table, run history
  - `hncb-pipeline.md` — pipeline architecture, hardening, archive, trust, open source strategy
  - `safetyquotient.md` — PSQ project state, hard constraints, scripts

**Routing rules — what goes where:**
| Changed | Update |
|---------|--------|
| New gotcha (Astro/CSS/D1/CF quirk) | `unudhr-patterns.md` |
| New deployment command or endpoint | `unudhr-ops.md` |
| Schema migration or data model change | `unudhr-ops.md` (Schema section) |
| Calibration run result or cal set change | `hncb-calibration.md` |
| Pipeline architecture change (new worker, new KV pattern) | `hncb-pipeline.md` |
| New always-on-context gotcha (affects every session) | `MEMORY.md` → Key Gotchas |
| PSQ project state change | `safetyquotient.md` (from cross-project memory dir) |

**Process:**
1. Read the relevant topic file(s) before editing — never write blind
2. Update in place (Edit tool) rather than appending to avoid duplicates
3. Remove entries that are now wrong or superseded
4. If MEMORY.md exceeds ~60 lines, move content to the appropriate topic file
5. Never duplicate content between CLAUDE.md and memory files — CLAUDE.md is for developers, memory is for Claude's cross-session orientation

### 5. Update TODO.md and IDEAS.md

**TODO.md** (project backlog — open items only, no completed items):
- Read `TODO.md`
- Check off any items that were **directly completed** by this session's changes, then remove them
- **Upstream unblocking check**: also scan for items listed as prerequisites or blockers that this session satisfied — even if they weren't the primary output (e.g., "cogarch sync" completed as a side effect). Remove those too. Scope too narrow here is the recurring failure mode.
- Add any new TODO items that surfaced during development (bugs found, follow-up work needed, ideas)
- Remove items that are no longer relevant
- **Update `## Current Focus`**: after cleanup, verify the Current Focus block at the top of TODO.md reflects the actual next unblocked item. Update it if the session moved the frontier. If no Current Focus block exists, create one.

**IDEAS.md** (deferred ideas with mission alignment tiers):
- Read `IDEAS.md`
- Check off or remove any ideas that were just implemented
- If development surfaced new ideas that aren't immediate TODO items, add them here with a mission tier (Tier 1 = direct pedagogy, Tier 2 = mission-supportive, Tier 3 = infrastructure)
- Update effort estimates if implementation revealed something was easier/harder than expected

### 6. Update active plans

- Glob `.claude/plans/*.md` (skip `archive/` subdirectory)
- If the current changes complete items from an active plan, mark those items done in the plan
- If a plan is fully complete, move it to `.claude/plans/archive/`
- If plan findings were fixed but the plan wasn't updated, update it to prevent stale work signals

### 7. Check for orphaned references and files

- Grep for any references to removed functions, renamed variables, or old section names
- Check imports in modified files still resolve
- Verify no dead code was left behind
- **Check for orphaned files**: if this session created a new file that replaces or supersedes an older file (e.g., a new unified script replacing two old scripts), identify the old files and `git rm` them. Look for:
  - Old scripts/tools that the new code replaces
  - Old config files made redundant by new ones
  - Stale test fixtures or data files no longer referenced by any code
- When in doubt, grep the codebase for imports/references to the candidate file — if nothing references it (other than comments about it being replaced), it's safe to remove

### 8. Build verification

- Run `npx astro build` from `site/` to confirm everything compiles
- Report any warnings or errors — fix before proceeding

### 9. Git commit

- Run `git status` and `git diff --stat` to review all staged and unstaged changes
- Stage all relevant files (prefer naming specific files over `git add -A`; never stage secrets like `.env`, `.cron-secret`, credentials)
- Write a concise commit message summarizing the "why" — follow existing commit message style from `git log --oneline -10`
- Commit using the standard Co-Authored-By trailer
- Run `git status` after to verify clean working tree

### 10. Deploy

- Deploy the site: `cd site && npx wrangler pages deploy dist --project-name hn-hrcb`
- If worker files changed (functions/*.ts), deploy the affected workers too:
  - `npx wrangler deploy --config wrangler.cron.toml` (cron)
  - `npx wrangler deploy --config wrangler.consumer-anthropic.toml` (Anthropic consumer)
  - `npx wrangler deploy --config wrangler.consumer-openrouter.toml` (OpenRouter consumer)
  - `npx wrangler deploy --config wrangler.consumer-workers-ai.toml` (Workers AI consumer)
  - `npx wrangler deploy --config wrangler.dlq.toml` (DLQ worker)
- If new migrations were added, apply them first: `npx wrangler d1 migrations apply hrcb-db --remote`
- Report the deployment URL

### 11. Cleanup

- Remove any scratch/temp files created during development (e.g., `*.tmp`, `*.bak`, test outputs)
- Check for any `console.log` or debug statements that should be removed from production code
- Verify `.gitignore` covers any new generated directories (e.g., `.astro/`, `dist/`)
- If new untracked files remain after commit, flag them — they may be intentionally untracked or accidentally missed

### 12. Summary

Report what was updated, what was committed, what was deployed, and what was skipped (with reason).

Include one line: **Next:** [the current focus item from TODO.md]. This makes the session handoff explicit.
