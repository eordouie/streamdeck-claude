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

/** Stamps waiting to be checked against the live tab names. */
const pendingVerify = new Map<number, { title: string; at: number }>();
/** Sessions that overwrite our stamp — we stop pulling so the tab name
 *  doesn't ping-pong. Happens when CLAUDE_CODE_DISABLE_TERMINAL_TITLE was
 *  not in effect when that session started (restarting it fixes it); focus
 *  still works there via the re-stamp tier. */
const contestedUntil = new Map<number, number>();
const VERIFY_DELAY_MS = 4_000;
const CONTESTED_BACKOFF_MS = 600_000;

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

/** Live Ghostty tab names (every tab, background ones included), or null when
 *  they can't be read. Used to confirm a stamp actually stuck. */
async function listTabNames(): Promise<string[] | null> {
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "ERR:not-running"
      tell process "Ghostty"
        set ns to name of menu items of menu "Window" of menu bar item "Window" of menu bar 1
      end tell
    end tell
    set out to {}
    repeat with n in ns
      if n is not missing value then set end of out to (n as text)
    end repeat
    set AppleScript's text item delimiters to linefeed
    return out as text
  `;
  const r = await spawnCapture("/usr/bin/osascript", ["-e", script], { timeoutMs: 4000 });
  if (r.err || r.timedOut || r.code !== 0) return null;
  if (r.stdout.startsWith("ERR:")) return null;
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Stamp every live interactive session's tab with its canonical name, then
 *  confirm the stamp stuck — a session that overwrites it is left alone. */
export async function ensureTabTitles(sessions: readonly SessionInfo[]): Promise<void> {
  if (platform() !== "darwin") return;
  const now = Date.now();
  const livePids = new Set<number>();
  await Promise.all(
    sessions
      .filter((s) => s.kind !== "bg" && s.terminal !== "vscode")
      .map(async (s) => {
        livePids.add(s.pid);
        if ((contestedUntil.get(s.pid) ?? 0) > now) return;
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
          pendingVerify.set(s.pid, { title, at: now });
        }
      }),
  );

  // One menu read confirms every stamp old enough to have settled.
  const due = [...pendingVerify].filter(([, p]) => now - p.at >= VERIFY_DELAY_MS);
  if (due.length > 0) {
    const names = await listTabNames();
    if (names) {
      const present = new Set(names);
      for (const [pid, p] of due) {
        pendingVerify.delete(pid);
        if (present.has(p.title)) continue;
        contestedUntil.set(pid, now + CONTESTED_BACKOFF_MS);
        written.delete(pid);
        streamDeck.logger.warn(
          `tab title contested for pid=${pid}: "${p.title}" was overwritten, so the tab name is left alone ` +
            `(CLAUDE_CODE_DISABLE_TERMINAL_TITLE was not in effect when that session started — restart it for a ` +
            `stable name). Slot focus still works there via the re-stamp tier.`,
        );
      }
    }
  }

  for (const map of [written, pendingVerify, contestedUntil]) {
    for (const pid of map.keys()) {
      if (!livePids.has(pid)) map.delete(pid);
    }
  }
}
