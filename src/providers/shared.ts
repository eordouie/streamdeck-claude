import type { AgentSession, TerminateResult } from "../provider-types.js";
import type { SessionInfo } from "../sessions.js";
import { focusTerminalForSession } from "../terminal-focus.js";

export function asSessionInfo(session: AgentSession): SessionInfo {
  return session as SessionInfo;
}

export async function focusSession(session: AgentSession) {
  const info = asSessionInfo(session);
  return focusTerminalForSession({
    cwd: info.cwd,
    terminal: info.terminal,
    origin: info.origin,
    pid: info.pid,
    canonicalTitle: info.deckName,
  });
}

export function noPidTermination(): TerminateResult {
  return { terminated: false, reason: "session-has-no-pid" };
}
