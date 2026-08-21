import { platform } from "node:os";
import type { SessionInfo, SessionOrigin } from "./sessions.js";
import { WSL_DISTRO } from "./env.js";
import { spawnCapture, type CaptureResult } from "./spawn-capture.js";

/**
 * Returns the subset of sessions whose process is currently running.
 *
 * WSL sessions are checked via `wsl.exe -d <distro> -- kill -0`. Windows-native
 * sessions are checked via `tasklist.exe /FO CSV` — those PIDs live in a
 * different process namespace and aren't visible to WSL. Both checks run in
 * parallel.
 *
 * Spawn-level failures (ENOENT, timeout, …) are absorbed for CACHE_FALLBACK_MS
 * using the previous good answer per origin, so a single flaky `wsl.exe` start
 * doesn't flicker every slot to "finished". Cleanly-empty stdout is NOT a
 * fallback trigger — for `kill -0` (per-PID echo) empty means all candidates
 * are dead, and for `tasklist` empty essentially never happens in practice.
 */

interface OriginCache {
  /** PIDs from the last successful tick, already intersected with the candidate list. */
  lastLive: Set<number>;
  lastLiveAt: number;
}
const CACHE_FALLBACK_MS = 10_000;
const cache: Record<SessionOrigin, OriginCache> = {
  wsl: { lastLive: new Set(), lastLiveAt: 0 },
  windows: { lastLive: new Set(), lastLiveAt: 0 },
};

/** Statuts bg considérés comme terminaux → le job est fini, on le retire.
 *  Best-effort (cf. spec §6) ; à confirmer en observant d'autres jobs. */
const TERMINAL_BG_STATUS = new Set(["completed", "failed", "cancelled", "done"]);

const isTerminalBgStatus = (status: string | undefined): boolean =>
  TERMINAL_BG_STATUS.has((status ?? "").toLowerCase());

async function checkWslLive(pids: number[]): Promise<{ live: Set<number>; error?: string; fromCache: boolean }> {
  if (pids.length === 0) return { live: new Set(), fromCache: false };
  const script = pids.map((p) => `kill -0 ${p} 2>/dev/null && echo ${p}`).join("; ");
  const cmd = platform() === "win32" ? "wsl.exe" : "bash";
  const args = platform() === "win32" ? ["-d", WSL_DISTRO, "--", "bash", "-c", script] : ["-c", script];
  return parseAndCache("wsl", await spawnCapture(cmd, args), pids, parsePidsFromLines);
}

async function checkWindowsLive(pids: number[]): Promise<{ live: Set<number>; error?: string; fromCache: boolean }> {
  if (pids.length === 0) return { live: new Set(), fromCache: false };
  if (platform() !== "win32") {
    // Linux-side plugin can't enumerate Windows processes; assume alive (best-effort).
    return { live: new Set(pids), fromCache: false, error: "windows-liveness skipped on linux host" };
  }
  // tasklist treats multiple `/FI "PID eq <n>"` filters as AND (no row matches
  // multiple PIDs simultaneously), so we can't batch-filter. Cheaper to dump
  // every process once and intersect ourselves than to spawn N processes.
  const all = await spawnCapture("tasklist.exe", ["/NH", "/FO", "CSV"]);
  return parseAndCache("windows", all, pids, parsePidsFromCsv);
}

function parsePidsFromLines(stdout: string): Set<number> {
  const out = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const n = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

function parsePidsFromCsv(stdout: string): Set<number> {
  // tasklist CSV row:  "claude.exe","109164","Console","1","443 040 Ko"
  const out = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^"[^"]*","(\d+)"/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n > 0) out.add(n);
    }
  }
  return out;
}

function intersect(parsed: Set<number>, candidates: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const p of parsed) if (candidates.has(p)) out.add(p);
  return out;
}

