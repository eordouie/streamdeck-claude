/**
 * Sessions the user explicitly killed, so the deck can stop showing them at
 * once instead of narrating a death the user just ordered.
 *
 * Two things are suppressed: the tile while the process finishes shutting down
 * (SIGTERM is not instant), and the `finished` carry-over afterwards. The
 * 3 s finished flash exists so a session that ends on its OWN is not simply
 * gone without explanation — a three-second hold on the key is already that
 * explanation.
 *
 * Deliberately SDK-free so it stays unit-testable from bare node.
 */

/** How long a killed session may stay hidden while still alive. If the process
 *  survives both SIGTERM and SIGKILL past this, the tile comes BACK: hiding a
 *  live session forever would be a lie, and one that costs a slot. */
export const KILL_SUPPRESS_MS = 5_000;

/** Records outlive the kill so a late death still skips the finished flash;
 *  bounded so a session that never dies cannot leak an entry. */
const RECORD_TTL_MS = 60_000;

export interface Killable {
  sessionId: string;
  pid?: number;
}

export class KillSuppression {
  private readonly records = new Map<string, { at: number; pid?: number }>();

  /** Called once the kill signal is known to have been delivered. The pid is
   *  recorded as well as the id, because a dying agent can lose its session file
   *  before it loses its process — and the process scan would then re-add it as
   *  a brand-new provisional session under a different id, putting the tile the
   *  user just killed straight back on the deck. */
  mark(session: Killable, now = Date.now()): void {
    this.records.set(session.sessionId, { at: now, pid: session.pid });
  }

  /** True while a still-live killed session should be kept off the deck. */
  suppresses(session: Killable, now = Date.now()): boolean {
    for (const [sessionId, record] of this.records) {
      if (now - record.at >= KILL_SUPPRESS_MS) continue;
      if (sessionId === session.sessionId) return true;
      if (record.pid !== undefined && record.pid === session.pid) return true;
    }
    return false;
  }

  /** True if this session's death was ordered by the user — consumed, so the
   *  session gets no `finished` tile and the record does not linger. */
  claimDeath(sessionId: string): boolean {
    return this.records.delete(sessionId);
  }

  prune(now = Date.now()): void {
    for (const [sessionId, record] of this.records) {
      if (now - record.at > RECORD_TTL_MS) this.records.delete(sessionId);
    }
  }
}
