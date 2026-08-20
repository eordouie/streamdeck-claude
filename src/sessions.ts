import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";
import type { SessionState } from "./icons/index.js";
import { normaliseTerm, type TerminalKind } from "./terminal-kind.js";
import { derivedTranscriptPath, readFirstUserPrompt, readSessionTitle } from "./transcript-title.js";
import { assignedName, maybeName, NAMER_CWD, touchSidecar } from "./deck-namer.js";
import { bgJobLabel, canonicalTabTitle, PRUNE_GRACE_MS, sidecarMaxAgeMs } from "./naming-policy.js";
import { adoptParkedState, resolveBgOwners } from "./bg-owner.js";
import type { FocusTarget } from "./terminal-focus.js";
import {
  WIN_CODEX_SESSIONS_DIR,
  WIN_SESSIONS_DIR,
  WSL_CODEX_SESSIONS_DIR,
  WSL_CODEX_SESSIONS_DIR_FROM_WIN,
  WSL_SESSIONS_DIR,
  WSL_SESSIONS_DIR_FROM_WIN,
} from "./env.js";
import { interactiveState, parseEventLog, reduceEvents, type DerivedState, type TodoStatus } from "./session-events.js";
import type { AgentProvider, AgentSession } from "./provider-types.js";

export type SessionProvider = "claude" | "codex";

/** WSL or Windows-native session. Claude Code sessions are backed by the
 *  provider's pid JSON; Codex sessions are backed by the bridge records that
 *  its lifecycle hooks maintain. */
export type SessionOrigin = "wsl" | "windows";

export interface SessionSourceDir {
  origin: SessionOrigin;
  provider: SessionProvider;
  path: string;
}

/** Where Claude Code writes per-pid session state. From a Windows-side plugin
 *  we read both the WSL home (over the `\\wsl.localhost\<distro>` UNC) and the
 *  Windows home. From a Linux-side plugin only WSL sessions are visible. */
export const SESSION_SOURCES: SessionSourceDir[] = platform() === "win32"
  ? [
      { origin: "wsl", provider: "claude", path: WSL_SESSIONS_DIR_FROM_WIN },
      { origin: "windows", provider: "claude", path: WIN_SESSIONS_DIR },
      { origin: "wsl", provider: "codex", path: WSL_CODEX_SESSIONS_DIR_FROM_WIN },
      { origin: "windows", provider: "codex", path: WIN_CODEX_SESSIONS_DIR },
    ]
  : [
      { origin: "wsl", provider: "claude", path: WSL_SESSIONS_DIR },
      { origin: "wsl", provider: "codex", path: WSL_CODEX_SESSIONS_DIR },
    ];

/** Surface readdir errors to the polling loop so it can log them once. */
export let lastReadError: string | undefined;

/** Cache of derived state per event-log path. Re-reading + reducing the NDJSON
 *  every tick is wasteful since the log only grows when a hook fires; gate it
 *  on (mtimeMs, size) so unchanged logs short-circuit. Keyed by full path so
 *  wsl/windows source dirs with the same sessionId don't collide. */
interface EventLogCacheEntry {
  mtimeMs: number;
  size: number;
  derived: DerivedState;
}
const eventLogCache = new Map<string, EventLogCacheEntry>();

/** Cache of parsed <pid>.json keyed by full path, gated on (mtimeMs, size) so a
 *  session file unchanged since last tick skips the readFile + JSON.parse — each
 *  read is a round-trip over the slow `\\wsl.localhost\` UNC, and an idle session
 *  doesn't rewrite its json. Only validated sessions are cached. */
interface JsonCacheEntry {
  mtimeMs: number;
  size: number;
  raw: RawSession;
}
const jsonCache = new Map<string, JsonCacheEntry>();
interface CodexJsonCacheEntry {
  mtimeMs: number;
  size: number;
  raw: RawCodexSession;
}
const codexJsonCache = new Map<string, CodexJsonCacheEntry>();

interface RawSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  status?: string;
  updatedAt?: number;
  name?: string;
  /** "interactive" | "bg" (Claude Code 2.1.x). Absent sur les anciennes versions. */
  kind?: string;
  /** Pour les bg en attente : ex. "permission prompt". */
  waitingFor?: string;
  /** bg only: this job's own id. */
  jobId?: string;
  /** interactive only: the bg job this session has parked. */
  parkedJobId?: string;
}

