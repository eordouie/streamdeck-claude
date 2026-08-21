import { basename } from "node:path";
import type { SessionInfo } from "./sessions.js";
import { readLaunchTtys, pruneLaunchTtys } from "./launch-tty.js";
import { readProcessIo, readProcessStart, scanAgentProcesses, type AgentProcess } from "./process-scan.js";
import { loadAgentConfig, providerTag } from "./agent-config.js";

/** Marks a session assembled from a running process rather than from a record
 *  the agent wrote. Load-bearing: everything that touches session FILES must
 *  skip these, because they have none. */
export const PROVISIONAL_PREFIX = "pending:";

export const isProvisional = (sessionId: string): boolean => sessionId.startsWith(PROVISIONAL_PREFIX);

/** Agent processes already proved to be plumbing, keyed `pid:tty`. An MCP server
 *  lives exactly as long as the session hosting it, so without this the same
 *  verdict is re-bought with an `lsof` every tick for the life of that session.
 *  Entries are dropped as soon as the pid leaves the scan, so a recycled pid is
 *  judged afresh. */
const notASession = new Set<string>();

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
  const present = new Set(processes.map((proc) => key(proc)));
  for (const gone of notASession) if (!present.has(gone)) notASession.delete(gone);
  const knownPids = new Set(known.map((session) => session.pid).filter((pid): pid is number => pid !== undefined));
  const unclaimed = processes.filter((proc) => !knownPids.has(proc.pid) && !notASession.has(key(proc)));
  if (unclaimed.length === 0) {
    // Nothing to describe — but still sweep the handoff dir, since a launch that
    // never produced an agent leaves a file behind.
    void pruneLaunchTtys();
    return [];
  }

  const [ttyToLaunch] = await Promise.all([readLaunchTtys(), pruneLaunchTtys()]);
  const described = await Promise.all(unclaimed.map((proc) => describe(proc, ttyToLaunch.get(proc.tty))));
  return described.filter((session): session is SessionInfo => session !== undefined);
}

const key = (proc: AgentProcess): string => `${proc.pid}:${proc.tty}`;

async function describe(proc: AgentProcess, launchId: string | undefined): Promise<SessionInfo | undefined> {
  // stdio decides it, and it decides it for every agent past, present and
  // future: fd 0 is the terminal for a TUI somebody is typing into, and a pipe
  // for anything spawned as plumbing. A `codex mcp-server` INHERITS its host
  // session's tty — the process table cannot tell them apart, fd 0 always can.
  const io = await readProcessIo(proc.pid);
  if (io.stdinTty === undefined) {
    notASession.add(key(proc));
    return undefined;
  }
  // One more spawn for a process with no record of its own: the start time, so
  // it sorts among real sessions by age.
  const startedAt = await readProcessStart(proc.pid);
  const cwd = io.cwd;
  return {
    provider: proc.provider,
    pid: proc.pid,
    sessionId: `${PROVISIONAL_PREFIX}${proc.provider}:${proc.pid}`,
    cwd: cwd ?? "",
    label: cwd ? basename(cwd) : "",
    providerLabel: providerTag(proc.provider, await loadAgentConfig()),
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
    agentLastSeen: [],
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
