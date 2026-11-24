import type { RawSnapshot } from "./herdr-client.js";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
const STATUSES: readonly string[] = ["idle", "working", "blocked", "done", "unknown"];

export interface DeckAgent {
  paneId: string;
  terminalId: string;
  /** "claude", "codex", ... An opaque word: it may be drawn, nothing may branch on it. */
  kind: string;
  status: AgentStatus;
  /** herdr's server-wide counter at this agent's last state change; larger is later. */
  seq: number;
  /** The workspace's name: the project name on the key's top line. */
  workspace: string;
  workspaceNumber: number;
  tab: string;
  sessionId: string;
}

export function toDeckAgents(snap: RawSnapshot): DeckAgent[] {
  const workspaces = new Map(snap.workspaces.map((w) => [w.workspace_id, w]));
  const tabs = new Map(snap.tabs.map((t) => [t.tab_id, t]));
  return snap.agents.map((a) => {
    const ws = workspaces.get(a.workspace_id);
    return {
      paneId: a.pane_id,
      terminalId: a.terminal_id,
      kind: a.agent?.trim() || "agent",
      status: (STATUSES.includes(a.agent_status) ? a.agent_status : "unknown") as AgentStatus,
      seq: a.state_change_seq ?? 0,
      workspace: ws?.label || a.workspace_id,
      workspaceNumber: ws?.number ?? Number.MAX_SAFE_INTEGER,
      tab: String(tabs.get(a.tab_id)?.label ?? ""),
      sessionId: a.agent_session?.value ?? "",
    };
  });
}
