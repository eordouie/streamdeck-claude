import assert from "node:assert/strict";
import { test } from "node:test";
import { binaryIndex, DEFAULT_AGENT_CONFIG } from "./agent-config.js";
import { parseAgentProcesses, parseLsofIo } from "./process-scan.js";

const BINARIES = binaryIndex(DEFAULT_AGENT_CONFIG);

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
  // The Codex MCP server every Claude Code session with that MCP configured
  // spawns. `comm` is `codex` and the tty is its HOST session's, so it is
  // indistinguishable from a TUI here, by design — see the io tests below.
  "47192 ttys000  /opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
  "garbage line",
  "",
].join("\n");

test("finds agent binaries attached to a terminal", () => {
  const found = parseAgentProcesses(PS, BINARIES);
  assert.deepEqual(
    found.map((p) => `${p.provider}:${p.pid}:${p.tty}`),
    [
      "claude:86234:ttys001",
      "claude:88277:ttys002",
      "codex:33428:ttys012",
      "codex:12345:ttys004",
      "claude:99999:ttys005",
      "codex:47192:ttys000",
    ],
  );
});

test("the process table alone cannot judge an MCP server", () => {
  // Deliberate: this listing is a candidate list, not a verdict. An MCP server
  // inherits its host session's tty, so no column here separates them — which
  // is why the interactivity test lives in readProcessIo and names no provider.
  assert.equal(parseAgentProcesses(PS, BINARIES).some((p) => p.pid === 47192), true);
});

test("a process with no controlling terminal is not a candidate", () => {
  const found = parseAgentProcesses(PS, BINARIES);
  // The ChatGPT desktop app's own `codex` app-server.
  assert.equal(found.some((p) => p.pid === 64927), false);
  // The deck namer's headless `claude -p` calls.
  assert.equal(found.some((p) => p.pid === 2673), false);
});

test("non-agent processes and junk lines are ignored", () => {
  const found = parseAgentProcesses(PS, BINARIES);
  assert.equal(found.some((p) => p.pid === 501), false);
  assert.equal(parseAgentProcesses("", BINARIES).length, 0);
  assert.equal(parseAgentProcesses("not a ps dump at all", BINARIES).length, 0);
});

// Real `lsof -a -d cwd,0 -p <pid> -Fftn` output, taken from this Mac.
const LSOF_TUI = ["p47080", "fcwd", "tDIR", "n/Users/ehsan/Projects", "f0", "tCHR", "n/dev/ttys000"].join("\n");
const LSOF_MCP = ["p47192", "fcwd", "tDIR", "n/Users/ehsan/Projects", "f0", "tunix", "n->0xb139e238edccaea6"].join("\n");

test("stdin on a terminal is a session somebody is typing into", () => {
  assert.deepEqual(parseLsofIo(LSOF_TUI), { cwd: "/Users/ehsan/Projects", stdinTty: "/dev/ttys000" });
  // Linux/WSL names its pty differently and is still a terminal.
  const pts = ["p900", "fcwd", "tDIR", "n/home/ehsan", "f0", "tCHR", "n/dev/pts/3"].join("\n");
  assert.equal(parseLsofIo(pts).stdinTty, "/dev/pts/3");
});

test("piped stdin is plumbing, whatever the binary is called", () => {
  // The whole fix, and it knows nothing about Codex: the MCP server shares the
  // TUI's binary name, tty, cwd, process group and `S+` state. Only fd 0 differs.
  const io = parseLsofIo(LSOF_MCP);
  assert.equal(io.stdinTty, undefined);
  assert.equal(io.cwd, "/Users/ehsan/Projects");
  // FIFOs and closed stdin are the same answer, so a `--print` run or an
  // app-server started by any future agent needs no new rule.
  const fifo = ["p1", "f0", "tFIFO", "npipe"].join("\n");
  assert.equal(parseLsofIo(fifo).stdinTty, undefined);
});

test("a failed or empty lsof yields nothing rather than a guess", () => {
  assert.deepEqual(parseLsofIo(""), {});
  // Fails closed: no proof of a terminal means no tile. The cost is a tile that
  // appears late; the alternative cost is a phantom that never leaves.
  assert.equal(parseLsofIo("p47192\nfcwd\ntDIR\nn/Users/ehsan").stdinTty, undefined);
});

test("an agent that only exists in config gets found with no code edit", () => {
  // The whole point of the config surface: `gemini` is a name this repo has
  // never heard of, and one line of config is all it takes to see it.
  const configured = binaryIndex({ agents: { gemini: ["gemini"] }, untaggedAgent: "" });
  const ps = ["7788 ttys009  /opt/homebrew/bin/gemini", "86234 ttys001  claude"].join("\n");
  assert.deepEqual(
    parseAgentProcesses(ps, configured).map((p) => `${p.provider}:${p.pid}`),
    ["gemini:7788"],
  );
  // ...and dropping claude from config drops it from the deck. No privilege.
  assert.equal(parseAgentProcesses(ps, configured).some((p) => p.provider === "claude"), false);
});
