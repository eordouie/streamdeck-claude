import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { assignMascots, loadMemory, sameMemory, saveMemory, type MascotMemory } from "./mascot-pool.js";

const agents = (...ids: string[]) => ids.map((paneId) => deckAgent({ paneId }));
const indexOf = (m: MascotMemory, paneId: string): number | undefined => m[paneId]?.index;

test("the first agents take the first animals, in rank order", () => {
  const m = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  assert.deepEqual([indexOf(m, "wA:p1"), indexOf(m, "wB:p1"), indexOf(m, "wC:p1")], [0, 1, 2]);
});

test("an agent keeps its animal when the ranking changes", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  const second = assignMascots(first, agents("wC:p1", "wA:p1", "wB:p1"), 28, 28);
  assert.ok(sameMemory(first, second));
});

test("a closed agent frees its animal and the next newcomer takes the lowest free one", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  const second = assignMascots(first, agents("wA:p1", "wC:p1", "wD:p1"), 28, 28);
  assert.equal(indexOf(second, "wB:p1"), undefined);
  assert.equal(indexOf(second, "wD:p1"), 1);
  assert.equal(indexOf(second, "wC:p1"), 2);
});

test("an agent without a key gets no animal until it has one", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 2, 28);
  assert.equal(indexOf(first, "wC:p1"), undefined);
  const second = assignMascots(first, agents("wC:p1", "wA:p1", "wB:p1"), 2, 28);
  assert.equal(indexOf(second, "wC:p1"), 2);
  assert.equal(indexOf(second, "wB:p1"), 1, "an agent that lost its key keeps its animal while there are spares");
});

test("with every animal taken, a newcomer with a key takes one from the lowest agent without a key", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 3, 3);
  const second = assignMascots(first, agents("wD:p1", "wA:p1", "wB:p1", "wC:p1"), 3, 3);
  assert.equal(indexOf(second, "wD:p1"), 2, "takes wC's animal");
  assert.equal(indexOf(second, "wC:p1"), undefined);
});

test("28 keys over 40 agents and 28 animals never show an animal twice", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `w${i}:p1`);
  let memory = assignMascots({}, agents(...ids), 28, 28);
  for (let round = 0; round < 20; round++) {
    ids.push(ids.shift()!, ids.shift()!, ids.shift()!);
    memory = assignMascots(memory, agents(...ids), 28, 28);
    const shown = ids.slice(0, 28).map((id) => indexOf(memory, id));
    assert.ok(shown.every((i) => i !== undefined && i >= 0 && i < 28), `round ${round}: every key has an animal`);
    assert.equal(new Set(shown).size, 28, `round ${round}: no animal twice`);
  }
});

test("a roster too small for the shown keys fails before an animal can repeat", () => {
  assert.throws(() => assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 3, 2), /distinct animal/);
});

test("known sessions keep their own animals when the server swaps their pane ids", () => {
  const memory = { a: { index: 3, sessionId: "x" }, b: { index: 10, sessionId: "y" } };
  const next = assignMascots(memory, [deckAgent({ paneId: "a", sessionId: "y" }), deckAgent({ paneId: "b", sessionId: "x" })], 28, 28);
  assert.deepEqual([next.a.index, next.b.index], [10, 3]);
});

test("a pane id that changed is recognised by its session id", () => {
  const before: MascotMemory = { "w3:p1": { index: 5, sessionId: "s-abc" } };
  const after = assignMascots(before, [deckAgent({ paneId: "w9:p4", sessionId: "s-abc" }), deckAgent({ paneId: "w9:p5", sessionId: "s-new" })], 28, 28);
  assert.equal(indexOf(after, "w9:p4"), 5);
  assert.equal(indexOf(after, "w9:p5"), 0);
  assert.equal(indexOf(after, "w3:p1"), undefined);
});

test("a remembered animal that no longer exists is dropped", () => {
  const m = assignMascots({ "wA:p1": { index: 27, sessionId: "s" } }, agents("wA:p1"), 28, 8);
  assert.equal(indexOf(m, "wA:p1"), 0);
});

test("memory survives a save and a load, and a broken file reads as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "hd-"));
  const path = join(dir, "nested", "state.json");
  const memory: MascotMemory = { "wA:p1": { index: 3, sessionId: "s1" }, "wB:p1": { index: 0, sessionId: "" } };
  saveMemory(path, memory);
  assert.ok(sameMemory(loadMemory(path), memory));
  writeFileSync(path, "{ not json");
  assert.deepEqual(loadMemory(path), {});
  assert.deepEqual(loadMemory(join(dir, "missing.json")), {});
  writeFileSync(path, JSON.stringify({ version: 1, mascots: { a: { index: 1, sessionId: "x" }, b: { index: 1, sessionId: "y" }, c: { index: -2, sessionId: "z" }, d: "junk" } }));
  assert.deepEqual(loadMemory(path), { a: { index: 1, sessionId: "x" } }, "a repeated animal, a negative index and junk are dropped");
});
