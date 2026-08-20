import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentProcesses } from "./process-scan.js";

// Real `ps -Ao pid=,tty=,comm=` output shapes, taken from this Mac.
const PS = [
  "86234 ttys001  claude",
  "88277 ttys002  claude",
  "33428 ttys012  codex",
  "64927 ??       /Applications/ChatGPT.app/Contents/Resources/codex",
  " 2673 ??       node",
  "  501 ttys003  -zsh",
  "12345 ttys004  /opt/homebrew/bin/codex",
  "99999 ttys005  claude.exe",
  "garbage line",
  "",
].join("\n");

test("finds agent CLIs attached to a terminal", () => {
  const found = parseAgentProcesses(PS);
  assert.deepEqual(
    found.map((p) => `${p.provider}:${p.pid}:${p.tty}`),
    ["claude:86234:ttys001", "claude:88277:ttys002", "codex:33428:ttys012", "codex:12345:ttys004", "claude:99999:ttys005"],
  );
});

test("a process with no controlling terminal is not a session", () => {
  const found = parseAgentProcesses(PS);
  // The ChatGPT desktop app runs its own `codex` (an app-server). It is not a
  // session anybody is typing into, and requiring a tty is the whole defence
  // against it taking a slot.
  assert.equal(found.some((p) => p.pid === 64927), false);
  // Same rule keeps the deck namer's headless `claude -p` calls off the deck.
  assert.equal(found.some((p) => p.pid === 2673), false);
});

test("non-agent processes and junk lines are ignored", () => {
  const found = parseAgentProcesses(PS);
  assert.equal(found.some((p) => p.pid === 501), false);
  assert.equal(parseAgentProcesses("").length, 0);
  assert.equal(parseAgentProcesses("not a ps dump at all").length, 0);
});
