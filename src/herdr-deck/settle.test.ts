import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import type { AgentStatus } from "./model.js";
import { HOLD_MS, settle, type SettleState } from "./settle.js";

/** Feed one agent's raw (status, seq) at each time; return what the deck shows each time. */
function run(steps: Array<[number, AgentStatus, number]>): Array<[AgentStatus, number]> {
  let state: SettleState = new Map();
  return steps.map(([now, status, seq]) => {
    const r = settle(state, [deckAgent({ paneId: "wA:p1", status, seq })], now);
    state = r.state;
    return [r.agents[0].status, r.agents[0].seq];
  });
}

test("the measured 2 s finished blip never reaches the deck", () => {
  // Pane w7:p2 on 2026-11-23: working 170, done 177 at 16:18:41, working 178 at 16:18:43.
  assert.deepEqual(run([[0, "working", 170], [1000, "done", 177], [2500, "done", 177], [3000, "working", 178], [9000, "working", 178]]), [
    ["working", 170], ["working", 170], ["working", 170], ["working", 170], ["working", 170],
  ]);
});

test("a turn that stays ended is believed once it has held HOLD_MS", () => {
  assert.deepEqual(run([[0, "working", 10], [1000, "done", 20], [1000 + HOLD_MS - 1, "done", 20], [1000 + HOLD_MS, "done", 20]]), [
    ["working", 10], ["working", 10], ["working", 10], ["done", 20],
  ]);
});

test("needing the owner is shown at once, even during a hold", () => {
  assert.deepEqual(run([[0, "working", 10], [500, "idle", 11], [900, "blocked", 12]]), [["working", 10], ["working", 10], ["blocked", 12]]);
});

test("starting to work is shown at once", () => {
  assert.deepEqual(run([[0, "idle", 5], [100, "working", 6]]), [["idle", 5], ["working", 6]]);
});

test("seen after finished is shown at once and keeps the finish counter", () => {
  assert.deepEqual(run([[0, "done", 30], [100, "idle", 30]]), [["done", 30], ["idle", 30]]);
});

test("an agent the deck has not seen before is shown as herdr reports it", () => {
  assert.deepEqual(run([[0, "done", 7]]), [["done", 7]]);
});

test("an agent that left is forgotten", () => {
  const first = settle(new Map(), [deckAgent({ paneId: "wA:p1" }), deckAgent({ paneId: "wB:p1" })], 0);
  const second = settle(first.state, [deckAgent({ paneId: "wB:p1" })], 500);
  assert.deepEqual([...second.state.keys()], ["wB:p1"]);
});

test("a counter that moved while the shown status stayed the same leaves the agent in its place", () => {
  // An excursion shorter than one poll (working, blocked, working inside 500 ms) is a blip too.
  assert.deepEqual(run([[0, "working", 10], [500, "working", 16], [1000, "working", 16]]), [
    ["working", 10], ["working", 10], ["working", 10],
  ]);
});

test("a replacement in the same pane or a reset counter starts a fresh observation", () => {
  const a = deckAgent({ paneId: "wA:p1", status: "working", seq: 99 });
  const first = settle(new Map(), [a], 0);
  for (const next of [{ ...a, status: "done" as const, seq: 2 },
                      { ...a, status: "done" as const, seq: 100, sessionId: "replacement" }]) {
    assert.equal(settle(first.state, [next], 500).agents[0].status, "done");
  }
});