interface RawCodexSession {
  sessionId: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  launchId?: string;
  updatedAt?: number;
  active?: boolean;
  status?: string;
  terminal?: string;
  transcriptPath?: string;
}

export interface SessionInfo extends AgentSession {
  provider: SessionProvider;
  pid?: number;
  sessionId: string;
  cwd: string;
  /** Bottom-line agent tag: "codex" for Codex, absent for Claude. Ehsan's call
   *  (2026-08-17, after seeing both labelled): the tag exists to mark the
   *  EXCEPTION, and writing `claude` on almost every tile is noise on a 72px key
   *  — you can read a bare tile as Claude. Model and effort were tried here and
   *  removed for the same reason. */
  providerLabel?: string;
  /** Project label. For a bg job: its Claude Code `name` if set, else
   *  basename(cwd) — see `bgJobLabel`. For an interactive session: basename(cwd),
   *  replaced by the one-word deck name once the namer assigns one. */
  label: string;
  startedAt: number;
  rawStatus: "busy" | "idle" | "waiting";
  /** Awaiting a generic input notification from the user (elicitation_dialog,
   *  or any in-turn Notification with no/unknown notifType). */
  awaiting: boolean;
  /** Awaiting tool-permission approval (Notification[permission_prompt]). */
  awaitingPermission: boolean;
  /** Awaiting answer to an AskUserQuestion UI prompt (PreToolUse fired but no
   *  matching PostToolUse yet). */
  awaitingQuestion: boolean;
  /** Awaiting plan approval (ExitPlanMode tool used). */
  awaitingPlan: boolean;
  /** Last turn ended with StopFailure and no UserPromptSubmit since. */
  errored: boolean;
  /** At least one subagent currently running. */
  subagentActive: boolean;
  /** Snapshot of the last TodoWrite call's statuses; empty if none seen. */
  todos: TodoStatus[];
  /** Outstanding background-agent start timestamps (cross-turn, TTL-aged by
   *  the renderer via liveBgAgents) — drives the +N agents badge. */
  bgAgentStarts: number[];
  origin: SessionOrigin;
  /** Terminal host (from the event-log SessionStart stamp); drives slot-press focus. */
  terminal: TerminalKind;
  /** Transcript path (from the event-log SessionStart stamp); "" when unknown. */
  transcriptPath: string;
  /** The session's Claude-generated/custom title ("" when none yet). Context
   *  for the one-time deck name; NOT used for tab focus — the plugin stamps
   *  its own tab titles (see tab-title.ts). */
  title: string;
  /** First substantial prompt (from the event log) — deck-name context. */
  firstPrompt: string;
  /** The session's one-time deck word once assigned, else "". Unique among
   *  live sessions by construction (the namer forbids taken words), which is
   *  what lets it double as the tab's identity. */
  deckName: string;
  /** "interactive" par défaut si le json n'a pas de champ `kind`. */
  kind: "interactive" | "bg";
  /** Statut brut NON coercé du json pour les bg (ex. "waiting", "running"). undefined pour interactive ; à ne pas confondre avec rawStatus (coercé "busy"|"idle", inutilisé pour les bg). */
  bgStatus?: string;
  /** `waitingFor` du json pour les bg (ex. "permission prompt"). */
  bgWaitingFor?: string;
  /** bg only: this job's own id (see bg-owner.ts). */
  jobId?: string;
  /** interactive only: the bg job this session has parked. */
  parkedJobId?: string;
  /** bg only: where a slot press should land. A bg job has no tab of its own,
   *  so it borrows the tab of the interactive session that parked it.
   *  undefined when that session is gone — the press reports that instead of
   *  walking a focus chain that cannot match. Resolved in readAllSessions. */
  owner?: FocusTarget;
  /** mtime logique du json (ms) si le json l'expose. Utilisé pour la liveness des bg (fraîcheur). */
  updatedAt?: number;
  /** Codex bridge records remain on disk after SessionEnd so the tracker can
   *  render the same short `finished` state as Claude sessions. */
  active?: boolean;
}

const isPositiveInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x > 0;

