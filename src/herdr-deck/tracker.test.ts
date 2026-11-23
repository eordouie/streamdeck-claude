import assert from "node:assert/strict";
import { test } from "node:test";
import { FLASH_MS, type AgentKeyView, type DeckView } from "./deck-view.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import type { RawAgent, RawSnapshot } from "./herdr-client.js";
import type { MascotMemory } from "./mascot-pool.js";
import { HOLD_MS } from "./settle.js";
import { createDeckTracker, OFFLINE_GRACE_MS } from "./tracker.js";

/** A tracker fed by a script: `set` what herdr holds (or an error), move the clock, poll. */
function harness(memory: MascotMemory = {}) {
  let current: RawSnapshot | Error = rawSnapshot([]);
  let clock = 1_000_000;
  const saves: MascotMemory[] = [];
  const logs: string[] = [];
  const tracker = createDeckTracker({
    read: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
    now: () => clock,
    poolSize: 28,
    memory,
    saveMemory: (m) => saves.push(m),
    log: (line) => logs.push(line),
  });
  return {
    tracker,
    saves,
    logs,
    set: (agents: RawAgent[] | Error) => {
      current = agents instanceof Error ? agents : rawSnapshot(agents);
    },
    advance: (ms: number) => {
      clock += ms;
    },
    poll: () => tracker.poll(14),
  };
}

const key = (v: DeckView, i: number): AgentKeyView => {
  const k = v.keys[i];
  assert.equal(k.kind, "agent", `key ${i} holds an agent`);
  return k as AgentKeyView;
};
const panes = (v: DeckView): string[] => v.keys.filter((k): k is AgentKeyView => k.kind === "agent").map((k) => k.paneId);

test("agents appear ranked, the working one first", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "idle", state_change_seq: 5 }), rawAgent({ pane_id: "wB:p1", agent_status: "working", state_change_seq: 3 })]);
  assert.deepEqual(panes(await h.poll()), ["wB:p1", "wA:p1"]);
});

test("a 2 s finished blip moves no key and changes no key's look", async () => {
  const h = harness();
  const other = rawAgent({ pane_id: "wB:p1", agent_status: "working", state_change_seq: 160 });
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 170 }), other]);
  const before = await h.poll();
  h.advance(1000);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 177 }), other]);
  const during = await h.poll();
  h.advance(2000);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 178 }), other]);
  const after = await h.poll();
  for (const v of [during, after]) {
    assert.deepEqual(panes(v), panes(before));
    assert.equal(key(v, 0).state, "working");
    assert.equal(key(v, 0).attention, false);
  }
});

test("an unseen excursion cannot promote rank 29 across the page cutoffs, even after the hold expires", async () => {
  const h = harness();
  const agents = Array.from({ length: 29 }, (_, i) => rawAgent({
    pane_id: `w${i + 1}:p1`, agent_status: "working", state_change_seq: 29 - i,
  }));
  h.set(agents);
  const first = panes(await h.poll());
  const second = panes(h.tracker.flipPage(14));
  assert.deepEqual([first[0], second[13]], ["w1:p1", "w28:p1"]);

  const last = agents[28];
  h.set([...agents.slice(0, 28), { ...last, state_change_seq: 100 }]);
  h.advance(500);
  assert.deepEqual(panes(await h.poll()), second);
  h.advance(HOLD_MS + 500);
  assert.deepEqual(panes(await h.poll()), second);
  assert.deepEqual(panes(h.tracker.flipPage(14)), first);

  h.set([...agents.slice(0, 28), { ...last, agent_status: "blocked", state_change_seq: 101 }]);
  assert.equal(key(await h.poll(), 0).paneId, last.pane_id);
});

