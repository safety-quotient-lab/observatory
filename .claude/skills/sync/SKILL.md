---
name: sync
description: Inter-agent mesh synchronization — check all peer repos for PRs, proposals, and commits; merge inbound; write ACKs; deliver outbound via PR.
user-invocable: true
argument-hint: "[agent name to sync with, or empty for all]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion
---

# /sync — Inter-Agent Mesh Synchronization

Check all peer agent channels for incoming messages, merge accepted PRs,
write ACKs, update session state, and report what changed.

## When to Invoke

- Start of any session (fast check for new activity)
- After a peer agent is expected to respond
- When the user says "interagent sync," "sync," "check agents," or "anything new?"
- Before writing new inter-agent messages (ensures latest state)

## Arguments

Parse `$ARGUMENTS` to determine scope:

| Argument | Scope |
|---|---|
| *(empty)* or `all` | Full sweep — all 3 peer repos |
| `unratified` | Only unratified-agent (safety-quotient-lab/unratified) |
| `psychology` or `psych` | Only psychology-agent (safety-quotient-lab/psychology-agent) |
| `psq` or `safety-quotient` | Only psq-agent (safety-quotient-lab/safety-quotient) |

## Peer Agent Registry

| Agent | Repo | Agent Card | Transport |
|-------|------|------------|-----------|
| unratified-agent | safety-quotient-lab/unratified | https://unratified.org/.well-known/agent-card.json | git-PR |
| psychology-agent | safety-quotient-lab/psychology-agent | (local only) | git-PR |
| psq-agent | safety-quotient-lab/safety-quotient | (local only) | git-PR |

## Protocol

### Phase 1: Inbound Scan

Run in parallel for all in-scope repos:

```bash
# Check for open PRs on our repo (inbound from peers)
gh pr list --repo safety-quotient-lab/observatory --state open

# Check for recently merged PRs on our repo (may contain unprocessed transport messages)
gh pr list --repo safety-quotient-lab/observatory --state merged --limit 5

# Check for open PRs on each peer repo (our outbound, waiting for merge)
gh pr list --repo safety-quotient-lab/unratified --state open
gh pr list --repo safety-quotient-lab/psychology-agent --state open
gh pr list --repo safety-quotient-lab/safety-quotient --state open

# Check for recently merged PRs on peer repos (our outbound that was accepted)
gh pr list --repo safety-quotient-lab/unratified --state merged --limit 5
gh pr list --repo safety-quotient-lab/psychology-agent --state merged --limit 5
gh pr list --repo safety-quotient-lab/safety-quotient --state merged --limit 5
```

Also check local proposal inboxes:
```bash
ls ~/.claude/proposals/to-unudhr/          # inbound proposals
ls .claude/proposals/from-*/               # git-tracked inbound
```

### Phase 1b: Cogarch Sync Check (optional)

If a peer agent's agent card has changed since last sync:
1. Note capability changes (new skills, updated extensions)
2. Include `cogarch_changed: true` in next outbound ACK

### Phase 2: Triage

For each inbound item, classify:

| Type | Source | Action |
|------|--------|--------|
| Open PR on observatory | Peer agent branch | Read diff → assess → merge or flag |
| Pending proposal | `~/.claude/proposals/to-unudhr/` | Read → accept/defer/reject |
| Open PR on peer repo (ours) | Our outbound waiting for merge | Report status |
| No new activity | — | Report "nothing new" and stop |

### Phase 3: Process Inbound PRs

For an inbound PR (branch pattern: `{agent}/{session}/{turn}`):

1. Read the diff: `gh pr view {N} --repo safety-quotient-lab/observatory --json title,body,files`
2. Read the full diff: `gh pr diff {N} --repo safety-quotient-lab/observatory`
3. Assess the content — transport message, blog contribution, code change?
4. If acceptable: `gh pr merge {N} --merge --repo safety-quotient-lab/observatory`
5. Pull: `git pull --rebase origin main` (stash if needed)
6. If a response is needed, write it (see Phase 4)

### Phase 4: Write ACK / Response Messages (interagent/v1)

Use this template for all outbound transport messages:

```json
{
  "schema": "interagent/v1",
  "session_id": "{session-id}",
  "turn": {N},
  "timestamp": "{YYYY-MM-DD}",
  "message_type": "ack | response | gate-resolution | request",
  "in_response_to": "{filename}",
  "from": {
    "agent_id": "observatory-agent",
    "instance": "Claude Code (Opus 4.6), Debian 12 x86_64",
    "schemas_supported": ["interagent/v1", "observatory-agent/machine-response/v1"],
    "discovery_url": "https://observatory.unratified.org/.well-known/agent-card.json"
  },
  "to": {
    "agent_id": "{peer-agent-id}",
    "discovery_url": "https://{peer-domain}/.well-known/agent-card.json"
  },
  "transport": {
    "method": "git-pr",
    "persistence": "persistent"
  },
  "payload": { ... },
  "claims": [
    {
      "claim_id": "c1",
      "text": "...",
      "confidence": 0.0,
      "confidence_basis": "...",
      "independently_verified": false
    }
  ],
  "action_gate": {
    "gate_condition": "none | {condition}",
    "gate_status": "open | blocked",
    "gate_note": "..."
  },
  "urgency": "immediate | high | normal | low",
  "setl": 0.0,
  "epistemic_flags": ["..."]
}
```

**Urgency guidance** (adopted from unratified-agent amendment, 2026-03-06):
- `immediate`: Blocks active work — respond before next session
- `high`: Process this session or next
- `normal`: Process at next sync (default if omitted)
- `low`: No time pressure

**SETL guidance:**
- 0.00–0.02: Perfect fidelity, direct observation
- 0.03–0.07: Minor inference, high confidence
- 0.08–0.15: Moderate inference or domain boundary
- 0.16+: Significant interpretation required

### Phase 5: Deliver Outbound via PR

Every outbound message must travel to the peer agent's repo as a PR:

```bash
# Clone peer repo to /tmp
cd /tmp && rm -rf {repo}-pr
git clone --depth 1 git@github.com:safety-quotient-lab/{repo}.git {repo}-pr
cd /tmp/{repo}-pr

# Create branch and add message
git checkout -b observatory-agent/{session-id}/{turn-descriptor}
mkdir -p transport/sessions/{session-id}
cp {local-message-path} transport/sessions/{session-id}/from-observatory-agent-{NNN}.json

# Commit and push
git commit -m "interagent: {description}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin observatory-agent/{session-id}/{turn-descriptor}

# Create PR
gh pr create --repo safety-quotient-lab/{repo} \
  --head observatory-agent/{session-id}/{turn-descriptor} \
  --title "interagent: {description} ({session} turn {N})" \
  --body "..."

# Cleanup
rm -rf /tmp/{repo}-pr
```

### Phase 6: Commit Local Transport + Push

```bash
git add transport/sessions/
git commit -m "interagent: {summary}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
```

## Session Naming Convention

```
transport/sessions/{session-id}/
  to-{agent-id}-{NNN}.json      # outbound from observatory-agent
  from-{agent-id}-{NNN}.json    # inbound from peer agents
```

Session IDs are semantic: `mesh-init`, `icescr-framing`, `voter-guide-prioritization`.
Never use opaque IDs like `item2` or `session-3`.

## Output Format

```
SYNC COMPLETE
─────────────
  Scanned:    {N} repos ({list})
  Inbound:    {description of PRs merged / proposals processed | "nothing new"}
  Outbound:   {ACKs sent | "nothing to send"}
  Waiting on: {what we expect from each peer | "nothing pending"}
```

## Epistemic Flag → Task Pipeline

After sync completes, review all epistemic flags (from inbound messages AND from our own sync output). For each **actionable** flag — one that requires a code change, doc update, config fix, or investigation — create a task using `TaskCreate`:

- **Subject**: concise imperative (e.g., "Add machine-response/v1 to agent card")
- **Description**: include the source (which message/turn), the flag text, and what resolution looks like
- **activeForm**: present continuous (e.g., "Updating agent card schemas")

Skip task creation for:
- Informational-only flags (no action needed)
- Flags already tracked in TODO.md or an existing task
- Flags the sync itself resolved (e.g., merged a PR that closed the gap)

This ensures epistemic flags don't evaporate after the sync dashboard scrolls past.

## Epistemic Posture

Every ACK from observatory-agent must:
- State claims with explicit confidence (0.0–1.0)
- Surface epistemic flags for any inference
- Set `action_gate` to blocked if we need something before proceeding
- Match SETL to actual information fidelity
- Never claim `independently_verified: true` unless we verified the claim ourselves
