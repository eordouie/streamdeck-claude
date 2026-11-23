import type { RawAgent, RawSnapshot } from "./herdr-client.js";
import type { DeckAgent } from "./model.js";

/** A raw agent as herdr reports it. Pane `wA:p1` lives in workspace `wA`, tab `wA:t1`. */
export function rawAgent(over: Partial<RawAgent> & { pane_id: string }): RawAgent {
  const workspace = over.pane_id.split(":")[0];
  return {
    workspace_id: workspace,
    terminal_id: `term-${over.pane_id}`,
    tab_id: `${workspace}:t1`,
    agent: "claude",
    agent_status: "idle",
    focused: false,
    state_change_seq: 1,
    agent_session: { value: `session-${over.pane_id}` },
    ...over,
  };
}

/** A snapshot whose workspaces and tabs are derived from the agents: workspace
 *  `wA` is labelled "wA" and numbered in order of first appearance; every tab is labelled "1". */
export function rawSnapshot(agents: RawAgent[]): RawSnapshot {
  const workspaceIds = [...new Set(agents.map((a) => a.workspace_id))];
  const tabIds = [...new Set(agents.map((a) => a.tab_id))];
  return {
    focused_pane_id: agents.find((a) => a.focused)?.pane_id ?? null,
    workspaces: workspaceIds.map((id, i) => ({ workspace_id: id, label: id, number: i + 1 })),
    tabs: tabIds.map((id) => ({ tab_id: id, workspace_id: id.split(":")[0], label: "1", number: 1 })),
    agents,
  };
}

export function deckAgent(over: Partial<DeckAgent> & { paneId: string }): DeckAgent {
  return {
    kind: "claude",
    status: "idle",
    seq: 1,
    terminalId: `term-${over.paneId}`,
    workspace: over.paneId.split(":")[0],
    workspaceNumber: 1,
    tab: "1",
    sessionId: `session-${over.paneId}`,
    ...over,
  };
}
