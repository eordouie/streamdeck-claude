import type { AgentStatus, DeckAgent } from "./model.js";

/** How long a turn must stay ended before the deck believes it. Measured
 *  2026-11-23: a Codex agent reported `done` for 2 s between two steps, which
 *  would have thrown its key out of the working group and back. */
export const HOLD_MS = 4000;

export interface Settled {
  terminalId: string;
  sessionId: string;
  rawSeq: number;
  /** The status the deck shows. */
  shown: AgentStatus;
  /** herdr's counter when the agent entered `shown`: its place inside the group. */
  order: number;
  /** When herdr first reported the ended turn the deck is still holding back. */
  pendingSince?: number;
}
export type SettleState = Map<string, Settled>;

const ENDED: readonly AgentStatus[] = ["done", "idle", "unknown"];

/** Replace each agent's raw status and counter by what the deck shows. Only
 *  the end of a turn is held back; blocked and working apply at once. While
 *  the shown status is unchanged the agent's place is unchanged too. */
export function settle(
  prev: SettleState,
  agents: readonly DeckAgent[],
  now: number,
): { agents: DeckAgent[]; state: SettleState } {
  const state: SettleState = new Map();
  const out = agents.map((a) => {
    const old = prev.get(a.paneId);
    const p = old && continues(old, a) ? old : undefined;
    const next: Settled = {
      shown: a.status, order: a.seq, rawSeq: a.seq, terminalId: a.terminalId,
      sessionId: a.sessionId || p?.sessionId || "",
    };
    if (p && a.status === p.shown) {
      // The deck shows what it showed before, so the agent keeps its place:
      // on returning from a held blip, and equally when herdr's counter moved
      // through an excursion shorter than one poll. A blip must not move a
      // key more for being shorter.
      next.order = p.order;
    } else if (p?.shown === "working" && ENDED.includes(a.status)) {
      const since = p.pendingSince ?? now;
      if (now - since < HOLD_MS) {
        next.shown = "working";
        next.order = p.order;
        next.pendingSince = since;
      }
    }
    state.set(a.paneId, next);
    return { ...a, sessionId: next.sessionId, status: next.shown, seq: next.order };
  });
  return { agents: out, state };
}

export function continues(old: Settled, a: DeckAgent): boolean {
  return old.terminalId === a.terminalId && a.seq >= old.rawSeq &&
    (!old.sessionId || !a.sessionId || old.sessionId === a.sessionId);
}