function basename(p: string): string {
  if (!p) return "";
  // Handle both `/` and `\` since Windows sessions report `D:\dev\foo`.
  const m = p.replace(/[\\/]+$/, "").match(/[^\\/]+$/);
  return m ? m[0] : p;
}

async function readOneSource(src: SessionSourceDir): Promise<SessionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(src.path);
  } catch (err) {
    lastReadError = `${src.origin}: ${err instanceof Error ? err.message : String(err)}`;
    return [];
  }
  const out: SessionInfo[] = [];
  await Promise.all(
    entries
      .filter((f) => /^\d+\.json$/.test(f))
      .map(async (f) => {
        const path = join(src.path, f);
        let raw: RawSession;
        try {
          const st = await stat(path);
          const cached = jsonCache.get(path);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
            raw = cached.raw;
          } else {
            const parsed = JSON.parse(await readFile(path, "utf8")) as RawSession;
            if (!isPositiveInt(parsed.pid) || typeof parsed.sessionId !== "string" || typeof parsed.cwd !== "string") {
              return;
            }
            jsonCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, raw: parsed });
            raw = parsed;
          }
        } catch {
          return;
        }
        // The deck-namer's own headless sessions run from a sentinel cwd —
        // showing them would flash slots and recursively trigger naming.
        if (raw.cwd === NAMER_CWD) return;

        // "waiting" passes through: CC sets it while a user-facing dialog
        // (AskUserQuestion) is open, and coercing it to idle masked the
        // question on the key. Anything else unknown still reads idle.
        const status = raw.status === "busy" || raw.status === "waiting" ? raw.status : "idle";
        const kind: "interactive" | "bg" = raw.kind === "bg" ? "bg" : "interactive";

        let derived: DerivedState = {
          awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: false, subagentDepth: 0, todos: [], bgAgentStartTimes: [], terminal: "unknown", transcriptPath: "", firstPrompt: "",
        };
        // Un agent bg tourne en headless et ne nourrit pas le pipeline de hooks :
        // son json (status/waitingFor) est la source de vérité. On saute donc
        // entièrement la lecture/réduction de l'event-log pour les bg.
        if (kind !== "bg") {
          const eventsPath = join(src.path, `${raw.sessionId}.events.ndjson`);
          try {
            const st = await stat(eventsPath);
            const cached = eventLogCache.get(eventsPath);
            if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
              derived = cached.derived;
            } else {
              const text = await readFile(eventsPath, "utf8");
              derived = reduceEvents(parseEventLog(text));
              eventLogCache.set(eventsPath, { mtimeMs: st.mtimeMs, size: st.size, derived });
            }
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") {
              streamDeck.logger.warn(
                `event-log read failed ${src.origin}/${raw.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            // no event log yet (ENOENT) — defaults are fine; don't cache
          }
        }

        // The title is read unconditionally (stat-cached): titled-ness decides
        // the slot-press focus strategy, and the title is deck-name context.
        // The label here is only the interim placeholder — readAllSessions
        // overwrites it with the one-time deck name once one is assigned.
        let title = "";
        let firstPrompt = derived.firstPrompt;
        if (kind !== "bg") {
          const transcriptPath =
            derived.transcriptPath || derivedTranscriptPath(raw.cwd, raw.sessionId);
          title = await readSessionTitle(transcriptPath);
          // Resumed sessions: SessionStart truncated the events log, so a
          // session driven only by trivial openers ("continue") never
          // re-earns a firstPrompt from events — mine the transcript's
          // original one so the namer still has context.
          if (!firstPrompt) firstPrompt = await readFirstUserPrompt(transcriptPath);
        }

        out.push({
          provider: "claude",
          pid: raw.pid,
          sessionId: raw.sessionId,
          cwd: raw.cwd,
          // A bg job keeps this label for its whole life (the namer skips bg), so
          // it uses the job's OWN name when Claude Code has given it one. The cwd
          // basename is "projects" for every job started here, which tells the
          // user nothing about which job the tile is.
          label:
            kind === "bg"
              ? bgJobLabel(typeof raw.name === "string" ? raw.name : undefined, basename(raw.cwd))
              : basename(raw.cwd),
          title,
          firstPrompt,
          deckName: "",
          startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
          rawStatus: status,
          kind,
          bgStatus: kind === "bg" ? raw.status : undefined,
          bgWaitingFor: kind === "bg" ? raw.waitingFor : undefined,
          jobId: kind === "bg" ? raw.jobId : undefined,
          parkedJobId: kind === "bg" ? undefined : raw.parkedJobId,
          updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
          awaiting: derived.awaiting,
          awaitingPermission: derived.awaitingPermission,
          awaitingQuestion: derived.awaitingQuestion,
          awaitingPlan: derived.awaitingPlan,
          errored: derived.errored,
          subagentActive: derived.subagentDepth > 0,
          todos: derived.todos,
          bgAgentStarts: derived.bgAgentStartTimes,
          origin: src.origin,
          terminal: derived.terminal,
          transcriptPath: derived.transcriptPath,
          launchId: derived.launchId,
        });
      }),
  );
  return out;
}

/** Reads the small records written by hooks/codex-notification.sh. Codex does
 * not expose Claude Code's per-pid session directory, so the bridge owns the
 * record and marks it inactive on SessionEnd. Event reduction stays shared. */
async function readOneCodexSource(src: SessionSourceDir): Promise<SessionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(src.path);
  } catch (err) {
    // Codex support is optional; an absent ~/.codex/streamdeck directory is a
    // normal first-run state and should not make the Claude setup key warn.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      lastReadError = `${src.origin}/codex: ${err instanceof Error ? err.message : String(err)}`;
    }
    return [];
  }

  const out: SessionInfo[] = [];
  await Promise.all(
    entries
      .filter((f) => /^[A-Za-z0-9._-]+\.json$/.test(f))
      .map(async (f) => {
        const path = join(src.path, f);
        let raw: RawCodexSession;
        try {
          const st = await stat(path);
          const cached = codexJsonCache.get(path);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
            raw = cached.raw;
          } else {
            const parsed = JSON.parse(await readFile(path, "utf8")) as RawCodexSession;
            if (
              typeof parsed.sessionId !== "string" ||
              !/^[A-Za-z0-9._-]+$/.test(parsed.sessionId) ||
              typeof parsed.cwd !== "string" ||
              typeof parsed.startedAt !== "number"
            ) return;
            codexJsonCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, raw: parsed });
            raw = parsed;
          }
        } catch {
          return;
        }

        const eventsPath = join(src.path, `${raw.sessionId}.events.ndjson`);
        let derived: DerivedState = {
          awaiting: false,
          awaitingPermission: false,
          awaitingQuestion: false,
          awaitingPlan: false,
          errored: false,
          subagentDepth: 0,
          todos: [],
          bgAgentStartTimes: [],
          terminal: "unknown",
          transcriptPath: "",
          firstPrompt: "",
        };
        try {
          const st = await stat(eventsPath);
          const cached = eventLogCache.get(eventsPath);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
            derived = cached.derived;
          } else {
            derived = reduceEvents(parseEventLog(await readFile(eventsPath, "utf8")));
            eventLogCache.set(eventsPath, { mtimeMs: st.mtimeMs, size: st.size, derived });
          }
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
            streamDeck.logger.warn(
              `codex event-log read failed ${src.origin}/${raw.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const transcriptPath = derived.transcriptPath || raw.transcriptPath || "";
        const title = await readSessionTitle(transcriptPath);
        out.push({
          provider: "codex",
          pid: typeof raw.pid === "number" && raw.pid > 0 ? raw.pid : undefined,
          sessionId: raw.sessionId,
          cwd: raw.cwd,
          // No "codex-" prefix in the label: the bottom line carries the agent
          // tag, which frees the top line to be the project/deck word exactly
          // like Claude's slots.
          label: basename(raw.cwd),
          providerLabel: "codex",
          title,
          firstPrompt: derived.firstPrompt,
          deckName: "",
          startedAt: raw.startedAt,
          rawStatus: raw.status === "busy" || raw.status === "waiting" ? raw.status : "idle",
          kind: "interactive",
          updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
          active: raw.active !== false,
          awaiting: derived.awaiting,
          awaitingPermission: derived.awaitingPermission,
          awaitingQuestion: derived.awaitingQuestion,
          awaitingPlan: derived.awaitingPlan,
          errored: derived.errored,
          subagentActive: derived.subagentDepth > 0,
          todos: derived.todos,
          bgAgentStarts: derived.bgAgentStartTimes,
          origin: src.origin,
          terminal: derived.terminal === "unknown" ? normaliseTerm(raw.terminal) : derived.terminal,
          transcriptPath,
          launchId: derived.launchId ?? raw.launchId,
        });
      }),
  );
  return out;
}

