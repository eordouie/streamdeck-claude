import assert from "node:assert/strict";
import { test } from "node:test";
import { slotCharacterIdle } from "../icons/motifs.js";
import type { AgentKeyView, PagerView } from "./deck-view.js";
import { agentKeySvg, emptyKeySvg, keySvg, pagerKeySvg, toDataUrl } from "./key-svg.js";

const view = (over: Partial<AgentKeyView> = {}): AgentKeyView => ({
  kind: "agent", paneId: "wA:p1", terminalId: "term", sessionId: "s", state: "idle", slot: 1, lines: { top: "hive-2.0", line1: "codex", line2: "" }, attention: false, awaitingReply: false, ...over,
});
const pager = (over: Partial<PagerView> = {}): PagerView => ({ page: 1, pages: 2, more: 5, alert: false, offline: false, ...over });
const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test("an agent key carries its whole project name and its second word", () => {
  assert.deepEqual(texts(agentKeySvg(view(), 0, 0)), ["hive-2.0", "codex"]);
});

test("a Claude key and a Codex key with the same view are the same picture", t => {
  t.mock.method(Date, "now", () => 5000); // the shared sprite blinks on wall-clock time
  // Provider identity is absent from the drawing inputs.
  assert.equal(agentKeySvg(view({ paneId: "wA:p1" }), 3, 5000), agentKeySvg(view({ paneId: "wB:p9" }), 3, 5000));
});

test("different animals draw different pictures", () => {
  assert.notEqual(agentKeySvg(view({ slot: 1 }), 0, 0), agentKeySvg(view({ slot: 2 }), 0, 0));
});

test("an empty key has a frame and nothing to read", () => {
  assert.deepEqual(texts(emptyKeySvg()), []);
  assert.equal(keySvg({ kind: "empty" }, 0, 0), emptyKeySvg());
});

test("the arrow key says what is on the other page", () => {
  assert.deepEqual(texts(pagerKeySvg(pager(), 0)), ["+5", "1/2"]);
  assert.deepEqual(texts(pagerKeySvg(pager({ page: 2, more: 0 }), 0)), ["back", "2/2"]);
  assert.deepEqual(texts(pagerKeySvg(pager({ page: 2, more: 12 }), 0)), ["+12", "2/2"]);
  assert.deepEqual(texts(pagerKeySvg(pager({ pages: 1, more: 0 }), 0)), []);
  assert.deepEqual(texts(pagerKeySvg(pager({ offline: true }), 0)), ["herdr", "off"]);
});

test("the arrow key pulses when an agent on the other page needs him", () => {
  assert.notEqual(pagerKeySvg(pager({ page: 2, alert: true }), 2), pagerKeySvg(pager({ page: 2, alert: true }), 5));
  assert.equal(pagerKeySvg(pager({ page: 2 }), 2), pagerKeySvg(pager({ page: 2 }), 5));
});

test("a picture travels to the deck as a base64 data URL", () => {
  const url = toDataUrl("<svg/>");
  assert.equal(url, "data:image/svg+xml;base64,PHN2Zy8+");
});

test("a blocked key pulses orange around its own animal", t => {
  t.mock.method(Date, "now", () => 1100);
  const blocked = (slot: number) => agentKeySvg(view({ state: "blocked", slot }), 3, 0);
  assert.match(blocked(1), /fill="#f97316" opacity="0.750"/);
  for (const slot of [1, 2, 28]) assert.ok(blocked(slot).includes(slotCharacterIdle(3, "#f97316", slot)));
});
