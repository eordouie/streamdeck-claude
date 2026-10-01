/**
 * Liveness per PROCESS, for session records.
 *
 * A session id names a conversation, not a process, and one conversation can
 * have several `<pid>.json` records at once: `claude -c` / `--resume` in a tab
 * whose earlier process is suspended (Ctrl+Z) or died without cleaning up.
 * Liveness used to be a set of session ids, so EVERY record of a live
 * conversation counted as live — a suspended or dead twin got its own key, and
 * pruning (same id test) never deleted it. Measured 2026-10-01: pid 69552,
 * stopped since Sep 28, held a second `crucible` key beside the live 67318 for
 * three days, and both pids stamped the one tab they share in turn.
 *
 * Deliberately SDK-free (node builtins only), so the rules run under
 * `tsx --test` — see naming-policy.ts for why that matters.
 */

export type RecordOrigin = "wsl" | "windows";

/** pid → `ps` stat column ("" where the probe cannot say, e.g. tasklist). */
export type ProcessStates = ReadonlyMap<number, string>;

/** The fields liveness reads; SessionInfo satisfies it. */
export interface LivenessRecord {
  provider: string;
  sessionId: string;
  pid?: number;
  origin: RecordOrigin;
  kind: "interactive" | "bg";
  bgStatus?: string;
  active?: boolean;
}

export interface RecordLiveness<T> {
  /** Conversations with at least one live record — the id-keyed bookkeeping
   *  (attention, finished carry-over) still reasons per conversation. */
  live: Set<string>;
  /** Records whose OWN process is alive, stopped ones included: their files
   *  must survive, because `fg` resumes them. */
  liveRecords: Set<T>;
  /** Live records whose process is stopped: no key, no tab stamp. */
  suspended: Set<T>;
}

/** Parses `ps -o pid=,stat=` output. A pid absent from it is not running. */
export function parsePsStates(stdout: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s*(\S*)/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    if (Number.isInteger(pid) && pid > 0) out.set(pid, match[2]);
  }
  return out;
}

/** Stopped by job control (Ctrl+Z, SIGSTOP, a background read) or by a
 *  tracer: `T` on macOS and Linux, `t` for Linux tracing stops. A stopped
 *  process passes `kill -0`, which is how a suspended Claude kept a key. */
export function isStoppedStat(stat: string): boolean {
  return stat.startsWith("T") || stat.startsWith("t");
}

/** Statuses a bg job reports once it is done; its process may still be
 *  winding down. Best-effort list (cf. spec §6). */
const TERMINAL_BG_STATUS = new Set(["completed", "failed", "cancelled", "done"]);

const isTerminalBgStatus = (status: string | undefined): boolean =>
  TERMINAL_BG_STATUS.has((status ?? "").toLowerCase());

export function classifyRecords<T extends LivenessRecord>(
  records: readonly T[],
  states: Readonly<Record<RecordOrigin, ProcessStates>>,
): RecordLiveness<T> {
  const live = new Set<string>();
  const liveRecords = new Set<T>();
  const suspended = new Set<T>();
  for (const record of records) {
    let alive: boolean;
    let stopped = false;
    if (record.pid !== undefined) {
      const stat = states[record.origin].get(record.pid);
      alive = stat !== undefined && !(record.kind === "bg" && isTerminalBgStatus(record.bgStatus));
      stopped = stat !== undefined && isStoppedStat(stat);
    } else {
      // No pid at all — reached today only by a Codex bridge record whose hook
      // found no codex ancestor. Such a record can only be judged by its own
      // flag, which SessionEnd clears. `=== true`, not `!== false`: a record
      // that never mentions liveness (every Claude record) must read dead, or
      // the phantom-tile bug comes back.
      alive = record.active === true;
    }
    if (!alive) continue;
    live.add(record.sessionId);
    liveRecords.add(record);
    if (stopped) suspended.add(record);
  }
  return { live, liveRecords, suspended };
}

/** Dead records to delete, and whether each one's events log goes with it.
 *  `<sid>.events.ndjson` belongs to the CONVERSATION — every record of that
 *  session id appends to it — so it stays while any of them is alive. */
export function pruneCandidates<T extends LivenessRecord>(
  records: readonly T[],
  liveRecords: ReadonlySet<T>,
): Array<{ record: T; dropEventsLog: boolean }> {
  const conversation = (r: LivenessRecord): string => `${r.provider}:${r.origin}:${r.sessionId}`;
  const liveConversations = new Set([...liveRecords].map(conversation));
  return records
    .filter((record) => !liveRecords.has(record))
    .map((record) => ({ record, dropEventsLog: !liveConversations.has(conversation(record)) }));
}
