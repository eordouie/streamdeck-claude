import { basename } from "node:path";
import type { SessionInfo } from "./sessions.js";
import { readLaunchTtys, pruneLaunchTtys } from "./launch-tty.js";
import { readProcessCwd, readProcessStart, scanAgentProcesses, type AgentProcess } from "./process-scan.js";

/** Marks a session assembled from a running process rather than from a record
 *  the agent wrote. Load-bearing: everything that touches session FILES must
 *  skip these, because they have none. */
export const PROVISIONAL_PREFIX = "pending:";

export const isProvisional = (sessionId: string): boolean => sessionId.startsWith(PROVISIONAL_PREFIX);

/**
 * Agents that are RUNNING but have not announced themselves yet.
 *
 * Codex is why this exists. Its TUI fires `SessionStart` when the *conversation*
 * starts, not when the process does, and it writes no rollout file before then —
 * measured 2026-08-17: a trusted, fully started `codex` sat at its prompt for 40 s
 * having produced not one byte anywhere on disk, while `ps` showed it plainly. So
 * for the interval between "I typed codex" and "I said something to it", the
 * process IS the session record.
 *
 * Claude publishes itself the same second it starts and is therefore almost never
 * provisional. It goes through this path anyway: "an agent is running in a
 * terminal" is not a provider-specific idea, and a Claude session whose json was
 * pruned under it stays visible for free.
 */
export async function readProvisionalSessions(known: readonly SessionInfo[]): Promise<SessionInfo[]> {
  const processes = await scanAgentProcesses();
  const knownPids = new Set(known.map((session) => session.pid).filter((pid): pid is number => pid !== undefined));
  const unclaimed = processes.filter((proc) => !knownPids.has(proc.pid));
  if (unclaimed.length === 0) {
    // Nothing to describe — but still sweep the handoff dir, since a launch that
    // never produced an agent leaves a file behind.
    void pruneLaunchTtys();
    return [];
  }

  const [ttyToLaunch] = await Promise.all([readLaunchTtys(), pruneLaunchTtys()]);
  return Promise.all(unclaimed.map((proc) => describe(proc, ttyToLaunch.get(proc.tty))));
}

async function describe(proc: AgentProcess, launchId: string | undefined): Promise<SessionInfo> {
  // Two extra spawns, only ever for a process with no record of its own: the
  // start time so it sorts among real sessions by age, and the cwd so the tile
  // carries a project label and a paste payload from its first frame.
  const [startedAt, cwd] = await Promise.all([readProcessStart(proc.pid), readProcessCwd(proc.pid)]);
  return {
    provider: proc.provider,
    pid: proc.pid,
    sessionId: `${PROVISIONAL_PREFIX}${proc.provider}:${proc.pid}`,
    cwd: cwd ?? "",
    label: cwd ? basename(cwd) : "",
    providerLabel: proc.provider === "codex" ? "codex" : undefined,
    startedAt: startedAt ?? Date.now(),
    // Sitting at its prompt waiting for you is exactly `idle`. Not `working`:
    // nothing is running, and idle is also the one state that never flashes for
    // attention, which is right for a session you just opened yourself.
    rawStatus: "idle",
    awaiting: false,
    awaitingPermission: false,
    awaitingQuestion: false,
    awaitingPlan: false,
    errored: false,
    subagentActive: false,
    todos: [],
    bgAgentStarts: [],
    origin: "wsl",
    // Only claim Ghostty when the tab came from a deck launch, which is the one
    // case we know the terminal for. Otherwise leave it unknown and let the focus
    // dispatcher fall back rather than lie.
    terminal: launchId ? "ghostty" : "unknown",
    transcriptPath: "",
    title: "",
    firstPrompt: "",
    deckName: "",
    kind: "interactive",
    launchId,
  };
}
