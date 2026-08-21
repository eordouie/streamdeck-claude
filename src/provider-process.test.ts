import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AGENT_CONFIG, type AgentConfig } from "./agent-config.js";
import { processBelongsToProvider } from "./provider-process.js";

const CONFIG = DEFAULT_AGENT_CONFIG;

test("an interactive claude session is a claude process", () => {
  assert.equal(processBelongsToProvider("claude", "claude", CONFIG), true);
});

test("a background job runs as claude.exe and is still a claude process", () => {
  // Observed live 2026-08-19 on pid 43095, a --bg-pty-host job: `ps -o comm=`
  // reports .../claude-code/bin/claude.exe, whose basename is claude.exe.
  // Rejecting it made the deck refuse to kill any background job. It matches
  // because config DECLARES both binaries for that provider, not because the
  // code knows the name.
  assert.equal(processBelongsToProvider("claude.exe", "claude", CONFIG), true);
});

test("an unrelated process is never a claude process", () => {
  assert.equal(processBelongsToProvider("node", "claude", CONFIG), false);
  assert.equal(processBelongsToProvider("claudia", "claude", CONFIG), false);
  assert.equal(processBelongsToProvider("", "claude", CONFIG), false);
});

test("npm's per-arch binary name still matches its provider", () => {
  assert.equal(processBelongsToProvider("codex", "codex", CONFIG), true);
  assert.equal(processBelongsToProvider("codex-darwin-arm64", "codex", CONFIG), true);
  assert.equal(processBelongsToProvider("codex", "claude", CONFIG), false);
});

test("a provider that only exists in config is guarded like any other", () => {
  // The point of the whole exercise: no code edit taught it this agent.
  const config: AgentConfig = { agents: { gemini: ["gemini"] }, untaggedAgent: "" };
  assert.equal(processBelongsToProvider("gemini", "gemini", config), true);
  assert.equal(processBelongsToProvider("gemini-linux-x64", "gemini", config), true);
  assert.equal(processBelongsToProvider("claude", "gemini", config), false);
  // An unconfigured provider matches nothing — a kill is refused, not guessed.
  assert.equal(processBelongsToProvider("claude", "claude", config), false);
});
