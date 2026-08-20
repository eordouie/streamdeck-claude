import { basename } from "node:path";
import { spawnCapture } from "./spawn-capture.js";

/** `comm` basenames that mean "an interactive agent CLI", mapped to provider id.
 *  `claude.exe` is the Windows-side binary name; macOS reports plain `claude`. */
const AGENT_COMMS: Readonly<Record<string, "claude" | "codex">> = {
  claude: "claude",
  "claude.exe": "claude",
  codex: "codex",
};

export interface AgentProcess {
  pid: number;
  /** Short tty name as `ps` prints it, e.g. `ttys012`. */
  tty: string;
  provider: "claude" | "codex";
}

/** Parses `ps -Ao pid=,tty=,comm=` output. Pure, so the parsing rules are
 *  testable without spawning anything. */
export function parseAgentProcesses(stdout: string): AgentProcess[] {
  const out: AgentProcess[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, pidText, tty, comm] = match;
    // No controlling terminal → nobody is sitting in front of it. This is also
    // exactly what keeps two non-sessions off the deck: the ChatGPT desktop
    // app's own `codex` app-server process, and the headless `claude -p` calls
    // the deck namer itself makes.
    if (tty === "??" || tty === "?" || tty === "-") continue;
    const provider = AGENT_COMMS[basename(comm.trim())];
    if (!provider) continue;
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    out.push({ pid, tty: basename(tty), provider });
  }
  return out;
}

/** Every agent CLI currently attached to a terminal. One `ps` dump per call. */
export async function scanAgentProcesses(): Promise<AgentProcess[]> {
  const result = await spawnCapture("ps", ["-Ao", "pid=,tty=,comm="], { timeoutMs: 5_000 });
  if (result.err !== undefined || result.code !== 0) return [];
  return parseAgentProcesses(result.stdout);
}

/** Process start time, from `ps -o lstart=`. `etimes` does not exist on macOS
 *  and `lstart` embeds spaces, which is why this is one call per pid rather than
 *  a column in the bulk scan above — it is only ever needed for the handful of
 *  processes that have no session record yet. */
export async function readProcessStart(pid: number): Promise<number | undefined> {
  const result = await spawnCapture("ps", ["-o", "lstart=", "-p", String(pid)], { timeoutMs: 5_000 });
  if (result.err !== undefined || result.code !== 0) return undefined;
  const parsed = Date.parse(result.stdout.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Working directory of a live process. Gives a provisional tile its project
 *  label and its press-to-copy payload before the agent has written any record
 *  naming its own cwd. */
export async function readProcessCwd(pid: number): Promise<string | undefined> {
  const result = await spawnCapture("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], { timeoutMs: 5_000 });
  if (result.err !== undefined || result.code !== 0) return undefined;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("n/")) return line.slice(1).trim();
  }
  return undefined;
}
