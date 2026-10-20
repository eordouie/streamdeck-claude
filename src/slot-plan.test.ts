import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTabs, pidFromStampedTitle, planSlots, type TabEntry } from "./slot-plan.js";

const tab = (index: number, terminal: string, extra: Partial<TabEntry> = {}): TabEntry => ({
  windowId: "w1",
  tabId: `t${index}`,
  index,
  front: true,
  selected: false,
  tab: terminal,
  terminal,
  ...extra,
});

const entry = (pid: number | undefined, startedAt: number, kind = "interactive") => ({
  session: { pid, kind, startedAt },
  name: `s${pid ?? "none"}`,
});

test("pidFromStampedTitle reads the plugin's own stamp and nothing else", () => {
  assert.equal(pidFromStampedTitle("claude-61166-labeling"), 61166);
  assert.equal(pidFromStampedTitle("claude-57229"), 57229);
  assert.equal(pidFromStampedTitle("codex-4021-review"), 4021);
  assert.equal(pidFromStampedTitle("claude-33832-Humain"), 33832);
  assert.equal(pidFromStampedTitle("zsh"), undefined);
  assert.equal(pidFromStampedTitle("~/Projects"), undefined);
  assert.equal(pidFromStampedTitle("claude-abc"), undefined);
  assert.equal(pidFromStampedTitle("build-2026-report"), 2026); // shape only: callers match against live pids
});

test("keys mirror the tab strip, whatever the start order", () => {
  // Live 2026-10-20: launch order was 2004, 2554, 4604, 57229, 73362, 55486, 61166.
  const tabs = [
    tab(1, "claude-57229"),
    tab(2, "claude-55486"),
    tab(3, "claude-61166-labeling"),
    tab(4, "claude-73362"),
    tab(5, "claude-4604-sogstep"),
    tab(6, "claude-2554-keyboard"),
    tab(7, "claude-2004-benefits"),
  ];
  const entries = [2004, 2554, 4604, 57229, 73362, 55486, 61166].map((pid, i) => entry(pid, i));
  const plan = planSlots(entries, tabs, 8);
  assert.deepEqual(
    plan.assigned.map((e) => e?.session.pid),
    [57229, 55486, 61166, 73362, 4604, 2554, 2004, undefined],
  );
  assert.equal(plan.hidden, 0);
  assert.equal(plan.tabs[6]?.tabId, "t7");
  assert.equal(plan.tabs[7], undefined);
});

test("a tab without an agent leaves its key empty but mapped; tab-less sessions go after the strip", () => {
  const tabs = [tab(1, "claude-10-alpha"), tab(2, "zsh"), tab(3, "claude-30-gamma")];
  const bg = entry(99, 0, "bg");
  const other = entry(40, 1); // a session in some other terminal
  const plan = planSlots([bg, other, entry(30, 2), entry(10, 3)], tabs, 5);
  assert.deepEqual(plan.assigned.map((e) => e?.session.pid), [10, undefined, 30, 99, 40]);
  assert.equal(plan.tabs[1]?.terminal, "zsh");
  assert.equal(plan.hidden, 0);
});

test("sessions beyond the deck are hidden, inside the strip and after it", () => {
  const tabs = [1, 2, 3, 4].map((i) => tab(i, `claude-${i}`));
  const entries = [1, 2, 3, 4].map((pid) => entry(pid, pid)).concat([entry(50, 9), entry(60, 10)]);
  const plan = planSlots(entries, tabs, 3);
  assert.deepEqual(plan.assigned.map((e) => e?.session.pid), [1, 2, 3]);
  assert.equal(plan.hidden, 3);
});

test("a hand-renamed tab still maps through its terminal's stamp", () => {
  const tabs = [tab(1, "claude-33832-nebula", { tab: "Humain layout" })];
  const plan = planSlots([entry(33832, 0)], tabs, 2);
  assert.equal(plan.assigned[0]?.session.pid, 33832);
});

test("two live records on one tab keep the first; the other goes after the strip", () => {
  const tabs = [tab(1, "claude-7-word")];
  const plan = planSlots([entry(7, 0), { session: { pid: 7, kind: "interactive", startedAt: 1 }, name: "twin" }], tabs, 3);
  assert.equal(plan.assigned[0]?.name, "s7");
  assert.equal(plan.assigned[1]?.name, "twin");
});

test("no tabs at all: start order from key 1", () => {
  const plan = planSlots([entry(3, 0), entry(1, 1)], [], 3);
  assert.deepEqual(plan.assigned.map((e) => e?.session.pid), [3, 1, undefined]);
});

test("orderTabs puts the front window first and sorts each window by index", () => {
  const ordered = orderTabs([
    tab(2, "b", { windowId: "back", front: false }),
    tab(1, "a", { windowId: "back", front: false }),
    tab(2, "y", { windowId: "front", front: true }),
    tab(1, "x", { windowId: "front", front: true }),
  ]);
  assert.deepEqual(ordered.map((t) => t.terminal), ["x", "y", "a", "b"]);
});
