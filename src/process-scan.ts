import { basename } from "node:path";
import { binaryIndex, loadAgentConfig } from "./agent-config.js";
import type { ProviderId } from "./provider-types.js";
import { spawnCapture } from "./spawn-capture.js";

export interface AgentProcess {
  pid: number;
  /** Short tty name as `ps` prints it, e.g. `ttys012`. */
  tty: string;
  provider: ProviderId;
}

/** Parses `ps -Ao pid=,tty=,comm=` output. Pure, so the parsing rules are
 *  testable without spawning anything.
 *
 *  This answers only "which processes ARE an agent binary" — whether one is a
 *  session somebody is typing into is decided by its stdio, in `readProcessIo`.
 *  Keeping the two apart is what keeps provider knowledge out of the second
 *  question. */
export function parseAgentProcesses(stdout: string, binaries: ReadonlyMap<string, ProviderId>): AgentProcess[] {
  const out: AgentProcess[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, pidText, tty, comm] = match;
    // No controlling terminal at all → nobody could be sitting in front of it.
    // Cheap pre-filter; it is no longer the only one (see readProcessIo).
    if (tty === "??" || tty === "?" || tty === "-") continue;
    const provider = binaries.get(basename(comm.trim()));
    if (!provider) continue;
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    out.push({ pid, tty: basename(tty), provider });
  }
  return out;
}

/** Every configured agent binary currently attached to a terminal. One `ps` dump
 *  per call. Which binaries those are comes from config, never from here. */
export async function scanAgentProcesses(): Promise<AgentProcess[]> {
  const [result, config] = await Promise.all([
    spawnCapture("ps", ["-Ao", "pid=,tty=,comm="], { timeoutMs: 5_000 }),
    loadAgentConfig(),
  ]);
  if (result.err !== undefined || result.code !== 0) return [];
  return parseAgentProcesses(result.stdout, binaryIndex(config));
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

export interface ProcessIo {
  /** Working directory. Gives a provisional tile its project label and its
   *  press-to-copy payload before the agent has written any record of its own. */
  cwd?: string;
  /** The terminal on fd 0 — present only when fd 0 IS a terminal.
   *
   *  This is the whole interactivity test, and it names no provider. A TUI a
   *  human is typing into reads the terminal directly (`f0 tCHR
   *  n/dev/ttys000`); anything spawned as plumbing gets pipes instead (`f0
   *  tunix n->0x…`) — MCP servers, app-servers, `--print` runs, and whatever
   *  the next agent calls its headless mode. Inheriting the host's tty, which
   *  is what made `codex mcp-server` look like a session, does not survive it:
   *  the tty is in the process table but never on fd 0. */
  stdinTty?: string;
}

/** cwd + stdin of a live process, from one `lsof`. Pure parser split out so the
 *  rule that decides "somebody is typing into this" is testable. */
export function parseLsofIo(stdout: string): ProcessIo {
  const io: ProcessIo = {};
  let fd = "";
  let type = "";
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "f") {
      fd = value;
      type = "";
    } else if (tag === "t") {
      type = value;
    } else if (tag === "n") {
      if (fd === "cwd" && value.startsWith("/")) io.cwd = value;
      // CHR + a /dev/tty… or /dev/pts/… name is a terminal. A pipe or socket is
      // reported as tunix/tFIFO/tPIPE and simply never matches.
      if (fd === "0" && type === "CHR" && /^\/dev\/(tty|pts)/.test(value)) io.stdinTty = value;
    }
  }
  return io;
}

export async function readProcessIo(pid: number): Promise<ProcessIo> {
  const result = await spawnCapture("lsof", ["-a", "-d", "cwd,0", "-p", String(pid), "-Fftn"], {
    timeoutMs: 5_000,
  });
  if (result.err !== undefined || result.code !== 0) return {};
  return parseLsofIo(result.stdout);
}
