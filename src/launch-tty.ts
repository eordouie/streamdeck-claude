import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** One file per launch, named by launch id, containing the tty of the tab that
 *  launch opened (`/dev/ttys012`). Written by the launcher prefix — from inside
 *  the new tab, which is the only place that knows its own tty. */
export const LAUNCH_TTY_DIR = join(homedir(), ".claude", ".streamdeck-launch");

/** Stale handoff files are junk within a couple of reservation lifetimes. */
const MAX_AGE_MS = 300_000;

/**
 * Maps tty → launch id for every recorded launch.
 *
 * This file dance exists because a process's environment is unreadable on macOS:
 * `ps -E` returns nothing for another process (verified 2026-08-17, even for our
 * own children), so `STREAMDECK_LAUNCH_ID` — which the agent definitely inherits
 * — cannot be read back out of it. The tty is the one identifier shared by the
 * tab, the shell, and every agent started in it, and `ps` hands it to us freely.
 */
export async function readLaunchTtys(): Promise<Map<string, string>> {
  const byTty = new Map<string, string>();
  let entries: string[];
  try {
    entries = await readdir(LAUNCH_TTY_DIR);
  } catch {
    return byTty; // no launches recorded yet — nothing to bind
  }
  await Promise.all(
    entries.map(async (launchId) => {
      try {
        const tty = (await readFile(join(LAUNCH_TTY_DIR, launchId), "utf8")).trim();
        if (tty) byTty.set(basename(tty), launchId);
      } catch {
        // unreadable mid-write; the next tick picks it up
      }
    }),
  );
  return byTty;
}

/** Deletes handoff files older than MAX_AGE_MS. By age rather than by "is this
 *  launch still pending" so the sweep needs no knowledge of live reservations —
 *  a file outliving its reservation is harmless, an unbounded directory is not. */
export async function pruneLaunchTtys(now = Date.now(), maxAgeMs = MAX_AGE_MS): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(LAUNCH_TTY_DIR);
  } catch {
    return 0;
  }
  await Promise.all(
    entries.map(async (name) => {
      const path = join(LAUNCH_TTY_DIR, name);
      try {
        const st = await stat(path);
        if (now - st.mtimeMs < maxAgeMs) return;
        await unlink(path);
        removed++;
      } catch {
        // already gone, or not ours to remove
      }
    }),
  );
  return removed;
}
