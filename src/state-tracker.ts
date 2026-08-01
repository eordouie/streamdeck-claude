import streamDeck from "@elgato/streamdeck";
import { iconNeedsAnimation, type SessionState } from "./icons/index.js";
import {
  deriveState,
  pruneDeadSessions,
  readAllSessions,
  SESSION_SOURCES,
  lastReadError,
  type SessionInfo,
} from "./sessions.js";
import { filterLiveSessions } from "./live-pids.js";

const FINISHED_TTL_MS = 3_000;

/** States where the agent is actively working — leaving one of these for an
 *  ATTENTION state is the "it needs you now" transition. */
const BUSY_STATES: ReadonlySet<SessionState> = new Set(["working", "subagent", "bg_working"]);
/** States that deserve the unacknowledged-attention flash when entered from a
 *  busy state: done responding, waiting on input/permission/plan, or errored. */
const ATTENTION_STATES: ReadonlySet<SessionState> = new Set([
  "idle",
  "awaiting",
  "awaiting_permission",
  "awaiting_question",
  "awaiting_plan",
  "error",
  "bg_awaiting",
  "bg_awaiting_permission",
]);

/** How long a pressed-but-still-unanswered session stays quiet before the key
 *  starts flashing again. Long enough to read and think in the tab, short
 *  enough that a session you wandered away from can't be forgotten. */
const RENAG_AFTER_MS = 180_000;
/** After this many unanswered nags the key stops flashing and keeps only the
 *  dot — a session that needs no reply must never strobe forever. */
const MAX_NAGS = 3;

export interface DisplayEntry {
  session: SessionInfo;
  state: SessionState;
  /** When state became "finished"; used to expire the entry after FINISHED_TTL_MS. */
  finishedAt?: number;
  /** Busy → needs-you transition, unacknowledged — the key flashes. A press
   *  snoozes it; it re-arms after RENAG_AFTER_MS if still unanswered. Only a
   *  reply (session goes busy) clears it for good. */
  attention?: boolean;
  /** Still owes the user a reply, but currently snoozed — the key shows a
   *  quiet persistent dot instead of flashing. */
  awaitingReply?: boolean;
}

/**
 * Owns the cross-tick bookkeeping needed to keep "just died" sessions on screen
 * for FINISHED_TTL_MS after their process exits. Pure given inputs (sessions,
 * live PIDs, now) but mutates its private maps to track transitions.
 */
