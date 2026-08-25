import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTerm, terminalHostedEntry, type TerminalKind } from "./terminal-kind.js";

test("normaliseTerm maps canonical hook values to kinds", () => {
  const cases: [string | undefined, TerminalKind][] = [
    ["vscode", "vscode"],
    ["warp", "warp"],
    ["iterm", "iterm"],
    ["ghostty", "ghostty"],
    ["other", "other"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normaliseTerm(input), expected);
  }
});

test("normaliseTerm defaults unknown/absent to 'unknown'", () => {
  assert.equal(normaliseTerm(undefined), "unknown");
  assert.equal(normaliseTerm(""), "unknown");
  assert.equal(normaliseTerm("WarpTerminal"), "unknown"); // raw env value, not canonical
});

test("terminalHostedEntry accepts the terminal entrypoint and pre-field records", () => {
  assert.equal(terminalHostedEntry("cli"), true);
  assert.equal(terminalHostedEntry(undefined), true); // old CC / bridge records without the field
});

test("terminalHostedEntry fails closed on app-driven entrypoints", () => {
  assert.equal(terminalHostedEntry("claude-desktop"), false); // Desktop agent mode: live pid, no tab
  assert.equal(terminalHostedEntry("sdk"), false);
  assert.equal(terminalHostedEntry(""), false); // present-but-empty is no proof of a terminal
});
