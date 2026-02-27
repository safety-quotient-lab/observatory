---
name: audit
description: General-purpose codebase audit — auto-discovers system type, runs applicable checks across 11 categories (security, errors, data integrity, performance, resilience, database, frontend, worker/queue, knowledge, code quality, project hygiene), writes fix plans, implements fixes.
user-invocable: true
argument-hint: "[scan|plan|fix <target>|fix all|status] [--category=...] [--severity=...]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# General-Purpose Codebase Audit

A reusable audit skill that works on **any codebase** — front-end, back-end, APIs, pipelines, knowledge systems, CLIs, monorepos. Auto-discovers the system type and runs applicable checks dynamically.

## Modes

Parse `$ARGUMENTS` to determine mode:

| Argument | Mode | Action |
|---|---|---|
| *(empty)* or `scan` | **SCAN** | Discover system type, run checks, print findings summary |
| `plan` | **PLAN** | Scan + write dated fix plan to `.claude/plans/audit-YYYY-MM-DD.md` |
| `fix <target>` | **FIX** | Implement fixes from existing plan (target = category, severity, step range, or check ID) |
| `fix all` | **FIX ALL** | Implement all fixes in priority order |
| `status` | **STATUS** | Progress report against existing plan |

**Flags** (work in all modes):
- `--category=CATEGORY` — filter to a single category (e.g., `--category=security`)
- `--severity=LEVEL` — filter to a minimum severity (e.g., `--severity=high` includes HIGH and CRITICAL)

---

## Phase 1: System Discovery

Auto-detect the codebase by inspecting config files, directory structure, and file extensions. Assign one or more **tags** — a project can have multiple.

### Tags

