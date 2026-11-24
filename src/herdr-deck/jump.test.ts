import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { spawnCapture } from "../spawn-capture.js";
import { startFakeHerdr } from "./fake-herdr.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import { DEFAULT_SOCKET } from "./herdr-client.js";
import { clientTtys, jumpTo, raiseScript } from "./jump.js";

const PS = [
  "ttys000 S+ herdr herdr", "?? Ss herdr /opt/homebrew/bin/herdr server",
  "ttys014 S+ herdr /opt/homebrew/bin/herdr --session optics", "ttys009 T herdr herdr",
  "ttys003 R+ herdr herdr pane list", "ttys021 S+ herdr-helper herdr-helper",
].join("\n");
const agent = rawAgent({ pane_id: "wA:p1" });
const target = { paneId: agent.pane_id, terminalId: agent.terminal_id, sessionId: agent.agent_session!.value! };
const route = (socketPath: string) => ({ socketPath, liveSocket: DEFAULT_SOCKET, demo: true });
const sock = () => join(mkdtempSync(join(tmpdir(), "hd-")), "j.sock");

test("automatic lookup matches only a foreground local viewer", () => {
  assert.deepEqual(clientTtys(PS), ["/dev/ttys000"]);
  assert.deepEqual(clientTtys(PS, "/dev/ttys014"), ["/dev/ttys014"]);
  assert.deepEqual(clientTtys(PS, "/dev/ttys003"), []);
  assert.deepEqual(clientTtys("?? Ss herdr herdr server"), []);
});

test("the script selects exactly one matched Ghostty terminal", () => {
  const script = raiseScript(["/dev/ttys000", "/dev/ttys014"]);
  assert.match(script, /\{"\/dev\/ttys000", "\/dev\/ttys014"\}/);
  assert.ok(script.indexOf("if matchCount is not 1") < script.indexOf("focus (terminal id targetID)"));
  assert.doesNotMatch(script, /^\s*activate\s*$/m, "the application is brought forward by open -b, after the match");
});

test("a gone or replaced occupant receives no focus or application command", async () => {
  const fake = await startFakeHerdr(sock(), rawSnapshot([agent]));
  const never = async (): Promise<never> => { throw new Error("unexpected application command"); };
  try {
    for (const stale of [{ ...target, paneId: "gone" }, { ...target, terminalId: "other" }, { ...target, sessionId: "other" }]) {
      assert.equal(await jumpTo(route(fake.socketPath), stale, () => {}, { run: never }), "gone");
    }
    assert.deepEqual(fake.focusCalls, []);
  } finally { await fake.close(); }
});

test("an unavailable herdr reports failure", async () => {
  const logs: string[] = [];
  assert.equal(await jumpTo(route(sock()), target, line => logs.push(line)), "failed");
  assert.equal(logs.length, 1);
});

test("one validated press focuses the fake once and raises through an injected command runner", async () => {
  const fake = await startFakeHerdr(sock(), rawSnapshot([agent]));
  const calls: string[] = [];
  const run: typeof spawnCapture = async cmd => {
    calls.push(cmd);
    assert.deepEqual(fake.focusCalls, [target.paneId]);
    return { code: 0, stdout: cmd === "/bin/ps" ? PS : "OK", stderr: "" };
  };
  try {
    assert.equal(await jumpTo(route(fake.socketPath), target, () => {}, { run }), "jumped");
    assert.deepEqual(calls, ["/bin/ps", "/usr/bin/osascript", "/usr/bin/open"]);
  } finally { await fake.close(); }
});

test("a failed or ambiguous terminal selection alerts after one focus and never opens a different window", async () => {
  const fake = await startFakeHerdr(sock(), rawSnapshot([agent]));
  const calls: string[] = [];
  const run: typeof spawnCapture = async cmd => {
    calls.push(cmd);
    return { code: 0, stdout: cmd === "/bin/ps" ? PS : "ERR:missing-or-ambiguous", stderr: "" };
  };
  try {
    assert.equal(await jumpTo(route(fake.socketPath), target, () => {}, { run }), "failed");
    assert.deepEqual(calls, ["/bin/ps", "/usr/bin/osascript"]);
    assert.deepEqual(fake.focusCalls, [target.paneId]);
  } finally { await fake.close(); }
});

test("changing sources during a press prevents focus on the old socket", async () => {
  const fake = await startFakeHerdr(sock(), rawSnapshot([agent]));
  try {
    assert.equal(await jumpTo(route(fake.socketPath), target, () => {}, { isSelected: () => false }), "failed");
    assert.deepEqual(fake.focusCalls, []);
  } finally { await fake.close(); }
});