function parseAndCache(
  origin: SessionOrigin,
  result: CaptureResult,
  candidates: number[],
  parser: (stdout: string) => Set<number>,
): { live: Set<number>; error?: string; fromCache: boolean } {
  const slot = cache[origin];
  const candSet = new Set(candidates);

  // Spawn-level flake: ENOENT, timeout, or anything that prevented the child
  // from running cleanly. Fall back to the last good answer if recent enough.
  const flake = result.err ?? (result.timedOut ? "timeout" : undefined);
  if (flake) {
    if (Date.now() - slot.lastLiveAt < CACHE_FALLBACK_MS) {
      return { live: intersect(slot.lastLive, candSet), fromCache: true, error: `${origin}: spawn ${flake}` };
    }
    return { live: new Set(), fromCache: false, error: `${origin}: spawn ${flake}` };
  }

  // Cache only the candidate intersection so the Windows path doesn't store
  // every system PID and the WSL path stays bounded by session count.
  const live = intersect(parser(result.stdout), candSet);
  slot.lastLive = live;
  slot.lastLiveAt = Date.now();
  return { live, fromCache: false };
}

export interface LivenessResult {
  /** Set of sessionIds whose process is currently alive. */
  live: Set<string>;
  /** Whether any portion of the answer came from a cached fallback. */
  fromCache: boolean;
  /** Diagnostic when something went wrong. */
  error?: string;
}

export async function filterLiveSessions(sessions: SessionInfo[]): Promise<LivenessResult> {
  // Every session with a pid goes through the same `kill -0`, bg included. The
  // old exclusion assumed a bg job's pid was the shared --bg-spare daemon; it
  // is not — a CLAIMED job runs as its own dedicated `claude.exe`. Judging bg
  // liveness by json freshness instead made a working job flap on and off the
  // deck, because a busy job stops rewriting its json (observed 2026-08-19:
  // `sessions=9 live=9` → `live=8` with nothing having died).
  const byOrigin: Record<SessionOrigin, number[]> = { wsl: [], windows: [] };
  for (const s of sessions) {
    // Both providers: the Codex bridge now records the real codex pid, so its
    // liveness is the same `kill -0` question as Claude's rather than a
    // self-reported flag.
    if (s.pid !== undefined) byOrigin[s.origin].push(s.pid);
  }

  const [wslRes, winRes] = await Promise.all([
    checkWslLive(byOrigin.wsl),
    checkWindowsLive(byOrigin.windows),
  ]);

  const live = new Set<string>();
  for (const s of sessions) {
    if (s.kind === "bg") {
      // Pid check AND a non-terminal status: a job reporting itself completed
      // is done even while its process is still winding down.
      const livePids = s.origin === "wsl" ? wslRes.live : winRes.live;
      if (s.pid !== undefined && livePids.has(s.pid) && !isTerminalBgStatus(s.bgStatus)) {
        live.add(s.sessionId);
      }
      continue;
    }
    if (s.pid !== undefined) {
      // Identical treatment for both providers.
      const livePids = s.origin === "wsl" ? wslRes.live : winRes.live;
      if (livePids.has(s.pid)) live.add(s.sessionId);
      continue;
    }
    // No pid at all. Reached today only by a Codex bridge record whose hook
    // found no codex ancestor to attribute, but the rule needs no provider name:
    // a record that carries no pid can only be judged by its own liveness flag,
    // which SessionEnd clears. Claude records take their pid from the filename
    // and never land here. Weaker than a pid check — a hard-killed session with
    // no SessionEnd lingers until its record is pruned — but strictly better
    // than dropping a live session off the deck, and it now holds for any future
    // agent that reports itself the same way.
    //
    // `=== true`, not `!== false`: the flag must be a POSITIVE claim. Only the
    // Codex reader sets it (`active: raw.active !== false`), so a record that
    // never mentions liveness — every Claude record — must fall through as dead
    // rather than be treated as live forever. That inversion is how the phantom
    // Codex tile worked, and it is not worth re-inventing here.
    if (s.active === true) live.add(s.sessionId);
  }

  const errors = [wslRes.error, winRes.error].filter(Boolean) as string[];
  return {
    live,
    fromCache: wslRes.fromCache || winRes.fromCache,
    error: errors.length ? errors.join("; ") : undefined,
  };
}
