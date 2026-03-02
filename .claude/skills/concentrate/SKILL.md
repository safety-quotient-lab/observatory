---
name: concentrate
description: Cognitive entrypoint — reload cognitive architecture (no args), or route to a named skill by keyword. The single command to reorient or redirect.
user-invocable: true
argument-hint: "[skill name or intent keyword, e.g. 'hunt', 'cycle', 'audit', 'knock']"
allowed-tools: Read, Glob, Bash, Task, TaskList, Skill
---

# Concentrate

Single-command cognitive entrypoint. Behavior depends on arguments.

## Branch A — No Arguments: Reload Cognitive Architecture

When `$ARGUMENTS` is empty or whitespace-only, perform a full session-start orientation.

### Step 1: Check Proposal Inbox

```
Bash: ls ~/.claude/proposals/to-unudhr/ 2>/dev/null
```

- If files exist: read each one, evaluate (accept/modify/reject with rationale), move to `~/.claude/proposals/processed/`
- If empty: note "no pending proposals" in the dashboard

### Step 2: Read Current Focus

```
Read: TODO.md (project root) — lines 1-30 only (## Current Focus section)
```

Extract the current focus statement and the remaining `- [ ]` items under it.

### Step 3: Dirty Files + Recent Commits

```
Bash: git status --short
Bash: git log --oneline -5
```

Collect modified/untracked files and the last 5 commit subjects.

### Step 4: Output ASCII Dashboard

Emit this exact format — populate with real data from steps 1-3:

```
╔══════════════════════════════════════════════════════╗
║  HRO — SESSION ORIENTATION  ({today's date})         ║
╚══════════════════════════════════════════════════════╝

PROPOSAL INBOX      {empty / list of proposals processed}

CURRENT FOCUS       {current focus line from TODO.md}
                    {remaining unchecked items, one per line, indented}

DIRTY FILES (git)
  {file}            ← {short note on what it is, if known}
  ...

RECENT COMMITS
  {hash}  {message}
  ...

⚑ EPISTEMIC FLAGS   {any flags — or "None triggered at session start."}
```

Get today's date by running `date -Idate` — do not trust the system context date.

Then ask the user: "Cognitive architecture loaded. What are we working on?"

---

## Branch B — Arguments Given: Route to Skill

When `$ARGUMENTS` is non-empty, parse the intent and route.

### Routing Table

Match `$ARGUMENTS` (case-insensitive, partial match OK) against:

| Argument pattern | Skill to invoke |
|---|---|
| `hunt`, `find work`, `what's next`, `next` | `hunt` |
| `cycle`, `commit`, `deploy`, `post-dev`, `wrap up`, `done` | `cycle` |
| `audit` | `audit` |
| `audit system`, `production`, `prod audit` | `audit_system` |
| `knock`, `consequences`, `effects`, `trace` | `knock` |
| `simplify`, `review`, `clean`, `refactor` | `simplify` |
| `keybindings`, `keys`, `shortcuts`, `rebind` | `keybindings-help` |
| `claude api`, `anthropic`, `sdk`, `claude developer` | `claude-developer-platform` |
| `concentrate` | (recursive — tell user this routes to itself, ask what they meant) |

### Routing Procedure

1. Normalize `$ARGUMENTS` to lowercase, strip leading/trailing whitespace
2. Find the first matching row in the table above
3. If a match is found:
   - Say: `Routing to /{skill-name}…`
   - Invoke the matched skill using the `Skill` tool, passing `$ARGUMENTS` as args (so any sub-arguments reach the target skill)
4. If no match is found → Branch C

---

## Branch C — No Matching Skill: Notify + Propose

When `$ARGUMENTS` is non-empty but no skill matches, tell the user clearly and propose a concrete solution.

### Response Format

```
No skill found for "{$ARGUMENTS}".

Closest existing skill: {name} — {description}
  → /concentrate {name-keyword} to route there

Proposed solution:
  {One of:}
  a) Use /{closest-skill} — [explain why it covers the need]
  b) Create a new skill at .claude/skills/{slug}/SKILL.md — [describe what it would do]
  c) Handle inline — [explain how to accomplish the task without a dedicated skill]

Recommend: {a/b/c} because {one crisp reason}.
```

### Proposal Quality Rules

- **Always recommend a specific action** — never leave the user with "I don't know, maybe create a skill?"
- For needs covered by an existing skill at 80%+: recommend that skill (option a)
- For novel, recurring workflows: recommend creating a new skill (option b) and describe what it would contain
- For one-off tasks: recommend handling inline (option c) and offer to do it now
- State the recommendation before offering alternatives — one decision, not a menu