| Tag | Detection signals |
|---|---|
| `frontend` | `astro.config.*`, `next.config.*`, `nuxt.config.*`, `svelte.config.*`, `vite.config.*`, `angular.json`, `src/pages/`, `src/components/`, `public/`, `.astro`/`.jsx`/`.tsx`/`.vue`/`.svelte` files |
| `backend-api` | `src/api/`, `functions/`, `routes/`, `controllers/`, Express/Fastify/Hono/Flask/Django/Gin imports, REST/GraphQL endpoints |
| `backend-worker` | `wrangler.toml`, `wrangler.*.toml`, queue handlers, cron triggers, `worker.ts`/`worker.js`, `Procfile` |
| `database` | `migrations/` dir, `.sql` files, D1/Prisma/Drizzle/Knex/TypeORM/SQLAlchemy config, `schema.prisma` |
| `pipeline` | Queue bindings, pub/sub patterns, ETL scripts, `cron.ts`/`cron.js`, scheduled triggers, workflow definitions |
| `knowledge` | `docs/` dir, `.md` files with internal links, `methodology*.txt`, wiki-style content, `mkdocs.yml`, `docusaurus.config.*` |
| `cli` | `bin/` dir, `#!/usr/bin/env` shebangs, `commander`/`yargs`/`clap`/`cobra`/`argparse` imports, `scripts/` with executables |
| `monorepo` | `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `turbo.json`, `workspaces` in `package.json`, multiple `package.json` files |

### Discovery procedure

1. **Glob** for config files: `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Dockerfile`, `wrangler*.toml`, framework configs
2. **Read** key config files to confirm (e.g., check `package.json` dependencies for frameworks)
3. **Glob** for directory structure patterns: `migrations/`, `docs/`, `bin/`, `src/pages/`, `src/api/`
4. **Assign tags** — report them to the user before proceeding

### Language detection

Also detect the primary language(s): TypeScript, JavaScript, Python, Go, Rust, Java, etc. This informs which grep patterns to use (e.g., `===` checks only apply to JS/TS).

---

## Phase 2: Context Gathering

Before running checks:

1. **Read `CLAUDE.md`** (if present) — understand intentional design decisions, known patterns, documented gotchas. This prevents false positives on intentional patterns.
2. **Read existing audit plans** — glob `.claude/plans/audit-*.md`. If a recent plan exists, note which findings were already addressed to avoid duplicating prior work.
3. **Identify test directories** — glob for `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`. These paths are excluded from most checks (security checks may still flag test fixtures with real secrets).
4. **Detect build/lint commands** — inspect `package.json` scripts, `Makefile`, `Cargo.toml`, `pyproject.toml` for: build, lint, typecheck, test commands. These are used for verification steps later.

---

## Phase 3: Run Checks

Run checks for each applicable category based on discovered tags. Use `Grep` and `Glob` tools (not bash grep/rg). For each potential finding, verify it's a real issue by reading surrounding context — don't flag based on pattern matches alone.

### Category 1: SECURITY (all tags)

Checks:
- **SEC-01**: SQL injection — template literals or string concatenation in SQL queries (look for `` `SELECT...${` ``, `"SELECT..." +`, `.query("..." + `)
- **SEC-02**: Secrets exposure — hardcoded API keys, tokens, passwords in source (not `.env` files). Patterns: `api_key = "`, `password = "`, `secret = "`, `token = "`, base64-encoded credentials
- **SEC-03**: Auth gaps — API endpoints without authentication checks, missing CSRF protection
- **SEC-04**: XSS vectors — `innerHTML`, `set:html`, `v-html`, `dangerouslySetInnerHTML` with user-controlled data (not static strings)
- **SEC-05**: Input validation — user-controlled values (URL params, form data, request body) used without validation or sanitization
- **SEC-06**: Path traversal — user input in file paths without sanitization (`path.join(userInput)`, `fs.readFile(userInput)`)
- **SEC-07**: Command injection — user input in shell commands (`exec(userInput)`, template literals in `child_process`)

### Category 2: ERROR_HANDLING (all tags)

Checks:
- **ERR-01**: Silent catches — empty `catch {}` blocks or `catch { }` with no logging/re-throw
- **ERR-02**: Unguarded array access — `.reduce()` on potentially empty arrays without initial value, `[0]` access without length check
- **ERR-03**: Missing promise rejection handling — `await` without try/catch in non-async-error-boundary contexts, `Promise.all` without `.catch`
- **ERR-04**: Crash-prone parsing — `JSON.parse()` without try/catch, `new URL()` on user input without try/catch
- **ERR-05**: Unchecked fetch responses — `fetch()` without checking `response.ok` or status code

### Category 3: DATA_INTEGRITY (all tags)

Checks:
- **DAT-01**: Loose equality — `==` or `!=` where `===`/`!==` is appropriate (JS/TS only, exclude `== null` which is an intentional pattern)
- **DAT-02**: Numeric coercion — `parseFloat`/`parseInt` without `isNaN`/`isFinite` check on result
- **DAT-03**: Null safety — property access chains without optional chaining where source can be null/undefined (check query results, API responses)
- **DAT-04**: Range/boundary gaps — off-by-one in slicing, missing bounds checks on user-controlled indices

### Category 4: PERFORMANCE (all tags except `knowledge`)

Checks:
- **PERF-01**: Unbounded SELECT — `SELECT` queries without `LIMIT` that return user-facing data (exclude internal analytics/admin queries)
- **PERF-02**: N+1 queries — `await` inside a loop that issues a query per iteration
- **PERF-03**: Missing pagination — list endpoints returning all results without pagination
- **PERF-04**: User-controllable limit — query LIMIT from user input without max cap
- **PERF-05**: Redundant computation — same expensive function called multiple times with same args in same scope

### Category 5: RESILIENCE (tags: `backend-api`, `backend-worker`, `pipeline`)

Checks:
- **RES-01**: Missing fetch timeouts — `fetch()` calls without `AbortController`/`signal` or timeout wrapper
- **RES-02**: Retry logic gaps — external API calls with no retry on transient failures (5xx, network errors)
- **RES-03**: Distributed state races — read-then-write patterns on shared state (KV, database) without locking or CAS
- **RES-04**: Missing graceful degradation — entire request/cycle fails because one non-critical sub-operation throws

### Category 6: DATABASE (tag: `database`)

Checks:
- **DB-01**: Migration-code drift — tables/columns referenced in code but not in any migration (or vice versa)
- **DB-02**: Missing indexes — columns used in WHERE/JOIN/ORDER BY without corresponding index (check migration files)
- **DB-03**: Batch write safety — large INSERT/UPDATE loops without batching or transaction boundaries
- **DB-04**: Schema-code drift — type definitions that don't match migration column types/nullability

### Category 7: FRONTEND (tag: `frontend`)

Checks:
- **FE-01**: Accessibility — `<img>` without `alt`, form inputs without labels, missing ARIA attributes on interactive elements
- **FE-02**: Fixed pixel widths — hardcoded `width: Npx` on containers that should be responsive (exclude icons, borders)
- **FE-03**: Overflow truncation — `overflow: hidden` or `text-overflow: ellipsis` that may hide important data (scores, values)
- **FE-04**: Inline eval — `eval()`, `document.write()`, `new Function()` from dynamic strings in client code

### Category 8: WORKER_QUEUE (tags: `backend-worker`, `pipeline`)

Checks:
- **WQ-01**: Unacked messages — code paths in queue handlers that can exit without calling `msg.ack()` or `msg.retry()`
- **WQ-02**: Double ack — multiple `msg.ack()` calls reachable in the same handler execution
- **WQ-03**: Non-idempotent handlers — queue handlers that would produce duplicates or errors on replay (no dedup check)
- **WQ-04**: Backpressure blindness — producers dispatching without checking queue depth or consumer health

### Category 9: KNOWLEDGE (tag: `knowledge`)

Checks:
- **KNW-01**: Broken internal links — markdown links to files that don't exist (check `[text](path)` patterns)
- **KNW-02**: Orphaned content — docs/pages not linked from any navigation or index
- **KNW-03**: Stale version references — version numbers in docs that don't match package.json/config
- **KNW-04**: Terminology inconsistency — same concept referred to by different names across docs

### Category 10: CODE_QUALITY (all tags)

Checks:
- **CQ-01**: Dead exports — exported functions/types not imported anywhere else in the codebase
- **CQ-02**: Duplicated constants — same magic number or string literal defined in multiple files
- **CQ-03**: Explicit `any` types — `any` type annotations in TypeScript (exclude vendor types, type assertions with comments)
- **CQ-04**: Convention violations — inconsistent naming patterns (e.g., mix of camelCase and snake_case in same module)

### Category 11: PROJECT_HYGIENE (all tags)

Checks:
- **HYG-01**: Conflicting config files — duplicate-purpose files (e.g., `todo.md` + `TODO.md`, `.eslintrc` + `.eslintrc.json`)
- **HYG-02**: Stale TODOs — TODO/FIXME comments referencing deleted code, closed issues, or completed work
- **HYG-03**: Doc freshness — `CLAUDE.md`/`README.md` references to files, functions, or paths that no longer exist
- **HYG-04**: Orphaned plan/scratch files — files in `.claude/plans/` or temp directories with no recent relevance
- **HYG-05**: `.gitignore` completeness — generated directories (`dist/`, `node_modules/`, `.astro/`) or secret files not covered

### Running checks efficiently

- Use **parallel Task agents** (subagent_type=Explore) for independent categories to speed up scanning
- For each grep match, **read 5-10 lines of context** to verify it's a real issue, not a false positive
- **Exclude**: test files, vendored code, `node_modules/`, `dist/`, generated files
- **Exclude intentional patterns**: if `CLAUDE.md` documents a pattern as intentional (e.g., "cleanHtml intentionally preserves script tags"), skip it
- **Severity assignment**:
  - **CRITICAL**: Security vulnerabilities, data loss risks, crash bugs in production paths
  - **HIGH**: Bugs that produce wrong results, missing error handling on critical paths, performance issues affecting users
  - **MED**: Robustness gaps, missing validation on non-critical paths, code quality issues that increase bug risk
  - **LOW**: Style issues, minor optimization opportunities, documentation drift

---

## Phase 4: Report Findings (SCAN mode)

Print a summary to the user:

```
## Audit Summary

**System:** [brief description]
**Tags:** frontend, backend-worker, database, pipeline
**Files scanned:** ~N
**Findings:** N total (C critical, H high, M med, L low)

### By Category
| Category | Critical | High | Med | Low |
|---|---|---|---|---|
| SECURITY | ... | ... | ... | ... |
| ... | | | | |

### Top Findings
1. [SEC-01] CRITICAL — SQL injection in `db-stories.ts:142` — template literal in WHERE clause
2. [ERR-02] HIGH — Unguarded `reduce()` in `users.astro:89` — crashes on empty array
3. ...
```

List up to 15 most important findings inline. If more exist, note the count and suggest `/audit plan` to get the full list.

---

## Phase 5: Write Fix Plan (PLAN mode)

Generate `.claude/plans/audit-YYYY-MM-DD.md` with this structure:

```markdown
# Audit Fix Plan — [System Description]

Created: YYYY-MM-DD | Tags: [tag1, tag2, ...] | Findings: N

## Summary

| Category | Critical | High | Med | Low | Total |
|---|---|---|---|---|---|
| SECURITY | ... | | | | |
| ... | | | | | |
| **Total** | | | | | |

## Findings

### SECURITY

#### [SEC-01] SQL injection in query builder
- **Severity:** CRITICAL
- **Effort:** S
- **File:** `src/lib/db-stories.ts:142`
- **Problem:** Template literal interpolates user-controlled `domain` variable directly into SQL WHERE clause.
- **Fix:** Replace template literal with parameterized query using `?` placeholder and bind array.
- **Impact:** Prevents SQL injection on domain filter endpoint.

#### [SEC-02] ...

### ERROR_HANDLING
...

## Execution Order

| Step | Finding | Severity | Effort | Files |
|---|---|---|---|---|
| 1 | SEC-01 | CRITICAL | S | `db-stories.ts` |
| 2 | ERR-02 | HIGH | S | `users.astro` |
| ... | | | | |

## Verification

Build command: `npx astro build` (from `site/`)
Type check: `npx astro check` (from `site/`)
Lint: [auto-detected or "none detected"]
Test: [auto-detected or "none detected"]

## Issues Not Fixed

[List any patterns flagged during scanning but excluded because CLAUDE.md documents them as intentional, or because they're in test files, or because they require architectural changes beyond the scope of a fix plan.]
```

### Execution ordering principles

Apply these in priority order when sorting findings into the execution table:

1. **Severity first** — CRITICAL before HIGH before MED before LOW
2. **Larger impact before quick wins** — within same severity, prefer the bigger structural fix that prevents a class of bugs over the one-liner that patches a single instance. Fix the root cause, not the symptom.
3. **Dependencies** — schema/migration changes before code that depends on them. Shared utilities before their consumers.
4. **Build sanity** — never leave the build broken between steps. If a large fix spans multiple files, group them as one step so they land together.
5. **Quick wins last** — small effort items within the same severity tier come after the structural ones, not before. They're easy to do later; the big ones are easy to forget.

---

## Phase 6: Implement Fixes (FIX mode)

### Targeting

Parse `$ARGUMENTS` after `fix`:
- `fix all` — all findings in execution order
- `fix security` or `fix SECURITY` — all findings in that category
- `fix 1-5` — steps 1 through 5 from execution table
- `fix SEC-01` — single finding by check ID
- `fix high` — all HIGH+ severity findings

Combine with flags: `fix security --severity=critical` → only CRITICAL security findings.

### Per-finding workflow

Use TaskCreate to track progress. For each finding:

1. **Read finding** from `.claude/plans/audit-YYYY-MM-DD.md` (use the most recent plan file)
2. **Read target file** — confirm the issue is still present. If already fixed, mark as skipped and move on.
3. **Apply minimal edit** — only what the finding describes. No surrounding refactors, no style changes, no bonus improvements.
4. **Verify locally** — check param counts match bind arrays (SQL), syntax looks correct, file paths exist
5. **Batch build check** — run the auto-detected build command every 5 steps (or after any step that changes types/interfaces). If build fails, fix before proceeding.
6. **Update task** — mark completed in task list

### What NOT to do during fixes

- Do not refactor code adjacent to the fix
- Do not add comments or docstrings to code you didn't change
- Do not change formatting or style of untouched lines
- Do not add error handling beyond what the finding specifies
- Do not "while I'm here" improvements

---

## Phase 7: Status Report (STATUS mode)

Read the most recent `.claude/plans/audit-*.md` file. For each finding in the execution table:

1. **Read the target file** at the specified line
2. **Check if the issue is still present** (grep for the problematic pattern)
3. **Classify**: Fixed, Still Present, Partially Fixed, File Changed (needs re-audit)

Print a progress report:

```
## Audit Status — [plan date]

**Progress:** 12/25 findings fixed (48%)

| Status | Count |
|---|---|
| Fixed | 12 |
| Still present | 8 |
| Partially fixed | 2 |
| Needs re-audit | 3 |

### Still Present (by severity)
- [SEC-03] HIGH — Auth gap in `/api/ingest.ts`
- [ERR-01] MED — Silent catch in `db-entities.ts:234`
- ...

### Needs Re-Audit
- [PERF-02] — `db-stories.ts` has changed significantly since audit
```

---

## Safeguards

- **Always read CLAUDE.md first** — intentional design decisions documented there are not bugs
- **Never flag test files** — unless they contain real secrets or the check explicitly targets test code
- **Every finding must have a concrete fix** — not "consider improving" or "might want to add". If you can't specify the exact change, don't include the finding.
- **Distinguish bugs from style** — real bugs (crash, wrong result, security hole) get CRITICAL/HIGH. Style preferences (naming, formatting) get LOW at most and only if they measurably increase bug risk.
- **Intentional fallbacks are not bugs** — a `catch` block that logs and returns a default is intentional error handling, not a "silent catch"
- **Check before flagging** — for every grep match, read surrounding context. A `==` might be an intentional `== null` pattern. An `innerHTML` might be setting a static string. A `SELECT *` might be in a migration file.
