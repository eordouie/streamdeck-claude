import { writeFile } from "node:fs/promises";
import { platform } from "node:os";
import streamDeck from "@elgato/streamdeck";
import { spawnCapture } from "./spawn-capture.js";
import type { SessionInfo } from "./sessions.js";

/**
 * The plugin owns each session's terminal tab title.
 *
 * Claude Code's own title (an animated spinner + topic) is disabled via
 * CLAUDE_CODE_DISABLE_TERMINAL_TITLE, because a title that repaints ~10×/s
 * can't be used as a tab identity — every match races the next repaint. With
 * it off, we stamp a stable, unique name on each session's tab by writing an
 * OSC 2 sequence to its controlling tty (the pty behind that tab), and the
 * name sticks for the session's life. Slot-press focus then matches the
 * Window-menu item EXACTLY, which is immune to tab reordering, manually
 * opened tabs, and untitled-session ambiguity.
 *
 * Side benefit: the tab bar shows the same one-word names as the deck.
 */

/** Canonical tab name for a session: its deck word once assigned, else a
 *  pid-derived placeholder. NEVER the display label — that falls back to the
 *  cwd basename, which every session in the same directory would share, and a
 *  shared name is exactly the ambiguity this whole mechanism exists to kill. */
export function canonicalTabTitle(session: Pick<SessionInfo, "pid" | "deckName">): string {
  const word = session.deckName.trim();
  return /^[\w-]{1,24}$/.test(word) ? word : `claude-${session.pid}`;
}

/** Cache of what we last wrote per pid, so ticks don't re-write constantly. */
const written = new Map<number, { title: string; at: number }>();
/** Re-assert periodically in case something else (a shell prompt, the user)
 *  overwrote the title. Cheap: one tty write per session per interval. */
const REASSERT_MS = 30_000;

/** Resolve a pid's controlling tty device path, or "" when it has none. */
export async function ttyForPid(pid: number): Promise<string> {
  const r = await spawnCapture("/bin/ps", ["-o", "tty=", "-p", String(pid)], { timeoutMs: 2000 });
  const tty = r.stdout.trim();
  if (r.err || r.code !== 0 || !/^tty\w+$/.test(tty)) return "";
  return `/dev/${tty}`;
}

/** Write an OSC 2 title straight to a tty device. Output path only — the
 *  running TUI never sees these bytes on its stdin. */
export async function writeTabTitle(dev: string, title: string): Promise<boolean> {
  try {
    await writeFile(dev, `\x1b]2;${title}\x07`);
    return true;
  } catch {
    return false;
  }
}

/** Stamp every live interactive session's tab with its canonical name. */
export async function ensureTabTitles(sessions: readonly SessionInfo[]): Promise<void> {
  if (platform() !== "darwin") return;
  const now = Date.now();
  const livePids = new Set<number>();
  await Promise.all(
    sessions
      .filter((s) => s.kind !== "bg" && s.terminal !== "vscode")
      .map(async (s) => {
        livePids.add(s.pid);
        const title = canonicalTabTitle(s);
        const prev = written.get(s.pid);
        if (prev && prev.title === title && now - prev.at < REASSERT_MS) return;
        const dev = await ttyForPid(s.pid);
        if (!dev) return;
        if (await writeTabTitle(dev, title)) {
          if (!prev || prev.title !== title) {
            streamDeck.logger.info(`tab title: pid=${s.pid} -> "${title}"`);
          }
          written.set(s.pid, { title, at: now });
        }
      }),
  );
  for (const pid of written.keys()) {
    if (!livePids.has(pid)) written.delete(pid);
  }
}
