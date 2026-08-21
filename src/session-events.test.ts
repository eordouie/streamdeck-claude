import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLog, reduceEvents, liveBgAgents, BG_AGENT_TTL_MS } from "./session-events.js";

test("SessionStart term is reduced into DerivedState.terminal", () => {
  const log = JSON.stringify({ ts: 1, event: "SessionStart", term: "vscode" });
  assert.equal(reduceEvents(parseEventLog(log)).terminal, "vscode");
});

test("SessionStart launch ID is preserved through the normalized state", () => {
  const log = [
    { ts: 1, event: "SessionStart", launchId: "launch-claude" },
    { ts: 2, event: "UserPromptSubmit" },
    { ts: 3, event: "Stop" },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(reduceEvents(parseEventLog(log)).launchId, "launch-claude");
});

test("terminal carries through a turn (UserPromptSubmit/Stop preserve it)", () => {
  const log = [
    { ts: 1, event: "SessionStart", term: "warp" },
    { ts: 2, event: "UserPromptSubmit" },
    { ts: 3, event: "Stop" },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(reduceEvents(parseEventLog(log)).terminal, "warp");
});

test("absent term defaults to 'unknown'", () => {
  const log = JSON.stringify({ ts: 1, event: "SessionStart" });
  assert.equal(reduceEvents(parseEventLog(log)).terminal, "unknown");
});

test("an unrecognised term value is coerced to 'unknown'", () => {
  const log = JSON.stringify({ ts: 1, event: "SessionStart", term: "kitty" });
  assert.equal(reduceEvents(parseEventLog(log)).terminal, "unknown");
});

test("SessionStart transcript is reduced into DerivedState.transcriptPath and survives a turn", () => {
  const log = [
    { ts: 1, event: "SessionStart", term: "ghostty", transcript: "/home/u/.claude/projects/x/abc.jsonl" },
    { ts: 2, event: "UserPromptSubmit" },
    { ts: 3, event: "Stop" },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(reduceEvents(parseEventLog(log)).transcriptPath, "/home/u/.claude/projects/x/abc.jsonl");
});

test("absent transcript defaults to empty string", () => {
  const log = JSON.stringify({ ts: 1, event: "SessionStart", term: "ghostty" });
  assert.equal(reduceEvents(parseEventLog(log)).transcriptPath, "");
});

test("firstPrompt captures the first substantial prompt and stays fixed", () => {
  const log = [
    { ts: 1, event: "SessionStart", term: "ghostty" },
    { ts: 2, event: "UserPromptSubmit", prompt: "hi" },
    { ts: 3, event: "UserPromptSubmit", prompt: "brutally audit the mirror optimizer sweep" },
    { ts: 4, event: "Stop" },
    { ts: 5, event: "UserPromptSubmit", prompt: "now refactor the tolerance budget tab" },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  assert.equal(reduceEvents(parseEventLog(log)).firstPrompt, "brutally audit the mirror optimizer sweep");
});

// --- 2026-08-03 review fixes ------------------------------------------------

const ev = (event: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ts: 1, event, ...extra });
const reduce = (lines: string[]) => reduceEvents(parseEventLog(lines.join("\n")));

test("a rejected plan (PostToolUseFailure) clears awaitingPlan like an approved one", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "please build the thing properly" }),
    ev("PreToolUse", { tool: "ExitPlanMode" }),
    ev("PostToolUseFailure", { tool: "ExitPlanMode" }),
  ]);
  assert.equal(d.awaitingPlan, false);
});

test("an ESC'd question (PostToolUseFailure) clears awaitingQuestion", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "pick one of these options now" }),
    ev("PreToolUse", { tool: "AskUserQuestion" }),
    ev("PostToolUseFailure", { tool: "AskUserQuestion" }),
  ]);
  assert.equal(d.awaitingQuestion, false);
});

