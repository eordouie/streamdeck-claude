import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SOCKET } from "./herdr-client.js";
import { readRoute, sameRoute, statePath } from "./route.js";

test("only an absent config selects the default; malformed configuration cannot silently redirect a press", () => {
  const dir = mkdtempSync(join(tmpdir(), "route-"));
  assert.equal(readRoute(dir).socketPath, DEFAULT_SOCKET);
  assert.equal(statePath(dir, readRoute(dir)), join(dir, "state.json"));
  for (const bad of ["{", "null", "{}", '{"socketPath":"relative"}']) {
    writeFileSync(join(dir, "config.json"), bad);
    assert.throws(() => readRoute(dir));
  }
});

test("a stopped demo still selects its missing fake socket and never opens live mascot memory", () => {
  const dir = mkdtempSync(join(tmpdir(), "route-"));
  const cfg = '{ "socketPath": "/named/socket", "clientTty": "/dev/ttys014" }\n';
  writeFileSync(join(dir, "config.json"), cfg);
  const live = readRoute(dir);
  const gone = join(dir, "no-such-demo");
  symlinkSync(gone, join(dir, "demo-active"));
  const demo = readRoute(dir);
  assert.equal(demo.socketPath, join(gone, "demo.sock"));
  assert.equal(statePath(dir, demo), undefined);
  assert.ok(!sameRoute(live, demo));
  unlinkSync(join(dir, "demo-active"));
  assert.ok(sameRoute(readRoute(dir), live));
  assert.equal(readFileSync(join(dir, "config.json"), "utf8"), cfg);
  assert.notEqual(statePath(dir, live), join(dir, "state.json"));
});
