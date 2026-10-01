import { platform } from "node:os";
import type { SessionInfo, SessionOrigin } from "./sessions.js";
import { WSL_DISTRO } from "./env.js";
import { spawnCapture, type CaptureResult } from "./spawn-capture.js";
import { classifyRecords, parsePsStates } from "./record-liveness.js";

/**
 * Returns the subset of sessions whose process is currently running.
 *
 * WSL / local sessions are checked with ONE `ps -o pid=,stat= -p <pids>` (via
 * `wsl.exe -d <distro>` from a Windows-side plugin). Windows-native sessions
 * are checked via `tasklist.exe /FO CSV` — those PIDs live in a different
 * process namespace and aren't visible to WSL. Both checks run in parallel.
 *
 * `ps` replaced a per-pid `kill -0` because liveness has two questions and
 * `kill -0` answers only the first: is the process there, and is it RUNNING.
 * A Claude suspended with Ctrl+Z passes `kill -0` for as long as it sits in
 * its shell's job table — three days, on 2026-10-01 — and kept a key the
 * whole time. The stat column says `T`. See record-liveness.ts.
 *
 * Spawn-level failures (ENOENT, timeout, …) are absorbed for CACHE_FALLBACK_MS
 * using the previous good answer per origin, so a single flaky `wsl.exe` start
 * doesn't flicker every slot to "finished". So is a nonzero exit WITH stderr:
 * `ps` exits 1 silently when none of the pids exist (all dead — a real
 * answer), but an error message means the probe itself failed, and reading
 * that as "everything died" would prune every live session's files.
 * Cleanly-empty stdout is NOT a fallback trigger — empty means all candidates
 * are dead, and for `tasklist` empty essentially never happens in practice.
 */

interface OriginCache {
  /** pid → stat from the last successful tick, already intersected with the candidate list. */
  lastStates: Map<number, string>;
  lastAt: number;
}
const CACHE_FALLBACK_MS = 10_000;
const cache: Record<SessionOrigin, OriginCache> = {
  wsl: { lastStates: new Map(), lastAt: 0 },
  windows: { lastStates: new Map(), lastAt: 0 },
};

interface OriginAnswer {
  /** Live pids → `ps` stat ("" where the probe cannot say). */
  states: Map<number, string>;
  error?: string;
  fromCache: boolean;
}

async function checkWslLive(pids: number[]): Promise<OriginAnswer> {
  if (pids.length === 0) return { states: new Map(), fromCache: false };
  const psArgs = ["-o", "pid=,stat=", "-p", pids.join(",")];
  const result =
    platform() === "win32"
      ? await spawnCapture("wsl.exe", ["-d", WSL_DISTRO, "--", "ps", ...psArgs])
      : await spawnCapture("ps", psArgs, { timeoutMs: 5_000 });
  return parseAndCache("wsl", result, pids, parsePsStates);
}

async function checkWindowsLive(pids: number[]): Promise<OriginAnswer> {
  if (pids.length === 0) return { states: new Map(), fromCache: false };
  if (platform() !== "win32") {
    // Linux-side plugin can't enumerate Windows processes; assume alive (best-effort).
    return { states: new Map(pids.map((p) => [p, ""])), fromCache: false, error: "windows-liveness skipped on linux host" };
  }
  // tasklist treats multiple `/FI "PID eq <n>"` filters as AND (no row matches
  // multiple PIDs simultaneously), so we can't batch-filter. Cheaper to dump
  // every process once and intersect ourselves than to spawn N processes.
  const all = await spawnCapture("tasklist.exe", ["/NH", "/FO", "CSV"]);
  return parseAndCache("windows", all, pids, parsePidsFromCsv);
}

function parsePidsFromCsv(stdout: string): Map<number, string> {
  // tasklist CSV row:  "claude.exe","109164","Console","1","443 040 Ko"
  // It has no run state, so every listed pid maps to "" (never "stopped").
  const out = new Map<number, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^"[^"]*","(\d+)"/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n > 0) out.set(n, "");
    }
  }
  return out;
}

function intersect(parsed: Map<number, string>, candidates: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [pid, stat] of parsed) if (candidates.has(pid)) out.set(pid, stat);
  return out;
}

function parseAndCache(
  origin: SessionOrigin,
  result: CaptureResult,
  candidates: number[],
  parser: (stdout: string) => Map<number, string>,
): OriginAnswer {
  const slot = cache[origin];
  const candSet = new Set(candidates);

  // Spawn-level flake: ENOENT, timeout, or anything that prevented the child
  // from running cleanly — including a probe that exited nonzero AND said why.
  // Fall back to the last good answer if recent enough.
  const failed = result.code !== 0 && result.stderr.trim() !== "";
  const flake =
    result.err ?? (result.timedOut ? "timeout" : failed ? `exit ${result.code}: ${result.stderr.trim()}` : undefined);
  if (flake) {
    if (Date.now() - slot.lastAt < CACHE_FALLBACK_MS) {
      return { states: intersect(slot.lastStates, candSet), fromCache: true, error: `${origin}: spawn ${flake}` };
    }
    return { states: new Map(), fromCache: false, error: `${origin}: spawn ${flake}` };
  }

  // Cache only the candidate intersection so the Windows path doesn't store
  // every system PID and the WSL path stays bounded by session count.
  const states = intersect(parser(result.stdout), candSet);
  slot.lastStates = states;
  slot.lastAt = Date.now();
  return { states, fromCache: false };
}

export interface LivenessResult {
  /** Session ids with at least one live record. Conversation-level: several
   *  records can share an id, so this cannot say which RECORD is live. */
  live: Set<string>;
  /** Records whose own process is alive, stopped ones included. What pruning
   *  and the display gate key on. Membership is by object identity, so it is
   *  valid for the `sessions` array of this tick only. */
  liveRecords: Set<SessionInfo>;
  /** Live records whose process is stopped (Ctrl+Z): alive, so their files
   *  stay, but nobody can use them until `fg` — no key, no tab stamp. */
  suspended: Set<SessionInfo>;
  /** Whether any portion of the answer came from a cached fallback. */
  fromCache: boolean;
  /** Diagnostic when something went wrong. */
  error?: string;
}

export async function filterLiveSessions(sessions: SessionInfo[]): Promise<LivenessResult> {
  // Every session with a pid goes through the same probe, bg included. The
  // old exclusion assumed a bg job's pid was the shared --bg-spare daemon; it
  // is not — a CLAIMED job runs as its own dedicated `claude.exe`. Judging bg
  // liveness by json freshness instead made a working job flap on and off the
  // deck, because a busy job stops rewriting its json (observed 2026-08-19:
  // `sessions=9 live=9` → `live=8` with nothing having died).
  const byOrigin: Record<SessionOrigin, number[]> = { wsl: [], windows: [] };
  for (const s of sessions) {
    // Both providers: the Codex bridge now records the real codex pid, so its
    // liveness is the same process question as Claude's rather than a
    // self-reported flag.
    if (s.pid !== undefined && !byOrigin[s.origin].includes(s.pid)) byOrigin[s.origin].push(s.pid);
  }

  const [wslRes, winRes] = await Promise.all([
    checkWslLive(byOrigin.wsl),
    checkWindowsLive(byOrigin.windows),
  ]);
  const { live, liveRecords, suspended } = classifyRecords(sessions, { wsl: wslRes.states, windows: winRes.states });

  const errors = [wslRes.error, winRes.error].filter(Boolean) as string[];
  return {
    live,
    liveRecords,
    suspended,
    fromCache: wslRes.fromCache || winRes.fromCache,
    error: errors.length ? errors.join("; ") : undefined,
  };
}