test("a finished agent flashes from the moment the deck believes it, then keeps the dot until seen", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 10 })]);
  await h.poll();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 20 })]);
  await h.poll();
  h.advance(HOLD_MS);
  const believed = await h.poll();
  assert.deepEqual([key(believed, 0).state, key(believed, 0).attention, key(believed, 0).awaitingReply], ["idle", true, true]);
  h.advance(FLASH_MS);
  const settled = await h.poll();
  assert.deepEqual([key(settled, 0).attention, key(settled, 0).awaitingReply], [false, true]);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "idle", state_change_seq: 20 })]);
  const seen = await h.poll();
  assert.deepEqual([key(seen, 0).attention, key(seen, 0).awaitingReply], [false, false]);
});

test("an agent already finished when the deck starts shows the dot without a flash", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 20 })]);
  const v = await h.poll();
  assert.deepEqual([key(v, 0).attention, key(v, 0).awaitingReply], [false, true]);
});

test("an agent keeps its animal when it moves to another key", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "idle", state_change_seq: 5 })]);
  const first = await h.poll();
  const animalOfB = key(first, 1).slot;
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "blocked", state_change_seq: 12 })]);
  const second = await h.poll();
  assert.equal(key(second, 0).paneId, "wB:p1");
  assert.equal(key(second, 0).slot, animalOfB);
});

test("the animal memory is saved when it changes and not otherwise", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  await h.poll();
  assert.equal(h.saves.length, 1);
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  await h.poll();
  assert.equal(h.saves.length, 2);
});

test("a remembered animal is used again after a restart", async () => {
  const h = harness({ "wA:p1": { index: 20, sessionId: "session-wA:p1" } });
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  assert.equal(key(await h.poll(), 0).slot, 21);
});

test("the arrow key flips to page 2 and a press there means the agent on that page", async () => {
  const h = harness();
  h.set(Array.from({ length: 19 }, (_, i) => rawAgent({ pane_id: `w${i + 1}:p1`, state_change_seq: 100 - i })));
  assert.equal(key(await h.poll(), 0).paneId, "w1:p1");
  const p2 = h.tracker.flipPage(14);
  assert.equal(p2.pager.page, 2);
  assert.equal(key(p2, 0).paneId, "w15:p1");
  assert.equal(p2.keys[5].kind, "empty");
  assert.equal(h.tracker.flipPage(14).pager.page, 1);
});

test("with one page the arrow key does nothing", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  assert.equal(h.tracker.flipPage(14).pager.page, 1);
});

test("the next observation after a replacement does not inherit the old occupant's flash", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "blocked" })]);
  await h.poll();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 2 })]);
  assert.ok(key(await h.poll(), 0).attention);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 3, agent_session: { value: "new" } })]);
  assert.equal(key(await h.poll(), 0).attention, false);
});

test("one failed read keeps the deck as it was; a herdr that stays away blanks it and says so", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  h.set(new Error("timeout"));
  h.advance(500);
  assert.deepEqual(panes(await h.poll()), ["wA:p1"]);
  h.advance(OFFLINE_GRACE_MS);
  const gone = await h.poll();
  assert.deepEqual(panes(gone), []);
  assert.equal(gone.pager.offline, true);
  assert.equal(h.logs.filter((l) => l.startsWith("herdr unreachable")).length, 1);
  await h.poll();
  assert.equal(h.logs.filter((l) => l.startsWith("herdr unreachable")).length, 1, "said once, not every tick");
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  const back = await h.poll();
  assert.deepEqual(panes(back), ["wA:p1"]);
  assert.equal(back.pager.offline, false);
  assert.ok(h.logs.includes("herdr reachable"));
});

test("a herdr that is not running when the deck starts is offline at once", async () => {
  const h = harness();
  h.set(new Error("ENOENT"));
  assert.equal((await h.poll()).pager.offline, true);
});

test("the animal memory is not wiped while herdr is away", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  const before = key(await h.poll(), 1).slot;
  h.set(new Error("ECONNREFUSED"));
  h.advance(OFFLINE_GRACE_MS + 1);
  await h.poll();
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  assert.equal(key(await h.poll(), 1).slot, before);
  assert.equal(h.saves.length, 1);
});
