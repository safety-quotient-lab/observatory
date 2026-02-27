---
name: audit_system
description: Production readiness audit — work through the 43-item fix plan (production-readiness-2026-02-27.md) phase by phase. Implements schema fixes, bug patches, SQL hardening, error handling, performance improvements, and worker robustness.
user-invocable: true
argument-hint: [phase number(s) or category: schema|bugs|sql|errors|perf|workers|all]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

# Production Readiness Audit

Work through the production readiness fix plan at `.claude/plans/production-readiness-2026-02-27.md`.

The plan has **43 discrete changes** across 20 phases. When invoked with a phase number or category, implement just those changes. When invoked with `all` or no argument, work through everything in execution order.

## Plan Reference

Full plan: `.claude/plans/production-readiness-2026-02-27.md`

Execution table (from plan):

| Step | Phase | Priority | Files |
|------|-------|----------|-------|
| 1 | 1A | CRITICAL | `migrations/0026_missing_tables.sql` (new) |
| 2 | 2A | CRITICAL | `types.ts` + `eval-parse.ts` + `compute-aggregates.ts` |
| 3 | 3B-C | HIGH | `db-stories.ts` (2 parameterize) |
| 4 | 4A | HIGH | `db-stories.ts` (getDomainStats count) |
| 5 | 4B | MED | `db-stories.ts` (JSON.parse crash) |
| 6 | 4C | MED | `eval-parse.ts` (parseFloat Infinity) |
| 7 | 4D | MED | `api/ingest.ts` (light eval update) |
| 8 | 5A | HIGH | `users.astro` (empty array crash) |
| 9 | 5B | MED | `velocity.astro` (null JSON) |
| 10 | 6A | HIGH | `db-stories.ts` + `db-entities.ts` (try/catch) |
| 11 | 6B | MED | `db-entities.ts` (Promise.all isolation) |
| 12 | 7A | MED | `db-entities.ts` (getDomainSignalProfiles refactor) |
| 13 | 7B | LOW | `db-stories.ts` (SELECT * → explicit cols) |
| 14 | 7C | LOW | `db-entities.ts` (getUserIntelligence materialized) |
| 15 | 8A | MED | `eval-write.ts` (batch atomicity) |
| 16 | 8B | LOW | `rater-health.ts` (threshold) |
| 17 | 9A | LOW | `db-stories.ts` + `db-entities.ts` (SETL constant) |
| 18 | 9B | LOW | `db-stories.ts` (all models filter) |
| 19 | 10A | MED | `cron.ts` (calibration cleanup) |
| 20 | 11A | MED | `content-gate.ts` (input bounds) |
| 21 | 12A | HIGH | `db-analytics.ts` (LIMIT 3 queries) |
| 22 | 13A | HIGH | `eval-write.ts` (markFailed race guard) |
| 23 | 13B | MED | `eval-write.ts` (FW orphan DELETE) |
| 24 | 14A | MED | db modules (log silent exceptions) |
| 25 | 14B | LOW | db modules (5 expensive fns timing) |
| 26 | 15A-B | LOW | migration 0026 (append indexes) |
| 27 | 16A | LOW | `db-utils.ts` (new safeBatch) |
| 28 | 17A | HIGH | `cron.ts` (error boundary) |
| 29 | 17B | MED | `cron.ts` (non-fatal crawl) |
| 30 | 18A | HIGH | `dlq-consumer.ts` (double-ack) |
| 31 | 18B | MED | `consumer-anthropic.ts` + `consumer-openrouter.ts` |
| 32 | 19A | MED | `cron.ts` (KV lock) |
| 33 | 20A | MED | `consumer-shared.ts` (KV try/catch) |
| 34 | 20B | LOW | `rate-limit.ts` (TTL increase) |
| 35 | 27 | HIGH | `db-stories.ts` (queued status in feed) |
| 36 | 28+30 | HIGH | 3 db modules (inline confidence → materialized) |
| 37 | 29 | MED | `cron.ts` + `hn-bot.ts` (prompt_mode dispatch) |
| 38 | 40A-B | HIGH | `eval-write.ts` + `eval-parse.ts` (dup constants) |
| 39 | 41 | HIGH | `providers.ts` (fetch timeouts) |
| 40 | 42 | MED | `api/ingest.ts` (type validation) |
| 41 | 43 | MED | `api/queue.ts` (negative limit) |
| 42 | 44 | LOW | `users.astro` (Promise.all) |
| 43 | 45 | LOW | `domains.astro` (reduce limit) |

