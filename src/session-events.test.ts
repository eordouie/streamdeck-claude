import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLog, reduceEvents } from "./session-events.js";

test("SessionStart term is reduced into DerivedState.terminal", () => {
  const log = JSON.stringify({ ts: 1, event: "SessionStart", term: "vscode" });
  assert.equal(reduceEvents(parseEventLog(log)).terminal, "vscode");
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
