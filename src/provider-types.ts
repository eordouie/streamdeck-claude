import type { FocusResult } from "./terminal-focus.js";

export type ProviderId = string;

/** How a free slot opens a new agent tab. There is exactly one of these, on the
 *  slot key itself — NOT one per provider. The tab opens at a bare prompt and
 *  the user types the agent, so nothing here names claude, codex, or any other
 *  CLI; it carries only the environment whatever they type should inherit. */
export interface LaunchSpec {
  script: string;
  env?: Readonly<Record<string, string>>;
  unsetEnv?: readonly string[];
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

/** A provider is a way of DISCOVERING and driving sessions, never a way of
 *  starting one: launching is the user's gesture plus their own typing. So an
 *  adapter owns only the genuinely mechanical differences — where the session
 *  records live, how liveness is probed, how the terminal is focused, how the
 *  process is signalled. */
export interface AgentProvider {
  readonly id: ProviderId;
  readSessions(): Promise<AgentSession[]>;
  filterLive(sessions: readonly AgentSession[]): Promise<Set<string>>;
  focus(session: AgentSession): Promise<FocusResult>;
  terminate(session: AgentSession): Promise<TerminateResult>;
}
