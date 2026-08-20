import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptParkedState, resolveBgOwners, resolveParkedJobs, type OwnableSession } from "./bg-owner.js";

const bg = (sessionId: string, jobId?: string): OwnableSession => ({ sessionId, kind: "bg", jobId });
const interactive = (sessionId: string, parkedJobId?: string): OwnableSession =>
  ({ sessionId, kind: "interactive", parkedJobId });

test("links a bg job to the session that parked it", () => {
  const owners = resolveBgOwners([interactive("lever", "13fb99e8"), bg("job", "13fb99e8")]);
  assert.equal(owners.get("job"), "lever");
});

test("a job whose owner is gone has no owner", () => {
  const owners = resolveBgOwners([bg("job", "13fb99e8"), interactive("other", "unrelated")]);
  assert.equal(owners.has("job"), false);
});

test("a contested job has no owner", () => {
  const owners = resolveBgOwners([
    interactive("a", "13fb99e8"),
    interactive("b", "13fb99e8"),
    bg("job", "13fb99e8"),
  ]);
  assert.equal(owners.has("job"), false);
});

test("jobless bg sessions and parkless interactive sessions are ignored", () => {
  const owners = resolveBgOwners([bg("job"), interactive("plain")]);
  assert.equal(owners.size, 0);
});

test("each job resolves independently", () => {
  const owners = resolveBgOwners([
    interactive("lever", "job-1"),
    interactive("volume", "job-2"),
    bg("bg-1", "job-1"),
    bg("bg-2", "job-2"),
  ]);
  assert.deepEqual([...owners], [["bg-1", "lever"], ["bg-2", "volume"]]);
});

test("a bg session never owns another bg session", () => {
  // A bg job's json carries jobId, never parkedJobId — but guard the shape
  // anyway: a chain of bg jobs must not resolve to an unreachable owner.
  const owners = resolveBgOwners([
    { sessionId: "outer", kind: "bg", jobId: "job-1", parkedJobId: "job-2" },
    bg("inner", "job-2"),
  ]);
  assert.equal(owners.has("inner"), false);
});

// ---------------------------------------------------------------------------
// resolveParkedJobs — the inverse link, for STATE rather than routing.
//
// Regression suite for 2026-08-19: session "lever" showed a blue idle mascot
// while its parked job sat `waiting: "input needed"`. The tile that pulsed was
// the bg job (unreachable); the tile the user had to press showed nothing to do.
// ---------------------------------------------------------------------------

test("resolveParkedJobs maps an owner to the bg job it parked", () => {
  // The exact live shape off the deck: lever parked 13fb99e8, and the bg record
  // carries that as its jobId while having its own (different) sessionId.
  const parked = resolveParkedJobs([
    interactive("lever-sid", "13fb99e8"),
    bg("13fb99e8-c3cf-41a0-ba23-e6a60ec9377f", "13fb99e8"),
  ]);
  assert.equal(parked.get("lever-sid"), "13fb99e8-c3cf-41a0-ba23-e6a60ec9377f");
});

test("resolveParkedJobs is empty when there is nothing parked", () => {
  assert.equal(resolveParkedJobs([interactive("a"), bg("j", "job-1")]).size, 0);
});

test("resolveParkedJobs drops a job with no matching bg session", () => {
  // The job was killed but the owner still names it. Adopting a state from a
  // session that does not exist is exactly the phantom-tile bug class.
  assert.equal(resolveParkedJobs([interactive("lever", "gone")]).size, 0);
});

test("resolveParkedJobs drops contested links in both directions", () => {
  // Two owners claiming one job: neither may adopt it, or a stranger's activity
  // lands on your tile.
  const twoOwners = resolveParkedJobs([interactive("a", "j"), interactive("b", "j"), bg("bgsid", "j")]);
  assert.equal(twoOwners.size, 0);
  // Two bg sessions claiming one jobId: same reasoning, mirrored.
  const twoJobs = resolveParkedJobs([interactive("a", "j"), bg("bg1", "j"), bg("bg2", "j")]);
  assert.equal(twoJobs.size, 0);
});

test("resolveParkedJobs and resolveBgOwners are consistent inverses", () => {
  const sessions = [interactive("lever", "13fb99e8"), bg("jobsid", "13fb99e8")];
  const parked = resolveParkedJobs(sessions);
  const owners = resolveBgOwners(sessions);
  assert.equal(parked.get("lever"), "jobsid");
  assert.equal(owners.get("jobsid"), "lever");
});

test("adoptParkedState gives the owner tile its delegate's activity", () => {
  // The whole point: a working parked job must make the REACHABLE tile walk
  // (yellow), not sit blue while an unreachable bg tile spins.
  assert.equal(adoptParkedState("bg_working"), "working");
  assert.equal(adoptParkedState("bg_awaiting"), "awaiting");
  assert.equal(adoptParkedState("bg_awaiting_permission"), "awaiting_permission");
});

test("adoptParkedState never hands an interactive tile a bg_ state", () => {
  // A bg_ state would stamp the "bg" badge on a real terminal tab, claiming the
  // tab IS the background job rather than the place you answer it.
  for (const parked of ["bg_working", "bg_awaiting", "bg_awaiting_permission", "bg_idle"] as const) {
    assert.equal(adoptParkedState(parked).startsWith("bg_"), false, parked);
  }
});

test("adoptParkedState treats an idle parked job as nothing to say", () => {
  // Otherwise every parked session outshouts an unparked one forever.
  assert.equal(adoptParkedState("bg_idle"), "idle");
  assert.equal(adoptParkedState("finished"), "idle");
  assert.equal(adoptParkedState("idle"), "idle");
});
