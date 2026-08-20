import type { AgentProvider, AgentSession, TerminateResult } from "../provider-types.js";

export const codexProvider: AgentProvider = {
  id: "codex",

  async readSessions(): Promise<AgentSession[]> {
    const { readCodexSessions } = await import("../sessions.js");
    return readCodexSessions();
  },

  async filterLive(sessions: readonly AgentSession[]): Promise<Set<string>> {
    const [{ filterLiveSessions }, { asSessionInfo }] = await Promise.all([
      import("../live-pids.js"),
      import("./shared.js"),
    ]);
    const relevant = sessions.filter((session) => session.provider === "codex");
    return (await filterLiveSessions(relevant.map(asSessionInfo))).live;
  },

  async focus(session: AgentSession) {
    const { focusSession } = await import("./shared.js");
    return focusSession(session);
  },

  async terminate(session: AgentSession): Promise<TerminateResult> {
    const [{ killSession }, { asSessionInfo, noPidTermination }] = await Promise.all([
      import("../kill-session.js"),
      import("./shared.js"),
    ]);
    const info = asSessionInfo(session);
    if (info.pid === undefined) return noPidTermination();
    return killSession(info.pid, info.origin, "codex");
  },
};
