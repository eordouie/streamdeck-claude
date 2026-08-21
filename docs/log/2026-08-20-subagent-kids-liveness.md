# Subagent kids vanish while agents still run — effort log

> **Status:** DONE — root-caused, fixed, tested (125/125), built, reloaded,
> live-verified end to end (agent running → family walks in busy AND idle;
> agent stops → set drains immediately; real workflow session shows its live
> agents; no plugin log errors).
> **Last updated:** 2026-08-20
> **Uncommitted:** yes, deliberately — rides with the phantom-codex-tile WIP
> already parked in this tree; both route through Ehsan's release flow.
> **Next step:** none. If ghost families ever annoy (agent killed with no
> stop and no later stop to snapshot-prune it), tighten BG_AGENT_TTL_MS.

## Symptom (Ehsan, 2026-08-20)

The `subagent` motif (mascot + babies) shows for a few seconds after agents
spawn, then reverts to plain `working`/`idle` even though subagents keep
running for many minutes. Reported live against the tracker-decantilever
session (6cd555a3), which was running a Workflow fan-out.

## Root cause (measured, not guessed)

`subagentDepth` in `session-events.ts` assumes SubagentStart/SubagentStop are
a matched pair. They are not:

- Live log 6cd555a3 (23.1 min, workflow of ~150 agents):
  **21 SubagentStart vs 178 SubagentStop.** Workflow-tool agents fire stops
  without ever firing starts.
- Replaying that log: depth > 0 for **114 s total out of 23 min**, in
  slivers of 0.1–8 s. Every excess stop floors depth back to 0 — exactly the
  "kids for a few seconds" symptom.
- The FIFO `bgAgentStartTimes` list (the +N badge) dies the same way: each
  unmatched stop `slice(1)`s a start it doesn't own.

## What the hook payloads actually carry (probed live, 2026-08-20)

Raw-captured `$INPUT` across three sessions (probe: temporary tee in
notification.sh; 64 + 52 payloads):

- **Every event fired from inside a subagent carries `agent_id` +
  `agent_type`** — PreToolUse/PostToolUse included. Main-thread events carry
  neither. This is the discriminator the hook was dropping.
- **`SubagentStop` carries `background_tasks`**: the full authoritative array
  of still-running tasks `{id, type: "subagent"|"shell", status: "running",
  description, agent_type}` (plus `session_crons`). No other event carries it
  (checked Notification, Pre/PostToolUse both contexts, SubagentStart).
- Gotcha: **a stopping agent can appear in its own stop's snapshot** (observed:
  single-agent session, stop's background_tasks listed the stopper as
  running). Apply snapshot, then delete the stopper's own id.
- Workflow-spawned and Agent-tool agents both write live transcripts under
  `~/.claude/projects/<encoded-cwd-at-spawn>/<sid>/subagents/agent-*.jsonl`
  (mtime is a liveness signal, verified 4 s fresh) — but the encoded dir
  follows the agent's cwd (worktree sessions scatter across dirs), so the
  event-log route is cleaner than transcript mtime scanning. Kept as fallback
  knowledge, not used by the fix.

## Fix design

Event-log architecture preserved (no sidecars, no mtime heuristics):

1. **Hook** (`notification.sh` + `notification.ps1` mirror): emit `agentId`
   (from `.agent_id`) on every event that has it; on SubagentStop emit
   `bgIds` = ids of `background_tasks[]` with `type=="subagent" &&
   status=="running"` (null when the field is absent — absent ≠ empty).
2. **Reducer** (`session-events.ts`): new `agentsSeen: Record<id, lastSeenTs>`.
   - Any agentId-bearing event (except SubagentStop) upserts `id → ts` —
     workflow agents that never fire SubagentStart become visible on their
     first tool call.
   - SubagentStop with agentId: apply `bgIds` snapshot when present (prune to
     snapshot ∩/∪, preserving known timestamps, stamping new ids at ev.ts,
     clearing the legacy list — the snapshot is authoritative), then delete
     the stopper's own id.
   - **Not reset at turn boundaries** (UserPromptSubmit/Stop) — background
     agents outlive turns; same lesson as bgAgentStartTimes.
   - Legacy depth machinery kept untouched for old-format logs (no agentId);
     `subagentActive = depth > 0 || liveAgents > 0`.
   - `bgAgentStartTimes` → `agentLastSeen` (legacy starts ∪ agentsSeen
     values); TTL drops 30 min → 15 min (must exceed the 10-min Bash tool
     cap — the longest legitimate silent gap for a live agent mid-call;
     snapshots converge ghosts much faster whenever any stop fires).
3. **Display** (`interactiveState`): `idle + subagentActive → "subagent"` —
   the turn can end while background agents keep working; the tile keeps the
   walking family until they actually finish. BUSY_STATES already contains
   `subagent`, so the family→idle transition arms the attention flash
   (= "your agents are done"), which is the wanted signal.

Accepted residual: an agent killed without a SubagentStop (crash, hard kill)
can ghost the family for ≤15 min if no other stop fires to snapshot-prune it.

## Verification

- Unit tests: stop-storm, workflow-agent-via-tool-call, snapshot prune/add,
  own-id-in-snapshot, turn-boundary survival, legacy-format unchanged.
- Replay of the real 6cd555a3 log through the new reducer.
- Live: reload plugin, spawn background agents, watch the tile hold the
  family for the full run.