test("PermissionDenied clears the permission prompt — no is an answer", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "run the migration script please" }),
    ev("PreToolUse", { tool: "Bash" }),
    ev("Notification", { notifType: "permission_prompt" }),
    ev("PermissionDenied", { tool: "Bash" }),
  ]);
  assert.equal(d.awaitingPermission, false);
});

test("Codex PermissionRequest maps to the shared permission state", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "run the command now please" }),
    ev("PermissionRequest", { tool: "Bash" }),
  ]);
  assert.equal(d.awaitingPermission, true);
});

test("resolved/informational notifications never flip the tile to needs-you", () => {
  for (const notifType of ["idle_prompt", "auth_success", "elicitation_complete", "elicitation_response", "agent_completed", "some_future_type"]) {
    const d = reduce([ev("UserPromptSubmit", { prompt: "keep working on the report" }), ev("Notification", { notifType })]);
    assert.equal(d.awaiting, false, `notifType=${notifType} must not set awaiting`);
    assert.equal(d.awaitingPermission, false);
  }
});

test("genuinely-needs-you notifications still register", () => {
  const perm = reduce([ev("UserPromptSubmit", { prompt: "do the risky thing now" }), ev("Notification", { notifType: "permission_prompt" })]);
  assert.equal(perm.awaitingPermission, true);
  for (const notifType of ["elicitation_dialog", "agent_needs_input"]) {
    const d = reduce([ev("UserPromptSubmit", { prompt: "do the risky thing now" }), ev("Notification", { notifType })]);
    assert.equal(d.awaiting, true, `notifType=${notifType} must set awaiting`);
  }
});

test("subagent tool traffic does not clear a pending permission prompt", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "audit the whole codebase please" }),
    ev("SubagentStart"),
    ev("PreToolUse", { tool: "Bash" }),
    ev("Notification", { notifType: "permission_prompt" }),
    ev("PreToolUse", { tool: "WebSearch" }), // a subagent's tool call, same log
    ev("PostToolUse", { tool: "WebSearch" }),
  ]);
  assert.equal(d.awaitingPermission, true, "the padlock must survive subagent tool events");
});

test("main-thread tool traffic (no subagents in flight) still clears the prompt", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "audit the whole codebase please" }),
    ev("PreToolUse", { tool: "Bash" }),
    ev("Notification", { notifType: "permission_prompt" }),
    ev("PreToolUse", { tool: "Read" }), // resumed activity = the user answered
  ]);
  assert.equal(d.awaitingPermission, false);
});

test("machine-injected prompts never become the naming context", () => {
  const d = reduce([
    ev("SessionStart", { term: "ghostty" }),
    ev("UserPromptSubmit", { prompt: "[SYSTEM NOTIFICATION - NOT USER INPUT] task finished etc" }),
    ev("UserPromptSubmit", { prompt: "<task-notification> something completed </task-notification>" }),
    ev("UserPromptSubmit", { prompt: "fix the slack key on my deck" }),
  ]);
  assert.equal(d.firstPrompt, "fix the slack key on my deck");
});

// --- background-agent badge counter (cross-turn, leak-tolerant) -------------

test("background-agent starts survive turn boundaries, unlike subagentDepth", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "run the release analysis now" }),
    JSON.stringify({ ts: 1000, event: "SubagentStart" }),
    JSON.stringify({ ts: 2000, event: "SubagentStart" }),
    ev("Stop"),
    ev("UserPromptSubmit", { prompt: "different topic entirely here" }),
  ]);
  assert.equal(d.subagentDepth, 0, "turn-scoped depth resets at boundaries");
  assert.deepEqual(d.agentLastSeen, [1000, 2000], "cross-turn starts persist");
});

test("SubagentStop retires the oldest outstanding start, and floors at empty", () => {
  const d = reduce([
    JSON.stringify({ ts: 1000, event: "SubagentStart" }),
    JSON.stringify({ ts: 2000, event: "SubagentStart" }),
    JSON.stringify({ ts: 3000, event: "SubagentStop" }),
  ]);
  assert.deepEqual(d.agentLastSeen, [2000]);
  const empty = reduce([JSON.stringify({ ts: 1000, event: "SubagentStop" })]);
  assert.deepEqual(empty.agentLastSeen, [], "a stop with nothing outstanding is a no-op");
});

