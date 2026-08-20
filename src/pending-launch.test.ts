import assert from "node:assert/strict";
import { test } from "node:test";
import { PendingLaunches } from "./pending-launch.js";

test("a reservation matches on launch ID alone, whichever agent claims it", () => {
  const pending = new PendingLaunches();
  const launch = pending.start("slot-a", 100);

  assert.equal(launch.actionId, "slot-a");
  assert.equal(pending.match({ launchId: "other" }), undefined);
  assert.equal(pending.match({ launchId: undefined }), undefined);
  // The gesture never chose an agent, so the provider that eventually registers
  // must not be part of the match — Codex claiming a reservation is normal.
  assert.equal(pending.match({ launchId: launch.id }), "slot-a");
  assert.equal(pending.match({ launchId: launch.id }), undefined);
});

test("failed launches are removed and simultaneous launches stay distinct", () => {
  const pending = new PendingLaunches();
  const first = pending.start("slot-a", 100);
  const second = pending.start("slot-b", 101);

  pending.fail("slot-a");
  assert.equal(pending.match({ launchId: first.id }), undefined);
  assert.equal(pending.match({ launchId: second.id }), "slot-b");
  assert.notEqual(first.id, second.id);
});

test("a reservation expires so an unused tab cannot strand a slot", () => {
  const pending = new PendingLaunches();
  pending.start("slot-a", 100);
  assert.deepEqual(pending.expire(120_099, 120_000), []);
  assert.deepEqual(pending.expire(120_101, 120_000), ["slot-a"]);
  assert.equal(pending.get("slot-a"), undefined);
});
