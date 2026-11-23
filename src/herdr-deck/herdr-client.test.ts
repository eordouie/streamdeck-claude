import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFakeHerdr } from "./fake-herdr.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import { focusAgent, HerdrError, herdrCall, readSnapshot } from "./herdr-client.js";

const socketIn = (name: string): string => join(mkdtempSync(join(tmpdir(), "hd-")), name);

test("readSnapshot returns what herdr holds", async () => {
  const fake = await startFakeHerdr(socketIn("a.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1", agent_status: "working" })]));
  try {
    const snap = await readSnapshot(fake.socketPath);
    assert.equal(snap.agents.length, 1);
    assert.equal(snap.agents[0].agent_status, "working");
  } finally {
    await fake.close();
  }
});

test("focusAgent sends the pane id and herdr moves its focus", async () => {
  const fake = await startFakeHerdr(socketIn("b.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]));
  try {
    await focusAgent(fake.socketPath, "wB:p1");
    assert.deepEqual(fake.focusCalls, ["wB:p1"]);
    assert.equal(fake.snapshot.focused_pane_id, "wB:p1");
  } finally {
    await fake.close();
  }
});

test("an unknown pane is a HerdrError with herdr's own code", async () => {
  const fake = await startFakeHerdr(socketIn("c.sock"), rawSnapshot([]));
  try {
    await assert.rejects(focusAgent(fake.socketPath, "w0:p9"), (err: unknown) => err instanceof HerdrError && err.code === "agent_not_found");
  } finally {
    await fake.close();
  }
});

test("no socket file means herdr is not running, reported as ENOENT", async () => {
  await assert.rejects(readSnapshot(socketIn("missing.sock")), (err: unknown) => err instanceof HerdrError && err.code === "ENOENT");
});

test("a herdr that accepts and never answers is a timeout", async () => {
  const path = socketIn("d.sock");
  // A socket nobody reads from never notices that the other side hung up, and
  // server.close() waits for every connection: destroy them, or this test never ends.
  const accepted: Socket[] = [];
  const server = createServer((conn) => accepted.push(conn));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await assert.rejects(herdrCall(path, "session.snapshot", {}, 100), (err: unknown) => err instanceof HerdrError && err.code === "timeout");
  } finally {
    for (const conn of accepted) conn.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("null, a wrong id and a malformed snapshot all reject as protocol errors", async () => {
  const path = socketIn("bad.sock");
  const responses = [null, { id: "other", result: {} },
    { id: "deck", result: { type: "session_snapshot", snapshot: { workspaces: [], tabs: [], agents: [null] } } }];
  const server = createServer(conn => conn.once("data", () => conn.end(JSON.stringify(responses.shift()) + "\n")));
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(path, resolve));
  try {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(readSnapshot(path), (err: unknown) => err instanceof HerdrError && err.code === "bad_reply");
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("starting a fake on an occupied path preserves its owner", async () => {
  const path = socketIn("occupied");
  writeFileSync(path, "existing");
  await assert.rejects(startFakeHerdr(path, rawSnapshot([])));
  assert.equal(readFileSync(path, "utf8"), "existing");
});

test("the fake marks a focused completion seen", async () => {
  const fake = await startFakeHerdr(socketIn("seen.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1", agent_status: "done" })]));
  try {
    await focusAgent(fake.socketPath, "wA:p1");
    assert.equal((await readSnapshot(fake.socketPath)).agents[0].agent_status, "idle");
  } finally {
    await fake.close();
  }
});
