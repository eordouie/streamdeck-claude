import type { FocusResult } from "./terminal-focus.js";

export type ProviderId = string;

export interface LaunchSpec {
  script: string;
  args: readonly string[];
}

/** Provider-neutral fields shared by every session adapter. */
export interface AgentSession {
  provider: ProviderId;
  sessionId: string;
  cwd: string;
  startedAt: number;
  launchId?: string;
  [key: string]: unknown;
}

export interface TerminateResult {
  terminated: boolean;
  reason: string;
}

export interface AgentProvider {
  readonly id: ProviderId;
  readonly launch: LaunchSpec;
  readSessions(): Promise<AgentSession[]>;
  filterLive(sessions: readonly AgentSession[]): Promise<Set<string>>;
  focus(session: AgentSession): Promise<FocusResult>;
  terminate(session: AgentSession): Promise<TerminateResult>;
}