export function createStateTracker() {
  /** Carry-over map keyed by sessionId so a session stays visible briefly after its process dies. */
  const recentlyFinished = new Map<string, DisplayEntry>();
  /** Sessions seen alive in the previous tick — used to detect "just died" transitions. */
  let prevLiveIds = new Set<string>();
  /** Sorted display entries from the last tick; consumed by render(). */
  let cachedEntries: DisplayEntry[] = [];
  /** Last displayed state per live session — used to detect busy → needs-you transitions. */
  const prevStates = new Map<string, SessionState>();
  /** Sessions that owe the user a reply, keyed by sessionId. `snoozedAt` is
   *  set by a slot press: the key stops flashing but keeps a dot, and
   *  re-arms once RENAG_AFTER_MS has passed. */
  const owed = new Map<string, { snoozedAt?: number; nags: number; muted?: boolean }>();

  let lastDiag = "";
  function maybeLog(msg: string): void {
    // Avoid spamming the same line every second.
    if (msg !== lastDiag) {
      streamDeck.logger.info(msg);
      lastDiag = msg;
    }
  }

  /**
   * Reads sessions, filters by live PIDs, promotes "just died" into the
   * recently-finished bucket, expires stale carry-overs, and returns the
   * sorted display entries. Also caches the entries internally for
   * `getEntries()` and `needsAnimation()`.
   */
  async function tick(actionCount: number): Promise<DisplayEntry[]> {
    const sessions = await readAllSessions();
    const livenessResult = await filterLiveSessions(sessions);
    const live = livenessResult.live;
    const sourceList = SESSION_SOURCES.map((s) => s.origin).join("+");
    maybeLog(
      `tick: sources=${sourceList} sessions=${sessions.length} live=${live.size}` +
        (livenessResult.fromCache ? " (cached)" : "") +
        ` actions=${actionCount}` +
        (livenessResult.error ? ` livenessError="${livenessResult.error}"` : "") +
        (lastReadError ? ` readError=${lastReadError}` : ""),
    );

    const liveEntries: DisplayEntry[] = sessions
      .filter((s) => live.has(s.sessionId))
      .map((session) => ({ session, state: deriveState(session, true) }));

    // Attention bookkeeping. Arm on busy → needs-you. A reply (session goes
    // busy again) is the ONLY thing that clears it — a slot press merely
    // snoozes the flash, because looking at a session isn't answering it.
    const now = Date.now();
    for (const e of liveEntries) {
      const sid = e.session.sessionId;
      const prev = prevStates.get(sid);
      if (prev !== undefined && BUSY_STATES.has(prev) && ATTENTION_STATES.has(e.state)) {
        if (!owed.has(sid)) owed.set(sid, { nags: 1 });
      } else if (BUSY_STATES.has(e.state)) {
        owed.delete(sid);
      }
      prevStates.set(sid, e.state);

      const entry = owed.get(sid);
      if (!entry) {
        e.attention = false;
        e.awaitingReply = false;
        continue;
      }
      // Snoozed presses re-arm once the grace period lapses — up to MAX_NAGS,
      // after which the tile goes quiet and keeps only the dot.
      if (entry.snoozedAt !== undefined && now - entry.snoozedAt >= RENAG_AFTER_MS) {
        entry.snoozedAt = undefined;
        entry.nags += 1;
        if (entry.nags > MAX_NAGS) entry.muted = true;
      }
      e.attention = entry.muted !== true && entry.snoozedAt === undefined;
      e.awaitingReply = true;
    }

    // Promote a session into "finished" only if it was alive last tick and is gone now.
    // Stale session files (whose process hasn't been seen alive since we started)
    // are simply ignored — those are junk left over from previous CC runs.
    const liveIds = new Set(liveEntries.map((e) => e.session.sessionId));
    for (const session of sessions) {
      if (prevLiveIds.has(session.sessionId) && !liveIds.has(session.sessionId) && !recentlyFinished.has(session.sessionId)) {
        recentlyFinished.set(session.sessionId, { session, state: "finished", finishedAt: Date.now() });
      }
    }
    for (const [sid, entry] of recentlyFinished) {
      if (liveIds.has(sid) || (entry.finishedAt && Date.now() - entry.finishedAt > FINISHED_TTL_MS)) {
        recentlyFinished.delete(sid);
      }
    }
    prevLiveIds = liveIds;

    // Dead sessions don't flash and don't leak bookkeeping.
    for (const sid of owed.keys()) if (!liveIds.has(sid)) owed.delete(sid);
    for (const sid of prevStates.keys()) if (!liveIds.has(sid)) prevStates.delete(sid);

    // Delete dead-process session files so the source dir stays bounded — left
    // unchecked they pile up (months of <pid>.json) and every one gets re-stat'd
    // each tick over the slow UNC. Snapshots for the finished-TTL carry-over are
    // already held in recentlyFinished, so removing the file here is safe.
    const pruned = await pruneDeadSessions(sessions, live, Date.now());
    if (pruned > 0) streamDeck.logger.info(`pruned ${pruned} dead session file(s)`);

    cachedEntries = [...liveEntries, ...recentlyFinished.values()].sort(
      (a, b) => a.session.startedAt - b.session.startedAt,
    );
    return cachedEntries;
  }

  function getEntries(): DisplayEntry[] {
    return cachedEntries;
  }

  /**
   * Whether anything on screen needs frame-to-frame redraw (animated motif
   * OR a marquee-overflowing label). Lets the animation loop short-circuit
   * the render call when nothing would actually change.
   */
  function needsAnimation(): boolean {
    return cachedEntries.some(
      (e) => e.attention === true || iconNeedsAnimation(e.state, e.session.label, e.session.todos),
    );
  }

  /** Slot press: the user has SEEN this session, which is not the same as
   *  having answered it. Snooze the flash and keep the dot; the flash returns
   *  after RENAG_AFTER_MS unless the session goes busy in the meantime. */
  function acknowledge(sessionId: string): void {
    const entry = owed.get(sessionId);
    if (!entry) return;
    entry.snoozedAt = Date.now();
    for (const e of cachedEntries) {
      if (e.session.sessionId === sessionId) e.attention = false;
    }
  }

  /** Slot press while the user was already looking at that session: they know,
   *  and nothing is owed. Clears flash and dot until the session next goes
   *  busy → needs-you. */
  function dismiss(sessionId: string): void {
    owed.delete(sessionId);
    for (const e of cachedEntries) {
      if (e.session.sessionId === sessionId) {
        e.attention = false;
        e.awaitingReply = false;
      }
    }
  }

  return { tick, getEntries, needsAnimation, acknowledge, dismiss };
}
