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

### 2. Update the About page (`site/src/pages/about.astro`)

- Check if any section descriptions are now stale
- Update methodology descriptions if algorithms changed
- Update section order descriptions if page layout changed
- Add new sections if new concepts were introduced
- Remove references to removed features

### 3. Update CLAUDE.md

- Check if architecture descriptions are still accurate
- Update key patterns if new gotchas were discovered
- Update file descriptions if new files were added or responsibilities changed
- Update page listings if pages were added/removed/renamed
- Keep it concise — CLAUDE.md is for developer orientation, not full docs

### 4. Update project memory (`~/.claude/projects/-home-kashif-projects-unudhr/memory/MEMORY.md`)

- Record any new stable patterns confirmed during this session
- Record any new gotchas discovered (e.g., type coercion bugs, API quirks)
- Update existing entries if they're now wrong
- Don't duplicate what's already in CLAUDE.md — memory is for cross-session insights

### 5. Update TODO.md

- Read `TODO.md` (project backlog — open items only, no completed items)
- Check off any items that were completed by the changes in this session, then remove them (completed items belong in git history, not the TODO)
- Add any new TODO items that surfaced during development (bugs found, follow-up work needed, ideas)
- Remove items that are no longer relevant

### 6. Check for orphaned references and files

- Grep for any references to removed functions, renamed variables, or old section names
- Check imports in modified files still resolve
- Verify no dead code was left behind
- **Check for orphaned files**: if this session created a new file that replaces or supersedes an older file (e.g., a new unified script replacing two old scripts), identify the old files and `git rm` them. Look for:
  - Old scripts/tools that the new code replaces
  - Old config files made redundant by new ones
  - Stale test fixtures or data files no longer referenced by any code
- When in doubt, grep the codebase for imports/references to the candidate file — if nothing references it (other than comments about it being replaced), it's safe to remove

### 7. Build verification

- Run `npx astro build` from `site/` to confirm everything compiles
- Report any warnings or errors — fix before proceeding

### 8. Git commit

- Run `git status` and `git diff --stat` to review all staged and unstaged changes
- Stage all relevant files (prefer naming specific files over `git add -A`; never stage secrets like `.env`, `.cron-secret`, credentials)
- Write a concise commit message summarizing the "why" — follow existing commit message style from `git log --oneline -10`
- Commit using the standard Co-Authored-By trailer
- Run `git status` after to verify clean working tree

### 9. Deploy

- Deploy the site: `cd site && npx wrangler pages deploy dist --project-name hn-hrcb`
- If worker files changed (functions/*.ts), deploy the affected workers too:
  - `npx wrangler deploy --config wrangler.cron.toml` (cron)
  - `npx wrangler deploy --config wrangler.consumer-anthropic.toml` (Anthropic consumer)
  - `npx wrangler deploy --config wrangler.consumer-openrouter.toml` (OpenRouter consumer)
  - `npx wrangler deploy --config wrangler.consumer-workers-ai.toml` (Workers AI consumer)
  - `npx wrangler deploy --config wrangler.dlq.toml` (DLQ worker)
- If new migrations were added, apply them first: `npx wrangler d1 migrations apply hrcb-db --remote`
- **Note:** `wrangler.toml` has scrubbed resource IDs for open-source prep. Before deploying, temporarily restore real IDs from the deploy environment (do NOT commit real IDs). After deploy, revert: `git checkout -- wrangler.toml`
- Report the deployment URL

### 10. Cleanup

- Remove any scratch/temp files created during development (e.g., `*.tmp`, `*.bak`, test outputs)
- Check for any `console.log` or debug statements that should be removed from production code
- Verify `.gitignore` covers any new generated directories (e.g., `.astro/`, `dist/`)
- If new untracked files remain after commit, flag them — they may be intentionally untracked or accidentally missed

### 11. Summary

Report what was updated, what was committed, what was deployed, and what was skipped (with reason).