test("outstanding starts are capped, keeping the newest", () => {
  const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ ts: (i + 1) * 100, event: "SubagentStart" }));
  const d = reduce(lines);
  assert.equal(d.agentLastSeen.length, 16);
  assert.equal(d.agentLastSeen[0], 500, "oldest four dropped");
  assert.equal(d.agentLastSeen[15], 2000);
});

test("liveBgAgents ages out unmatched starts by TTL — a leaked start cannot strand the badge", () => {
  const now = 10_000_000;
  const starts = [now - BG_AGENT_TTL_MS - 1, now - 60_000, now - 1000];
  assert.equal(liveBgAgents(starts, now), 2);
  assert.equal(liveBgAgents(starts, now + BG_AGENT_TTL_MS), 0, "everything eventually expires");
});

// --- agentId live-set (new-format logs) --------------------------------------
//
// Regression suite for the 2026-08-20 "kids vanish" bug: SubagentStart/Stop
// are NOT a matched pair (measured live: 21 starts vs 178 stops in one
// workflow session — workflow agents fire stops without ever firing starts),
// so every unmatched stop floored subagentDepth back to 0 and the family
// motif died seconds after each spawn. The fix keys liveness on agent_id.

test("a stop-storm from OTHER agents cannot kill a live agent's presence", () => {
  const d = reduce([
    JSON.stringify({ ts: 1000, event: "SubagentStart", agentId: "a1" }),
    // 3 workflow agents that never fired a start each announce their death.
    JSON.stringify({ ts: 2000, event: "SubagentStop", agentId: "w1" }),
    JSON.stringify({ ts: 2100, event: "SubagentStop", agentId: "w2" }),
    JSON.stringify({ ts: 2200, event: "SubagentStop", agentId: "w3" }),
  ]);
  assert.deepEqual(d.agentLastSeen, [1000], "a1 is still believed live");
});

test("a workflow agent with no SubagentStart becomes visible on its first tool call", () => {
  const d = reduce([
    JSON.stringify({ ts: 1000, event: "PreToolUse", tool: "Bash", agentId: "w1" }),
    JSON.stringify({ ts: 5000, event: "PostToolUse", tool: "Bash", agentId: "w1" }),
  ]);
  assert.deepEqual(d.agentLastSeen, [5000], "one live agent, ts refreshed by its last event");
});

test("an agent's own stop removes it, even when its snapshot still lists it", () => {
  // Observed live 2026-08-20: a single-agent session's SubagentStop carried
  // background_tasks listing the stopper itself as running.
  const d = reduce([
    JSON.stringify({ ts: 1000, event: "SubagentStart", agentId: "a1" }),
    JSON.stringify({ ts: 2000, event: "SubagentStop", agentId: "a1", bgIds: ["a1"] }),
  ]);
  assert.deepEqual(d.agentLastSeen, [], "the stopper never survives its own stop");
});

test("a bgIds snapshot prunes ghosts, adopts unseen ids, and supersedes the legacy list", () => {
  const d = reduce([
    JSON.stringify({ ts: 500, event: "SubagentStart" }), // old-format legacy start
    JSON.stringify({ ts: 1000, event: "SubagentStart", agentId: "ghost" }),
    JSON.stringify({ ts: 1500, event: "PreToolUse", tool: "Read", agentId: "a1" }),
    // stop of some other agent, snapshot says: a1 still running, plus a2 we
    // never saw an event for; ghost is gone (killed without its own stop).
    JSON.stringify({ ts: 3000, event: "SubagentStop", agentId: "w9", bgIds: ["a1", "a2"] }),
  ]);
  assert.deepEqual([...d.agentLastSeen].sort(), [1500, 3000], "a1 keeps its ts, a2 stamped at the snapshot, ghost and legacy gone");
});

