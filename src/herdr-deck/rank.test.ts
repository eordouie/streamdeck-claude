import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { rankAgents } from "./rank.js";

const ids = (agents: ReturnType<typeof rankAgents>): string[] => agents.map((a) => a.paneId);

test("needs-you, then working, then finished, then idle", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "idle", seq: 90 }),
    deckAgent({ paneId: "wB:p1", status: "done", seq: 80 }),
    deckAgent({ paneId: "wC:p1", status: "working", seq: 70 }),
    deckAgent({ paneId: "wD:p1", status: "blocked", seq: 60 }),
  ]);
  assert.deepEqual(ids(ranked), ["wD:p1", "wC:p1", "wB:p1", "wA:p1"]);
});

test("inside a group the agent that entered it last comes first", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "working", seq: 5 }),
    deckAgent({ paneId: "wB:p1", status: "working", seq: 9 }),
    deckAgent({ paneId: "wC:p1", status: "working", seq: 7 }),
  ]);
  assert.deepEqual(ids(ranked), ["wB:p1", "wC:p1", "wA:p1"]);
});

test("an unclassified agent ranks with the idle ones", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "unknown", seq: 50 }),
    deckAgent({ paneId: "wB:p1", status: "idle", seq: 60 }),
    deckAgent({ paneId: "wC:p1", status: "done", seq: 1 }),
  ]);
  assert.deepEqual(ids(ranked), ["wC:p1", "wB:p1", "wA:p1"]);
});

test("equal counters fall back to workspace order, then pane number, so the order never flickers", () => {
  const a = deckAgent({ paneId: "wB:p10", workspaceNumber: 2, seq: 0 });
  const b = deckAgent({ paneId: "wB:p2", workspaceNumber: 2, seq: 0 });
  const c = deckAgent({ paneId: "wA:p1", workspaceNumber: 1, seq: 0 });
  assert.deepEqual(ids(rankAgents([a, b, c])), ["wA:p1", "wB:p2", "wB:p10"]);
  assert.deepEqual(ids(rankAgents([c, b, a])), ["wA:p1", "wB:p2", "wB:p10"]);
});

test("ranking does not mutate its input", () => {
  const input = [deckAgent({ paneId: "wA:p1", status: "idle" }), deckAgent({ paneId: "wB:p1", status: "blocked" })];
  rankAgents(input);
  assert.equal(input[0].paneId, "wA:p1");
});
