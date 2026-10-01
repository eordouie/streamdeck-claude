import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyRecords,
  isStoppedStat,
  parsePsStates,
  pruneCandidates,
  type LivenessRecord,
  type ProcessStates,
} from "./record-liveness.js";

const rec = (pid: number | undefined, sessionId: string, extra: Partial<LivenessRecord> = {}): LivenessRecord => ({
  provider: "claude",
  sessionId,
  pid,
  origin: "wsl",
  kind: "interactive",
  ...extra,
});

const states = (wsl: Record<number, string>, windows: Record<number, string> = {}) => ({
  wsl: new Map(Object.entries(wsl).map(([p, s]) => [Number(p), s])) as ProcessStates,
  windows: new Map(Object.entries(windows).map(([p, s]) => [Number(p), s])) as ProcessStates,
});

test("parses ps -o pid=,stat= output, including padded columns", () => {
  const parsed = parsePsStates("67318 S+  \n69552 T   \n  412 Ss\n\ngarbage\n");
  assert.deepEqual([...parsed], [
    [67318, "S+"],
    [69552, "T"],
    [412, "Ss"],
  ]);
});

test("stopped means job-control or tracing stop, nothing else", () => {
  assert.equal(isStoppedStat("T"), true);
  assert.equal(isStoppedStat("T+"), true);
  assert.equal(isStoppedStat("t"), true);
  assert.equal(isStoppedStat("S+"), false);
  assert.equal(isStoppedStat("R"), false);
  assert.equal(isStoppedStat(""), false, "tasklist cannot say — never guess stopped");
});

test("a suspended twin of a live conversation is alive but suspended", () => {
  // The 2026-10-01 tab: 69552 stopped since Sep 28, 67318 resumed the same sid.
  const stopped = rec(69552, "f5e102c4");
  const running = rec(67318, "f5e102c4");
  const r = classifyRecords([stopped, running], states({ 69552: "T", 67318: "S+" }));

  assert.deepEqual([...r.live], ["f5e102c4"]);
  assert.equal(r.liveRecords.has(stopped), true, "its file must survive — fg resumes it");
  assert.equal(r.liveRecords.has(running), true);
  assert.equal(r.suspended.has(stopped), true, "no key, no tab stamp");
  assert.equal(r.suspended.has(running), false);
});

test("a dead record does not ride on a live record of the same conversation", () => {
  // Crash or closed tab, then `claude -c`: the dead pid's json is still on disk.
  const dead = rec(111, "sid-a");
  const resumed = rec(222, "sid-a");
  const r = classifyRecords([dead, resumed], states({ 222: "S+" }));

  assert.equal(r.live.has("sid-a"), true);
  assert.equal(r.liveRecords.has(dead), false, "liveness used to be per session id — this record showed as a key");
  assert.equal(r.liveRecords.has(resumed), true);
});

test("pids are looked up in their own origin's process table", () => {
  const wslRecord = rec(500, "sid-w");
  const winRecord = rec(500, "sid-n", { origin: "windows" });
  const r = classifyRecords([wslRecord, winRecord], states({}, { 500: "" }));
  assert.equal(r.liveRecords.has(wslRecord), false);
  assert.equal(r.liveRecords.has(winRecord), true);
});

test("a bg job reporting itself done is not live even while its pid exits", () => {
  const done = rec(700, "job-1", { kind: "bg", bgStatus: "Completed" });
  const working = rec(701, "job-2", { kind: "bg", bgStatus: "running" });
  const r = classifyRecords([done, working], states({ 700: "S", 701: "S" }));
  assert.equal(r.liveRecords.has(done), false);
  assert.equal(r.liveRecords.has(working), true);
});

test("a record with no pid is live only on a positive active flag", () => {
  const flagged = rec(undefined, "codex-1", { provider: "codex", active: true });
  const silent = rec(undefined, "claude-x");
  const cleared = rec(undefined, "codex-2", { provider: "codex", active: false });
  const r = classifyRecords([flagged, silent, cleared], states({}));
  assert.deepEqual([...r.live], ["codex-1"]);
});

test("pruning deletes a dead twin but keeps the conversation's events log", () => {
  const dead = rec(111, "sid-a");
  const resumed = rec(222, "sid-a");
  const lonelyDead = rec(333, "sid-b");
  const all = [dead, resumed, lonelyDead];
  const { liveRecords } = classifyRecords(all, states({ 222: "S+" }));

  assert.deepEqual(pruneCandidates(all, liveRecords), [
    { record: dead, dropEventsLog: false },
    { record: lonelyDead, dropEventsLog: true },
  ]);
});

test("a suspended record is never a prune candidate", () => {
  const stopped = rec(69552, "f5e102c4");
  const { liveRecords } = classifyRecords([stopped], states({ 69552: "T" }));
  assert.deepEqual(pruneCandidates([stopped], liveRecords), []);
});

test("an events log is shared only within one provider and origin", () => {
  const deadWsl = rec(1, "same-id");
  const liveWin = rec(2, "same-id", { origin: "windows" });
  const { liveRecords } = classifyRecords([deadWsl, liveWin], states({}, { 2: "" }));
  assert.deepEqual(pruneCandidates([deadWsl, liveWin], liveRecords), [{ record: deadWsl, dropEventsLog: true }]);
});