/** Read only the Claude sources. Provider adapters own the public boundary;
 * this function keeps the existing source/cache implementation private to the
 * session reader while the registry remains provider-neutral. */
export async function readClaudeSessions(): Promise<SessionInfo[]> {
  const results = await Promise.all(
    SESSION_SOURCES.filter((src) => src.provider === "claude").map((src) => readOneSource(src)),
  );
  return results.flat();
}

/** Read only the Codex bridge sources. An absent Codex directory is a normal
 * first-run state and is handled by the source reader. */
export async function readCodexSessions(): Promise<SessionInfo[]> {
  const results = await Promise.all(
    SESSION_SOURCES.filter((src) => src.provider === "codex").map((src) => readOneCodexSource(src)),
  );
  return results.flat();
}

/** Reads all registered provider sources. Stale (dead-pid) files are still
 * returned; liveness filtering happens upstream. Naming and cache cleanup stay
 * here because they are shared experience rules, not provider mechanics. */
export async function readAllSessions(
  providers: readonly Pick<AgentProvider, "readSessions">[],
): Promise<SessionInfo[]> {
  lastReadError = undefined;
  const results = await Promise.all(providers.map((provider) => provider.readSessions()));
  const sessions = results.flat() as unknown as SessionInfo[];

  // Deck names: apply each session's one-time word as its label; sessions
  // that have context but no word yet get a (deduped, fire-and-forget)
  // naming call. The word never changes once assigned.
  // Both providers are named from the same word pool. Codex used to be excluded
  // here, which left it with no deck word, no word in its tab title, and a
  // cwd-basename label — three visible differences for no reason. Sharing the
  // pool also keeps words unique ACROSS providers, which matters because the
  // words are what the user says out loud to mean a particular session.
  const words = await Promise.all(sessions.map((s) => assignedName(s.sessionId)));
  const taken = words.filter(Boolean);
  const liveSids: ReadonlySet<string> = new Set(sessions.map((s) => s.sessionId));
  sessions.forEach((s, i) => {
    if (s.kind === "bg") return;
    if (words[i]) {
      s.label = words[i];
      s.deckName = words[i];
      touchSidecar(s.sessionId);
    } else {
      maybeName({ sessionId: s.sessionId, firstPrompt: s.firstPrompt, title: s.title, takenWords: taken, liveSids });
    }
  });
  // Owner links for bg jobs, resolved AFTER naming: the owner's canonical tab
  // title embeds its deck word, and the press matches that title exactly.
  const owners = resolveBgOwners(sessions);
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  for (const s of sessions) {
    if (s.kind !== "bg") continue;
    const owner = byId.get(owners.get(s.sessionId) ?? "");
    if (!owner) {
      s.owner = undefined;
      continue;
    }
    s.owner = {
      cwd: owner.cwd,
      terminal: owner.terminal,
      origin: owner.origin,
      pid: owner.pid,
      canonicalTitle: canonicalTabTitle(owner),
    };
  }
  // Prune cache entries whose session is gone (SessionEnd unlinked the log, or
  // the .json disappeared) so the maps stay bounded by live-session count.
  const expectedLogs = new Set<string>();
  const expectedJson = new Set<string>();
  for (const s of sessions) {
    const src = SESSION_SOURCES.find((d) => d.origin === s.origin && d.provider === s.provider);
    if (!src) continue;
    expectedLogs.add(join(src.path, `${s.sessionId}.events.ndjson`));
    if (s.provider === "claude" && s.pid !== undefined) expectedJson.add(join(src.path, `${s.pid}.json`));
  }
  for (const key of eventLogCache.keys()) {
    if (!expectedLogs.has(key)) eventLogCache.delete(key);
  }
  for (const key of jsonCache.keys()) {
    if (!expectedJson.has(key)) jsonCache.delete(key);
  }
  const expectedCodexJson = new Set(
    sessions.filter((s) => s.provider === "codex").map((s) => {
      const src = SESSION_SOURCES.find((d) => d.origin === s.origin && d.provider === s.provider);
      return src ? join(src.path, `${s.sessionId}.json`) : "";
    }),
  );
  for (const key of codexJsonCache.keys()) {
    if (!expectedCodexJson.has(key)) codexJsonCache.delete(key);
  }
  return sessions;
}

