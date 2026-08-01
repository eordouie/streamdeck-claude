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
