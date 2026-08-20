import assert from "node:assert/strict";
import { test } from "node:test";
import { processBelongsToProvider } from "./provider-process.js";

test("an interactive claude session is a claude process", () => {
  assert.equal(processBelongsToProvider("claude", "claude"), true);
});

test("a background job runs as claude.exe and is still a claude process", () => {
  // Observed live 2026-08-19 on pid 43095, a --bg-pty-host job: `ps -o comm=`
  // reports .../claude-code/bin/claude.exe, whose basename is claude.exe.
  // Rejecting it made the deck refuse to kill any background job.
  assert.equal(processBelongsToProvider("claude.exe", "claude"), true);
});

test("an unrelated process is never a claude process", () => {
  assert.equal(processBelongsToProvider("node", "claude"), false);
  assert.equal(processBelongsToProvider("claudia", "claude"), false);
  assert.equal(processBelongsToProvider("", "claude"), false);
});

test("codex matches by substring, claude does not", () => {
  assert.equal(processBelongsToProvider("codex", "codex"), true);
  assert.equal(processBelongsToProvider("codex-darwin-arm64", "codex"), true);
  assert.equal(processBelongsToProvider("codex", "claude"), false);
});