// PRUNE_GRACE_MS lives in naming-policy.ts now, shared with the sidecar
// GC policy (sidecarMaxAgeMs) so the two horizons stay side by side.

/** Deletes the on-disk <pid>.json (and its now-orphan <sid>.events.ndjson) for
 *  every interactive session whose process is no longer live and whose file is
 *  older than PRUNE_GRACE_MS, bounding `~/.claude/sessions/` to live + just-died
 *  sessions instead of letting dead files pile up unread-but-re-stat'd forever.
 *  bg jobs are pruned too: a CLAIMED job's <pid>.json names its own dedicated
 *  `claude.exe` process, not the shared --bg-spare daemon the old exclusion was
 *  written for, so the file↔process mapping holds there as well. Best-effort —
 *  every unlink
 *  error is swallowed and simply retried next tick. Returns the count removed. */
export async function pruneDeadSessions(
  sessions: SessionInfo[],
  liveIds: Set<string>,
  now: number,
): Promise<number> {
  let pruned = 0;
  await Promise.all(
    sessions
      .filter((s) => !liveIds.has(s.sessionId))
      .map(async (s) => {
        const src = SESSION_SOURCES.find((d) => d.origin === s.origin && d.provider === s.provider);
        if (!src) return;
        const jsonPath = join(src.path, s.provider === "codex" ? `${s.sessionId}.json` : `${s.pid}.json`);
        try {
          const st = await stat(jsonPath);
          if (now - st.mtimeMs < PRUNE_GRACE_MS) return; // too fresh to be sure it's dead junk
        } catch {
          return; // already gone or unreadable
        }
        try {
          await unlink(jsonPath);
          pruned++;
        } catch {
          return; // lost a race / no permission — leave the orphan log, retry next tick
        }
        const eventsPath = join(src.path, `${s.sessionId}.events.ndjson`);
        try {
          await unlink(eventsPath);
        } catch {
          /* ENOENT or already gone — fine */
        }
        // The .deckname sidecar deliberately survives its session: plain
        // `claude --resume` reuses the sid, so the word is reclaimed across
        // reboots. Dormant sidecars age out via sidecarMaxAgeMs in the
        // orphan sweep below.
        jsonCache.delete(jsonPath);
        codexJsonCache.delete(jsonPath);
        eventLogCache.delete(eventsPath);
      }),
  );

  // Orphan sweep: sidecars whose sid has NO session file at all. Two real
  // producers: CC rotating a process's sessionId on /clear (the old sid's
  // events/deckname are never referenced again — sids are UUIDs and never
  // reused, despite what an older comment here claimed), and SessionEnd not
  // firing (crash, SIGKILL, bg agents). Event logs are grace-gated like the
  // main prune; .deckname files persist DECKNAME_MAX_AGE_MS so dormant
  // conversations stay resumable by name.
  const sids = new Set(sessions.map((s) => `${s.provider}:${s.sessionId}`));
  await Promise.all(
    SESSION_SOURCES.map(async (src) => {
      let entries: string[];
      try {
        entries = await readdir(src.path);
      } catch {
        return;
      }
      await Promise.all(
        entries
          .map((f) => f.match(/^(.+?)\.(events\.ndjson|deckname)$/))
          .filter((m): m is RegExpMatchArray => m !== null && !sids.has(`${src.provider}:${m[1]}`))
          .map(async (m) => {
            const p = join(src.path, m[0]);
            try {
              const st = await stat(p);
              if (now - st.mtimeMs < sidecarMaxAgeMs(m[0])) return;
              await unlink(p);
              eventLogCache.delete(p);
              pruned++;
            } catch {
              /* raced or unreadable — retry next tick */
            }
          }),
      );
    }),
  );
  return pruned;
}

