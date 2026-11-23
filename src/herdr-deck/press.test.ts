import assert from "node:assert/strict";
import { test } from "node:test";
import { keyIndex, PaintedKey, PRESS_GRACE_MS, type Target } from "./press.js";

const target = (paneId: string): Target => ({ paneId, terminalId: `t-${paneId}`, sessionId: `s-${paneId}` });
const sent = async () => {};
const a = target("a"), b = target("b");

test("the dispatch clock starts the grace window, including when a send is slow", async () => {
  let now = 100;
  const key = new PaintedKey(() => now);
  await key.paint(1, "A", a, sent);
  assert.equal(key.pressed(), a);
  let finish!: () => void;
  const pending = key.paint(1, "B", b, () => new Promise<void>(resolve => { finish = resolve; }));
  now += 1500;
  assert.equal(key.pressed(), a);
  finish();
  await pending;
  now += PRESS_GRACE_MS - 1;
  await key.paint(1, "B2", b, sent);
  assert.equal(key.pressed(), a);
  now++;
  assert.equal(key.pressed(), b);
});

test("new, empty and newly occupied keys follow the image sent to that action", async () => {
  const key = new PaintedKey(() => 5);
  assert.equal(key.pressed(), undefined);
  await key.paint(1, "empty", undefined, sent);
  await key.paint(1, "A", a, sent);
  assert.equal(key.pressed(), a);
  await key.paint(1, "empty", undefined, sent);
  assert.equal(key.pressed(), undefined);
});

test("a failed redraw keeps the last sent agent and the next frame retries", async () => {
  let now = 0;
  const key = new PaintedKey(() => now);
  await key.paint(1, "A", a, sent);
  await assert.rejects(key.paint(1, "B", b, async () => { throw new Error("offline"); }));
  now += 2000;
  assert.equal(key.pressed(), a);
  await key.paint(1, "B", b, sent);
  now += PRESS_GRACE_MS;
  assert.equal(key.pressed(), b);
});

test("page changes have no grace and a late send cannot rebind the old page", async () => {
  const key = new PaintedKey(() => 0);
  await key.paint(1, "A", a, sent);
  let finish!: () => void;
  const stale = key.paint(1, "A2", a, () => new Promise<void>(resolve => { finish = resolve; }));
  await key.paint(2, "B", b, sent);
  assert.equal(key.pressed(), undefined);
  finish();
  await stale;
  assert.equal(key.pressed(), undefined);
  await key.paint(2, "B", b, sent);
  assert.equal(key.pressed(), b);
  await key.paint(1, "A", a, sent); // includes an automatic fall-back to page one
  assert.equal(key.pressed(), a);
  key.reset();
  assert.equal(key.pressed(), undefined);
});

test("two keys can display the same pixels and keep independent identities", async () => {
  const first = new PaintedKey(() => 0);
  const second = new PaintedKey(() => 0);
  await first.paint(1, "same", a, sent);
  await second.paint(1, "same", b, sent);
  assert.equal(first.pressed(), a);
  assert.equal(second.pressed(), b);
});

test("arriving out of order never renumbers another key; the pager and a coordinate-less action are excluded", () => {
  assert.deepEqual([{ row: 2, column: 3 }, { row: 0, column: 0 }, { row: 1, column: 2 },
                    { row: 2, column: 4 }, undefined].map(keyIndex), [13, 0, 7, undefined, undefined]);
});