test("an empty snapshot means nothing is running — everything clears", () => {
  const d = reduce([
    JSON.stringify({ ts: 1000, event: "SubagentStart", agentId: "a1" }),
    JSON.stringify({ ts: 1100, event: "PreToolUse", tool: "Bash", agentId: "a2" }),
    JSON.stringify({ ts: 2000, event: "SubagentStop", agentId: "a1", bgIds: [] }),
  ]);
  assert.deepEqual(d.agentLastSeen, []);
});

test("the live set survives turn boundaries — background agents outlive the turn", () => {
  const d = reduce([
    ev("UserPromptSubmit", { prompt: "audit everything in the repo" }),
    JSON.stringify({ ts: 1000, event: "SubagentStart", agentId: "a1" }),
    ev("Stop"),
    ev("UserPromptSubmit", { prompt: "different topic entirely here" }),
    ev("Stop"),
  ]);
  assert.equal(d.subagentDepth, 0, "depth stays turn-scoped");
  assert.deepEqual(d.agentLastSeen, [1000], "a1 rides across turns until its stop or the TTL");
});

// --- interactiveState: the status+flags → displayed-state decision ---

import { interactiveState } from "./session-events.js";

const noFlags = { awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, subagentActive: false };

test("waiting + question flag shows the question, not idle (AskUserQuestion flips pid.json to 'waiting')", () => {
  assert.equal(interactiveState("waiting", { ...noFlags, awaitingQuestion: true }), "awaiting_question");
});

test("waiting honors the same flag priority as busy", () => {
  assert.equal(interactiveState("waiting", { ...noFlags, awaitingPermission: true, awaitingQuestion: true }), "awaiting_permission");
  assert.equal(interactiveState("waiting", { ...noFlags, awaitingPlan: true }), "awaiting_plan");
});

test("waiting with no flag still reads as a generic prompt — CC says it's waiting on the user", () => {
  assert.equal(interactiveState("waiting", noFlags), "awaiting");
});

test("busy branch unchanged: flags win, else subagent/working", () => {
  assert.equal(interactiveState("busy", { ...noFlags, awaitingQuestion: true }), "awaiting_question");
  assert.equal(interactiveState("busy", { ...noFlags, subagentActive: true }), "subagent");
  assert.equal(interactiveState("busy", noFlags), "working");
});

test("idle stays idle even with stale flags — the interrupt case must not regress", () => {
  assert.equal(interactiveState("idle", { ...noFlags, awaitingQuestion: true, awaitingPermission: true }), "idle");
});

test("idle with live background agents keeps the family walking — the work is still running", () => {
  assert.equal(interactiveState("idle", { ...noFlags, subagentActive: true }), "subagent");
  // Stale flags still lose to idle; only the live-agent signal outranks it.
  assert.equal(interactiveState("idle", { ...noFlags, awaitingPermission: true, subagentActive: true }), "subagent");
});

// ---------------------------------------------------------------------------
// StopFailure must not paint a healthy session red.
//
// Regression suite for the 2026-08-18 "lever" bug: a slot pulsed the red error
// bolt for ~24 h while the session sat idle and fine. `errored` was a latch set
// by StopFailure with exactly ONE escape hatch (UserPromptSubmit), so a Stop
// HOOK exiting non-zero — which happens BY DESIGN here, deck-capture-nudge.py
// blocks to force a capture — permanently alarmed the tile.
// ---------------------------------------------------------------------------

const log = (events: Array<Record<string, unknown>>): string =>
  events.map((e, i) => JSON.stringify({ ts: e.ts ?? i + 1, ...e })).join("\n");