/** Resets one `<sid>.events.ndjson` from the source dir matching `origin`.
 *  Idempotent (ENOENT counts as success) so a long-press reset on a slot whose
 *  agent hasn't emitted anything yet still feels like it "worked".
 *
 *  "Reset", not "unlink": the log's SessionStart line carries the terminal
 *  kind and transcript path, stamped once per session — a full wipe used to
 *  demote the session to terminal "unknown" for the rest of its life, which
 *  downgraded slot-press focus to the guessing chain (and could raise the
 *  wrong app). Keeping just that line resets the derived state without
 *  amputating the session's identity. */
export async function wipeSessionEventLog(
  sessionId: string,
  origin: SessionOrigin,
  provider: SessionProvider = "claude",
): Promise<{ wiped: boolean; error?: string }> {
  const src = SESSION_SOURCES.find((s) => s.origin === origin && s.provider === provider);
  if (!src) return { wiped: false, error: `no source for ${provider}/${origin}` };
  const path = join(src.path, `${sessionId}.events.ndjson`);
  try {
    const first = (await readFile(path, "utf8")).split("\n", 1)[0] ?? "";
    const keep = first.includes('"event":"SessionStart"') ? `${first}\n` : "";
    await writeFile(path, keep);
    eventLogCache.delete(path);
    return { wiped: true };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { wiped: true };
    return { wiped: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Unlinks every `<sid>.events.ndjson` across all configured source dirs.
 *  Safe to call any time: hooks just recreate the files on the next event.
 *  Used by the Setup action to force every slot back to a clean idle state. */
export async function wipeAllEventLogs(): Promise<{ wiped: number; errors: string[] }> {
  let wiped = 0;
  const errors: string[] = [];
  await Promise.all(
    SESSION_SOURCES.map(async (src) => {
      let entries: string[];
      try {
        entries = await readdir(src.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT" && src.provider === "codex") return;
        errors.push(`${src.provider}/${src.origin}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const targets = entries.filter((f) => f.endsWith(".events.ndjson"));
      await Promise.all(
        targets.map(async (f) => {
          try {
            await unlink(join(src.path, f));
            wiped++;
          } catch (err) {
            errors.push(`${src.provider}/${src.origin}/${f}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }),
  );
  return { wiped, errors };
}

/** State for the icon, derived from session status + event-log projection + liveness.
 *  Priority: finished > error > awaiting_plan > awaiting_permission >
 *  awaiting_question > awaiting > subagent > working > idle. Plan approval ranks
 *  first among "needs you" states because users can sit on it longest; the more
 *  specific flags (permission, question) win over the generic catch-all so the
 *  distinct icon shows up.
 *
 *  The interactive status+flags decision lives in session-events.ts's
 *  interactiveState — pure and unit-tested there (this module sits behind the
 *  SDK import chain). Its doc comment carries the busy/waiting/idle
 *  rationale, including why an interrupt's stale flags must read idle. */
export function deriveState(s: SessionInfo, alive: boolean, parkedState?: SessionState): SessionState {
  if (!alive) return "finished";
  if (s.kind === "bg") return deriveBgState(s);
  if (s.errored) return "error";
  const own = interactiveState(s.rawStatus, s);
  // A session that parked a job reports `idle` truthfully — its own turn loop
  // is not running — but its WORK is in flight on a bg tile the user cannot
  // reach. Adopt that activity here so the reachable key is the one that shows
  // it. Only over `idle`: the session's own turn always outranks a delegate's.
  if (own === "idle" && parkedState !== undefined) return adoptParkedState(parkedState);
  return own;
}

/** Mappe le json d'un agent bg vers un état bg_*. Table best-effort (un seul
 *  échantillon connu : status="waiting"/waitingFor="permission prompt") ; tout
 *  statut non-terminal inconnu retombe sur bg_idle. Les statuts terminaux sont
 *  déjà filtrés en amont par la liveness (→ finished/retiré), donc absents ici. */
function deriveBgState(s: SessionInfo): SessionState {
  const waitingFor = (s.bgWaitingFor ?? "").toLowerCase();
  if (waitingFor.includes("permission")) return "bg_awaiting_permission";
  const status = (s.bgStatus ?? "").toLowerCase();
  if (status === "waiting") return "bg_awaiting";
  if (status === "busy" || status === "running") return "bg_working";
  return "bg_idle";
}
