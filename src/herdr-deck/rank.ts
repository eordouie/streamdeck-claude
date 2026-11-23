import type { AgentStatus, DeckAgent } from "./model.js";

/** Lower is higher on the deck. An agent herdr cannot classify sits with the idle ones. */
const GROUP: Record<AgentStatus, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 3 };

const paneNumber = (paneId: string): number => Number(paneId.split(":p")[1]) || 0;

/** Needs-you first, then working, then finished and not yet looked at, then
 *  idle. Inside a group the agent that entered it last comes first. The tail
 *  of the comparison only makes the order total, so two polls of the same
 *  state always give the same keys. */
export function rankAgents(agents: readonly DeckAgent[]): DeckAgent[] {
  return [...agents].sort(
    (a, b) =>
      GROUP[a.status] - GROUP[b.status] ||
      b.seq - a.seq ||
      a.workspaceNumber - b.workspaceNumber ||
      paneNumber(a.paneId) - paneNumber(b.paneId) ||
      a.paneId.localeCompare(b.paneId),
  );
}
