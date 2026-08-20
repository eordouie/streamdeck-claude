import assert from "node:assert/strict";
import { test } from "node:test";
import { KillSuppression, KILL_SUPPRESS_MS } from "./kill-suppression.js";

test("a killed session leaves the deck at once and gets no finished flash", () => {
  const killed = new KillSuppression();
  killed.mark({ sessionId: "sid-a", pid: 111 }, 1000);

  assert.equal(killed.suppresses({ sessionId: "sid-a", pid: 111 }, 1000), true);
  assert.equal(killed.suppresses({ sessionId: "sid-a", pid: 111 }, 1500), true, "still shutting down — stay hidden");
  // The death is the user's: no `finished` tile for it.
  assert.equal(killed.claimDeath("sid-a"), true);
  // Consumed, so a later unrelated death of the same id is not swallowed.
  assert.equal(killed.claimDeath("sid-a"), false);
});

test("the same pid under a new session id stays suppressed", () => {
  const killed = new KillSuppression();
  killed.mark({ sessionId: "sid-b", pid: 222 }, 1000);

  // A dying agent can lose its session file before its process exits; the
  // process scan then offers it back as a provisional session with a synthetic
  // id. Matching on pid is what stops the killed tile reappearing.
  assert.equal(killed.suppresses({ sessionId: "pending:claude:222", pid: 222 }, 1200), true);
  // An unrelated session must not be caught by it.
  assert.equal(killed.suppresses({ sessionId: "sid-other", pid: 999 }, 1200), false);
  assert.equal(killed.suppresses({ sessionId: "sid-other" }, 1200), false);
});

test("a session that survives both signals comes back rather than lying", () => {
  const killed = new KillSuppression();
  killed.mark({ sessionId: "sid-c", pid: 333 }, 1000);

  assert.equal(killed.suppresses({ sessionId: "sid-c", pid: 333 }, 1000 + KILL_SUPPRESS_MS - 1), true);
  assert.equal(
    killed.suppresses({ sessionId: "sid-c", pid: 333 }, 1000 + KILL_SUPPRESS_MS + 1),
    false,
    "hiding a live session forever would cost a slot and tell the user nothing",
  );
});

test("sessions nobody killed are untouched", () => {
  const killed = new KillSuppression();
  assert.equal(killed.suppresses({ sessionId: "sid-d", pid: 444 }), false);
  assert.equal(killed.claimDeath("sid-d"), false);
});

test("records of kills that never landed do not leak", () => {
  const killed = new KillSuppression();
  killed.mark({ sessionId: "sid-e", pid: 555 }, 1000);
  killed.prune(2000);
  assert.equal(killed.claimDeath("sid-e"), true, "too fresh to prune");

  killed.mark({ sessionId: "sid-f", pid: 666 }, 1000);
  killed.prune(1000 + 60_001);
  assert.equal(killed.claimDeath("sid-f"), false);
});
