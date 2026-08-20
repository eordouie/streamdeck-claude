/**
 * Links a background job to the interactive session that parked it.
 *
 * A bg job runs headless behind `--bg-pty-host`: it has no terminal tab of its
 * own, so the slot-press focus chain can never match one. Before this existed
 * every press on a bg slot spent ~2s missing warp → vscode → ghostty and then
 * gave up — the log line was `no-tab-named "claude-<pid>"`, repeated once per
 * press, while the job sat there waiting on an AskUserQuestion nobody could
 * reach.
 *
 * The place you CAN reach the job is the session that launched it. Claude Code
 * records both halves of that link: `jobId` on the job's own <pid>.json,
 * `parkedJobId` on the launching session's. Match them and the key has
 * somewhere to go.
 *
 * Node builtins only, and the one `import type` is erased at compile time — see
 * naming-policy.ts for why anything unit-tested must stay importable from bare
 * node. `adoptParkedState` lives here rather than in sessions.ts for exactly
 * that reason: sessions.ts imports the Elgato SDK, which cannot load under
 * `tsx --test`, so the state-adoption rule would have been untestable there.
 */
import type { SessionState } from "./icons/states.js";

/** Structural shape the linker needs. SessionInfo and test fixtures both satisfy it. */
export interface OwnableSession {
  sessionId: string;
  kind: "interactive" | "bg";
  /** bg only: this job's own id. */
  jobId?: string;
  /** interactive only: the bg job this session has parked. */
  parkedJobId?: string;
}

/**
 * Maps each bg session's id → the sessionId of the interactive session that
 * owns it. A job is ABSENT from the map when its owner is gone or when more
 * than one session claims it: the press then alerts instead of jumping
 * somewhere merely plausible. Sending the user to the wrong tab is worse than
 * telling them there is no tab — they would answer the wrong agent's question.
 */
export function resolveBgOwners(sessions: readonly OwnableSession[]): Map<string, string> {
  // null = contested. Two sessions claiming one job is a contradiction we
  // cannot resolve from here, so neither wins.
  const byJob = new Map<string, string | null>();
  for (const s of sessions) {
    if (s.kind === "bg" || !s.parkedJobId) continue;
    byJob.set(s.parkedJobId, byJob.has(s.parkedJobId) ? null : s.sessionId);
  }
  const owners = new Map<string, string>();
  for (const s of sessions) {
    if (s.kind !== "bg" || !s.jobId) continue;
    const owner = byJob.get(s.jobId);
    if (owner) owners.set(s.sessionId, owner);
  }
  return owners;
}

/**
 * The INVERSE link: interactive sessionId → sessionId of the bg job it parked.
 *
 * `resolveBgOwners` answers "whose tab do I focus for this job", which is a
 * routing question. This answers the STATE question nobody was asking:
 * *what is my parked work doing right now?*
 *
 * Without it a parked session is a lie by omission. Claude Code writes `idle`
 * on the launching session the moment it parks a job — correctly, its own turn
 * loop is not running — so the tile you are looking at says idle while the work
 * happens on a bg tile you cannot reach. Measured 2026-08-19: session "lever"
 * sat blue and idle with `parkedJobId: 13fb99e8` while that job was
 * `waiting: "input needed"`, so the one key the user had to press was the only
 * one showing nothing to do.
 *
 * Contested links are dropped exactly as in `resolveBgOwners`, and for the same
 * reason: adopting the wrong job's state would put a stranger's activity on
 * your tile.
 */
export function resolveParkedJobs(sessions: readonly OwnableSession[]): Map<string, string> {
  // jobId → bg sessionId, null when two bg sessions claim one jobId.
  const bgByJob = new Map<string, string | null>();
  for (const s of sessions) {
    if (s.kind !== "bg" || !s.jobId) continue;
    bgByJob.set(s.jobId, bgByJob.has(s.jobId) ? null : s.sessionId);
  }
  // owner → bg sessionId, dropping owners that contest one job between them.
  const claimants = new Map<string, number>();
  for (const s of sessions) {
    if (s.kind === "bg" || !s.parkedJobId) continue;
    claimants.set(s.parkedJobId, (claimants.get(s.parkedJobId) ?? 0) + 1);
  }
  const parked = new Map<string, string>();
  for (const s of sessions) {
    if (s.kind === "bg" || !s.parkedJobId) continue;
    if ((claimants.get(s.parkedJobId) ?? 0) > 1) continue;
    const bgSid = bgByJob.get(s.parkedJobId);
    if (bgSid) parked.set(s.sessionId, bgSid);
  }
  return parked;
}

/**
 * What an idle owner tile shows while its parked bg job is active.
 *
 * Deliberately the owner-facing TWIN of each bg state, not the bg state itself:
 * the `bg_` prefix is what draws the "bg" badge (`isBgState`), and stamping that
 * on an interactive tab would claim the tab *is* the background job. It is
 * merely where you answer it.
 *
 * `bg_idle` adopts nothing. A parked job sitting idle is not activity, and
 * promoting it would leave every parked session permanently louder than an
 * unparked one — the "erring quiet beats erring needy" rule the Notification
 * whitelist already follows.
 */
export function adoptParkedState(parked: SessionState): SessionState {
  switch (parked) {
    case "bg_working":
      return "working";
    case "bg_awaiting_permission":
      return "awaiting_permission";
    case "bg_awaiting":
      return "awaiting";
    default:
      return "idle";
  }
}