test("StopFailure AFTER a clean Stop does not error — it is hook bookkeeping", () => {
  // The literal sequence off the deck (session "lever", 2026-08-18), real
  // timestamps: the turn ended cleanly, then StopFailure arrived 16 s later.
  const state = reduceEvents(
    parseEventLog(
      log([
        { ts: 1787081000000, event: "UserPromptSubmit", prompt: "do a thing" },
        { ts: 1787081049000, event: "PostToolUse", tool: "Bash" },
        { ts: 1787081762000, event: "Stop" },
        { ts: 1787081778000, event: "StopFailure" },
      ]),
    ),
  );
  assert.equal(state.errored, false, "a post-turn StopFailure is not a session failure");
});

test("StopFailure fired at an idle session does not error", () => {
  // The other two from the same log: CC re-fires Stop hooks against a session
  // that stopped long ago, after its ~60 s idle_prompt reminder.
  const state = reduceEvents(
    parseEventLog(
      log([
        { event: "UserPromptSubmit" },
        { event: "Stop" },
        { event: "Notification", notifType: "idle_prompt" },
        { event: "StopFailure" },
        { event: "Notification", notifType: "idle_prompt" },
        { event: "StopFailure" },
      ]),
    ),
  );
  assert.equal(state.errored, false);
});

test("StopFailure DURING a turn still errors — the signal is not lost", () => {
  const state = reduceEvents(
    parseEventLog(log([{ event: "UserPromptSubmit" }, { event: "PreToolUse", tool: "Bash" }, { event: "StopFailure" }])),
  );
  assert.equal(state.errored, true, "a turn that ended by failing is a real error");
});

test("errored clears on any proof of life, not only on UserPromptSubmit", () => {
  // Each of these alone must heal the tile. UserPromptSubmit was the ONLY one
  // before the fix, which is why the bug needed a human to type in that exact
  // tab to clear it.
  const healers: Array<Record<string, unknown>> = [
    { event: "PreToolUse", tool: "Bash" },
    { event: "PostToolUse", tool: "Bash" },
    { event: "PostToolUseFailure", tool: "Bash" },
    { event: "Stop" },
    { event: "SubagentStop" },
    { event: "SubagentStart" },
    { event: "UserPromptSubmit" },
  ];
  for (const healer of healers) {
    const state = reduceEvents(
      parseEventLog(log([{ event: "UserPromptSubmit" }, { event: "StopFailure" }, healer])),
    );
    assert.equal(state.errored, false, `${String(healer.event)}/${String(healer.tool ?? "")} must clear errored`);
  }
});

test("a subagent's tool call clears errored even though the subagent gate is closed", () => {
  // Tool events keep their subagentDepth gate for the awaiting flags, but
  // errored is cleared outside it: work is work, whoever is doing it.
  const state = reduceEvents(
    parseEventLog(
      log([
        { event: "UserPromptSubmit" },
        { event: "StopFailure" },
        { event: "UserPromptSubmit" },
        { event: "SubagentStart" },
        { event: "StopFailure" },
        { event: "PostToolUse", tool: "WebSearch" },
      ]),
    ),
  );
  assert.equal(state.errored, false);
});

test("the full lever log shape reduces to a calm session", () => {
  // End-to-end over the real sequence, including the activity that followed the
  // last StopFailure and used to be ignored: no awaiting flag, no error.
  const state = reduceEvents(
    parseEventLog(
      log([
        { event: "UserPromptSubmit", prompt: "post to slack" },
        { event: "PreToolUse", tool: "mcp__claude_ai_Slack__slack_send_message" },
        { event: "PostToolUse", tool: "mcp__claude_ai_Slack__slack_send_message" },
        { event: "Stop" },
        { event: "StopFailure" },
        { event: "Notification", notifType: "idle_prompt" },
        { event: "StopFailure" },
        { event: "SubagentStop" },
        { event: "Notification", notifType: "agent_completed" },
      ]),
    ),
  );
  assert.equal(state.errored, false);
  assert.equal(state.awaiting, false);
  assert.equal(state.awaitingPermission, false);
});
