import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Pure naming policy: what a session's terminal tab is called, and how long
 * its one-word deck name outlives the session on disk.
 *
 * Deliberately SDK-free: `@elgato/streamdeck` reads manifest.json at import
 * time and crashes under `tsx --test` — and a test file that dies on import
 * is reported as one PASSING test. Anything unit-tested must stay importable
 * from bare node, so this module's imports are node builtins only.
 */

/** Canonical tab name for a session: `claude-<pid>` while unnamed, extended
 *  to `claude-<pid>-<word>` once the one-word deck name is assigned. NEVER
 *  the display label — that falls back to the cwd basename, which every
 *  session in the same directory would share, and a shared name is exactly
 *  the ambiguity this whole mechanism exists to kill. The pid keeps the full
 *  title unique even if two live sessions ever carry the same word (possible
 *  since persisted words of dormant conversations may be reused). */
export function canonicalTabTitle(session: { pid: number; deckName: string }): string {
  const word = session.deckName.trim();
  return /^[\w-]{1,24}$/.test(word) ? `claude-${session.pid}-${word}` : `claude-${session.pid}`;
}

/** Grace before a confirmed-dead session's <pid>.json / events log is deleted.
 *  A dead file never changes yet pre-prune was re-read every tick over the
 *  slow UNC; we wait this long past the last write so we never race a session
 *  that just dropped its json but whose first liveness probe flaked. */
export const PRUNE_GRACE_MS = 60_000;

/** How long a .deckname sidecar outlives its session, so `claude --resume`
 *  of the same conversation (plain resume reuses the sid) reclaims its word
 *  across reboots. Live sessions' sidecars are mtime-touched (deck-namer's
 *  touchSidecar), so this measures time-since-last-alive, not
 *  time-since-named. */
export const DECKNAME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** GC horizon for an orphaned sidecar file, by kind: deck names persist for
 *  resume; event logs are junk within a minute of death. */
export function sidecarMaxAgeMs(filename: string): number {
  return filename.endsWith(".deckname") ? DECKNAME_MAX_AGE_MS : PRUNE_GRACE_MS;
}

/** Words currently owned by LIVE sessions, read fresh from the sidecar dir.
 *  Fresh from disk, not from the caller's snapshot: the caller's list was
 *  captured before any queued naming ahead of us finished, so it can miss
 *  the word the previous run just persisted. Scoped to live sids: persisted
 *  words of dormant conversations must not shrink the vocabulary forever —
 *  and title uniqueness survives reuse via the pid in canonicalTabTitle. */
export async function takenWordsFromDisk(
  liveSids: ReadonlySet<string>,
  dir: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const words = await Promise.all(
    entries
      .filter((f) => f.endsWith(".deckname") && liveSids.has(f.slice(0, -".deckname".length)))
      .map(async (f) => {
        try {
          return (await readFile(join(dir, f), "utf8")).trim();
        } catch {
          return "";
        }
      }),
  );
  return words.filter(Boolean);
}
