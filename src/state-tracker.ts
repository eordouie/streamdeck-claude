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
import { terminalHostedEntry } from "./terminal-kind.js";
import { resolveParkedJobs } from "./bg-owner.js";
import { readProvisionalSessions } from "./provisional-sessions.js";
import { KillSuppression } from "./kill-suppression.js";
import { ProviderRegistry } from "./provider-registry.js";
import { createBuiltinProviders } from "./providers/index.js";

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
export function createStateTracker(
  providerRegistry = new ProviderRegistry(createBuiltinProviders()),
) {
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
   *  re-arms once RENAG_AFTER_MS has passed. `armedAt` anchors the
   *  time-based mute below. */
  const owed = new Map<string, { snoozedAt?: number; nags: number; muted?: boolean; armedAt: number }>();
  /** Sessions the user killed with a 3 s hold — off the deck immediately. */
  const killed = new KillSuppression();

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
    const providers = providerRegistry.ids().map((id) => providerRegistry.get(id));
    const recorded = await readAllSessions(providers);
    // An agent that is running but has not written a record yet still gets a
    // tile. Appended AFTER readAllSessions so none of its file bookkeeping —
    // naming, cache pruning, dead-file sweeps — ever sees a session with no files.
    const sessions = [...recorded, ...(await readProvisionalSessions(recorded))];
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

    // A session that parked a job shows its DELEGATE's activity, so the tile the
    // user can actually press is the one that lights up. Only LIVE bg jobs feed
    // this: a dead job's last known status is not activity, and adopting it
    // would leave an owner tile working forever behind a job that already exited.
    const parkedJobs = resolveParkedJobs(sessions);
    const bgStateBySid = new Map<string, SessionState>();
    for (const s of sessions) {
      if (s.kind === "bg" && live.has(s.sessionId)) bgStateBySid.set(s.sessionId, deriveState(s, true));
    }
    const liveEntries: DisplayEntry[] = sessions
      // Deck membership: a live pid with a session record is not enough — the
      // record must declare a terminal entrypoint. The Claude Desktop app's
      // agent mode keeps a recorded, hook-firing, LIVE `claude` child with no
      // tab; without this gate it renders as a ghost tile that outlives every
      // real session. Excluded from display only: the record keeps flowing
      // through prune/cache bookkeeping so its files are still cleaned up
      // when the app-driven process dies. bg jobs are deliberately tab-less
      // and keep their tiles.
      .filter((s) => live.has(s.sessionId) && (s.kind === "bg" || terminalHostedEntry(s.entrypoint)))
      .map((session) => {
        const bgSid = parkedJobs.get(session.sessionId);
        const parkedState = bgSid === undefined ? undefined : bgStateBySid.get(bgSid);
        return { session, state: deriveState(session, true, parkedState) };
      });

    // Attention bookkeeping. Arm on busy → needs-you. A reply (session goes
    // busy again) is the ONLY thing that clears it — a slot press merely
    // snoozes the flash, because looking at a session isn't answering it.
    const now = Date.now();
    for (const e of liveEntries) {
      const sid = e.session.sessionId;
      const prev = prevStates.get(sid);
      if (prev !== undefined && BUSY_STATES.has(prev) && ATTENTION_STATES.has(e.state)) {
        if (!owed.has(sid)) owed.set(sid, { nags: 1, armedAt: now });
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
      // Time-based mute, independent of presses: the invariant is "a session
      // that needs no reply must never strobe forever", but the press-driven
      // counter above only advances if someone acknowledges — a key nobody
      // pressed (user away from desk) used to flash indefinitely.
      if (Math.floor((now - entry.armedAt) / RENAG_AFTER_MS) >= MAX_NAGS) entry.muted = true;
      e.attention = entry.muted !== true && entry.snoozedAt === undefined;
      e.awaitingReply = true;
    }

    // Promote a session into "finished" only if it was alive last tick and is gone now.
    // Stale session files (whose process hasn't been seen alive since we started)
    // are simply ignored — those are junk left over from previous CC runs.
    const liveIds = new Set(liveEntries.map((e) => e.session.sessionId));
    for (const session of sessions) {
      if (prevLiveIds.has(session.sessionId) && !liveIds.has(session.sessionId) && !recentlyFinished.has(session.sessionId)) {
        // A death the user ordered needs no 3 s explanation — the hold was it.
        if (killed.claimDeath(session.sessionId)) continue;
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
    //
    // ONLY on a trustworthy liveness answer: an errored or cache-degraded
    // probe collapses `live` toward empty, and pruning against that verdict
    // once mass-deleted every idle session's files during a >10 s spawn
    // outage (their mtimes are hours old, so the grace window is no shield).
    let pruned = 0;
    if (!livenessResult.error && !livenessResult.fromCache) {
      // `recorded`, never `sessions`: a provisional session has no files, so the
      // sweep would resolve its synthetic id against a real source directory.
      pruned = await pruneDeadSessions(recorded, live, Date.now());
    }
    if (pruned > 0) streamDeck.logger.info(`pruned ${pruned} dead session file(s)`);

    // A killed session is dropped from DISPLAY while its process finishes
    // exiting, but stays in `liveIds` above — that set is the liveness truth the
    // rest of the tick reasons about, and faking a death there would send the
    // session through the finished-promotion path this suppression exists to skip.
    killed.prune(now);
    cachedEntries = [
      ...liveEntries.filter((e) => !killed.suppresses(e.session, now)),
      ...recentlyFinished.values(),
    ].sort((a, b) => a.session.startedAt - b.session.startedAt);
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

  /** The kill signal was delivered — take the tile down now, and skip the
   *  `finished` flash when the process actually goes. */
  function markKilled(sessionId: string, pid?: number): void {
    killed.mark({ sessionId, pid });
  }

  return { tick, getEntries, needsAnimation, acknowledge, dismiss, markKilled };
}
