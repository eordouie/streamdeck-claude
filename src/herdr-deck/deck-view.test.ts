import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDeck, FLASH_MS, type AgentKeyView } from "./deck-view.js";
import { deckAgent } from "./fixtures.js";
import type { DeckAgent } from "./model.js";

const many = (n: number, over: Partial<DeckAgent> = {}): DeckAgent[] =>
  Array.from({ length: n }, (_, i) => deckAgent({ paneId: `w${i + 1}:p1`, workspace: `proj${i + 1}`, ...over }));

const compose = (ranked: DeckAgent[], page = 1, extra: Partial<Parameters<typeof composeDeck>[0]> = {}) =>
  composeDeck({ ranked, page, perPage: 14,
    mascots: Object.fromEntries(ranked.slice(0, 28).map((a, index) => [a.paneId, { index, sessionId: a.sessionId }])), words: new Map(), doneSince: new Map(), now: 100_000, offline: false, ...extra });

const agentKeys = (keys: ReturnType<typeof compose>["keys"]): AgentKeyView[] => keys.filter((k): k is AgentKeyView => k.kind === "agent");

test("three agents fill three keys and leave eleven empty", () => {
  const v = compose(many(3));
  assert.equal(v.keys.length, 14);
  assert.deepEqual(agentKeys(v.keys).map((k) => k.paneId), ["w1:p1", "w2:p1", "w3:p1"]);
  assert.deepEqual(v.pager, { page: 1, pages: 1, more: 0, alert: false, offline: false });
});

test("nineteen agents: fourteen on page 1, five on page 2", () => {
  const ranked = many(19);
  const p1 = compose(ranked, 1);
  assert.equal(agentKeys(p1.keys).length, 14);
  assert.deepEqual(p1.pager, { page: 1, pages: 2, more: 5, alert: false, offline: false });
  const p2 = compose(ranked, 2);
  assert.deepEqual(agentKeys(p2.keys).map((k) => k.paneId), ["w15:p1", "w16:p1", "w17:p1", "w18:p1", "w19:p1"]);
  assert.equal(p2.keys.length, 14);
  assert.deepEqual(p2.pager, { page: 2, pages: 2, more: 0, alert: false, offline: false });
});

test("beyond 28 agents the second page says how many have no key", () => {
  assert.equal(compose(many(40), 1).pager.more, 26);
  assert.equal(compose(many(40), 2).pager.more, 12);
});

test("page 2 falls back to page 1 when the agents fit on one page", () => {
  assert.equal(compose(many(14), 2).pager.page, 1);
  assert.equal(compose(many(3), 7).pager.page, 1);
  assert.equal(compose(many(19), 0).pager.page, 1);
});

test("each status maps to the old deck's look, the same for every kind of agent", () => {
  for (const kind of ["claude", "codex"]) {
    const ranked = [
      deckAgent({ paneId: "wA:p1", status: "blocked", kind }),
      deckAgent({ paneId: "wB:p1", status: "working", kind }),
      deckAgent({ paneId: "wC:p1", status: "done", kind }),
      deckAgent({ paneId: "wD:p1", status: "idle", kind }),
      deckAgent({ paneId: "wE:p1", status: "unknown", kind }),
    ];
    const keys = agentKeys(compose(ranked).keys);
    assert.deepEqual(keys.map((k) => [k.state, k.attention, k.awaitingReply]), [
      ["blocked", false, false],
      ["working", false, false],
      ["idle", false, true],
      ["idle", false, false],
      ["idle", false, false],
    ], kind);
  }
});

test("a finished agent flashes for FLASH_MS after the deck saw it finish, then keeps the dot", () => {
  const ranked = [deckAgent({ paneId: "wA:p1", status: "done" })];
  const at = (now: number) => agentKeys(compose(ranked, 1, { doneSince: new Map([["wA:p1", 100_000]]), now }).keys)[0];
  assert.deepEqual([at(100_000).attention, at(100_000).awaitingReply], [true, true]);
  assert.equal(at(100_000 + FLASH_MS - 1).attention, true);
  assert.deepEqual([at(100_000 + FLASH_MS).attention, at(100_000 + FLASH_MS).awaitingReply], [false, true]);
});

test("the arrow key warns when an agent that needs him is on the other page", () => {
  const ranked = [deckAgent({ paneId: "wB:p1", status: "blocked" }), ...many(18)];
  assert.equal(compose(ranked, 1).pager.alert, false);
  assert.equal(compose(ranked, 2).pager.alert, true);
});

test("a key carries its agent's animal and words", () => {
  const ranked = [deckAgent({ paneId: "wA:p1", workspace: "hive-2.0" }), deckAgent({ paneId: "wB:p1", workspace: "git" })];
  const keys = agentKeys(compose(ranked, 1, { mascots: { "wA:p1": { index: 12, sessionId: "" } }, words: new Map([["wA:p1", "codex"]]) }).keys);
  assert.equal(keys[0].slot, 13);
  assert.deepEqual(keys[0].lines, { top: "hive-2.0", line1: "codex", line2: "" });
  assert.equal(keys.length, 1, "an unassigned animal cannot duplicate one already on a key");
});

test("no agent keys on the deck means nothing to draw", () => {
  const v = composeDeck({ ranked: many(5), page: 1, perPage: 0, mascots: {}, words: new Map(), doneSince: new Map(), now: 0, offline: false });
  assert.deepEqual(v.keys, []);
  assert.equal(v.pager.pages, 1);
});

test("offline is passed through to the arrow key", () => {
  assert.equal(compose([], 1, { offline: true }).pager.offline, true);
});