## How to Run

### By argument

- `$ARGUMENTS` = blank or `all` → implement all 43 changes in order
- `$ARGUMENTS` = number (e.g. `1`, `2-5`, `38-43`) → implement just those step numbers
- `$ARGUMENTS` = category keyword:
  - `schema` → steps 1, 26 (migrations)
  - `bugs` → steps 2, 4–9 (data logic + crash fixes)
  - `sql` → steps 3, 13 (parameterization, SELECT *)
  - `errors` → steps 10–11, 22–24, 28 (try/catch, race guards, error logging)
  - `perf` → steps 12–14, 21, 25, 42–43 (query optimization)
  - `workers` → steps 19, 28–34, 37–39 (cron + consumers)
  - `critical` → steps 1–3, 8, 10, 21–22, 28, 30, 35–36, 38–39 (CRITICAL + HIGH priority)

## Implementation Workflow

For each step:

### 1. Read the plan section

Read the full plan file (`.claude/plans/production-readiness-2026-02-27.md`) and locate the relevant Phase section. Understand exactly what the bug is and what the fix should look like.

### 2. Read the target file(s)

Always read the actual file before editing. Confirm the buggy code is still present (it may have been fixed in a previous session). Note the exact line numbers.

### 3. Apply the fix

Use Edit to make the minimal targeted change described in the plan. Do not:
- Refactor surrounding code
- Add features beyond what the plan specifies
- Change formatting/style of untouched lines

### 4. Verify

After each change, do a quick sanity check:
- For SQL changes: confirm param count matches bind array
- For TypeScript changes: check the edited snippet looks syntactically correct
- For new files: confirm the file was written at the right path

### 5. Move to next step

After completing a batch of steps, run:

```bash
cd site && npx astro check 2>&1 | tail -20
```

Fix any TypeScript errors before proceeding. After all target steps are done, run:

```bash
cd site && npx astro build 2>&1 | tail -30
```

## After All Steps Complete

1. Run full build verification:
```bash
cd site
npx astro check 2>&1 | head -50
npx astro build 2>&1 | tail -30
```

2. If migration 0026 was created, apply it:
```bash
npx wrangler d1 migrations apply hrcb-db --remote
```

3. Report:
   - Steps completed
   - Steps skipped (already fixed / not applicable)
   - Any errors encountered
   - Build status

4. Suggest `/cycle` to update docs, commit, and deploy.

## Category Shortcuts

If `$ARGUMENTS` contains one of these keywords, map to the step ranges above and execute only those:

- **schema**: Create/update migration files for missing tables and indexes
- **bugs**: Fix data logic bugs, JSON parse crashes, classification range gaps, Infinity coercion
- **sql**: Parameterize string interpolations in SQL, replace SELECT * with named columns
- **errors**: Add try/catch, isolate Promise.all, prevent race conditions, fix double-ack
- **perf**: Refactor correlated subqueries, add query timing, add LIMIT clauses
- **workers**: Fix cron error boundaries, consumer API key checks, KV resilience, fetch timeouts
- **critical**: All CRITICAL and HIGH priority items in execution order

## Notes

- All files are under `site/` — always use paths relative to the repo root
- The migration file `0026_missing_tables.sql` may already exist; check first
- The `hn_rank` ALTER TABLE in phase 1A will error if column already exists — wrap in a `try` or skip with a comment if it fails on apply
- Some fixes (7A getDomainSignalProfiles refactor) are complex multi-line rewrites — read the full current implementation before applying
- Steps 28+30 (confidence materialization) touch 8+ SQL queries across 3 files — work through each file's occurrences in sequence
