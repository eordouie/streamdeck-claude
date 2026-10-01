import { writeFile } from "node:fs/promises";
import { platform } from "node:os";
import streamDeck from "@elgato/streamdeck";
import { canonicalTabTitle } from "./naming-policy.js";
import { spawnCapture } from "./spawn-capture.js";
import { ghosttyScriptFailure, listTerminalTitles } from "./ghostty-script.js";
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
 * Side benefit: the tab bar carries the same identity names as the deck,
 * embedded in a stable provider-specific convention.
 */

export { canonicalTabTitle };

/** Cache of what we last wrote, keyed pid:sid — pid alone leaks across a
 *  /clear (same process, new sessionId): a contested/backoff entry set for
 *  the old conversation would suppress stamping of the new one for up to
 *  CONTESTED_BACKOFF_MS. */
const written = new Map<string, { title: string; at: number }>();
/** Re-assert periodically in case something else (a shell prompt, the user)
 *  overwrote the title. Cheap: one tty write per session per interval. */
const REASSERT_MS = 30_000;

/** Stamps waiting to be checked against the live tab names. */
const pendingVerify = new Map<string, { title: string; at: number; pid: number }>();
/** Sessions whose stamp did not stick — we stop pulling so the title doesn't
 *  ping-pong. Real causes seen: a second agent process on the same tty (a
 *  Ctrl+Z'd twin — now kept off the deck, so it no longer stamps), a session
 *  whose CLAUDE_CODE_DISABLE_TERMINAL_TITLE never took effect, and, on the
 *  Window-menu fallback only, a tab renamed by hand. Focus still tries the
 *  terminal title and the re-stamp tier there. */
const contestedUntil = new Map<string, number>();
const VERIFY_DELAY_MS = 4_000;
const CONTESTED_BACKOFF_MS = 600_000;
/** Last Ghostty-API failure logged, so a lasting one is said once. */
let loggedApiFailure = "";

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
 *  they can't be read. The fallback for confirming a stamp when Ghostty's own
 *  API is unavailable: these are TAB names, so a tab renamed by hand shows its
 *  hand-set name here even though the stamp is intact on its terminal. */
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
 *  confirm the stamp stuck — a session that overwrites it is left alone.
 *
 *  Ghostty only: the OSC 2 stamp is this fork's Ghostty tab-identity
 *  mechanism. Stamping other hosts did nothing useful and, inside tmux,
 *  retitled the PANE rather than the tab — the stamp silently landing on
 *  the wrong layer. */
export async function ensureTabTitles(sessions: readonly SessionInfo[]): Promise<void> {
  if (platform() !== "darwin") return;
  const now = Date.now();
  const liveKeys = new Set<string>();
  await Promise.all(
    sessions
      .filter((s) => s.kind !== "bg" && s.pid !== undefined && s.terminal === "ghostty")
      .map(async (s) => {
        const pid = s.pid;
        if (pid === undefined) return;
        const key = `${pid}:${s.sessionId}`;
        liveKeys.add(key);
        if ((contestedUntil.get(key) ?? 0) > now) return;
        const title = canonicalTabTitle(s);
        const prev = written.get(key);
        if (prev && prev.title === title && now - prev.at < REASSERT_MS) return;
        const dev = await ttyForPid(pid);
        if (!dev) return;
        if (await writeTabTitle(dev, title)) {
          if (!prev || prev.title !== title) {
            streamDeck.logger.info(`tab title: pid=${pid} -> "${title}"`);
          }
          written.set(key, { title, at: now });
          pendingVerify.set(key, { title, at: now, pid });
        }
      }),
  );

  // One read confirms every stamp old enough to have settled. Terminal titles
  // first: OSC 2 sets exactly those, and a hand-renamed tab still carries the
  // stamp there. The Window menu lists TAB names, so it called a renamed tab
  // contested every 10 min forever (2026-09-30, `claude-33832-Humain`).
  const due = [...pendingVerify].filter(([, p]) => now - p.at >= VERIFY_DELAY_MS);
  if (due.length > 0) {
    const terminalTitles = await listTerminalTitles();
    const failure = ghosttyScriptFailure();
    if (failure !== loggedApiFailure) {
      if (failure) {
        streamDeck.logger.warn(`ghostty api unavailable (${failure}); using the Window menu (tab names) instead`);
      } else {
        streamDeck.logger.info("ghostty api available again; matching terminal titles");
      }
      loggedApiFailure = failure;
    }
    const names = terminalTitles ?? (await listTabNames());
    if (names) {
      const present = new Set(names);
      for (const [key, p] of due) {
        pendingVerify.delete(key);
        if (present.has(p.title)) continue;
        contestedUntil.set(key, now + CONTESTED_BACKOFF_MS);
        written.delete(key);
        streamDeck.logger.warn(contestedWarning(p.pid, p.title, terminalTitles !== null));
      }
    }
  }

  for (const map of [written, pendingVerify, contestedUntil]) {
    for (const key of map.keys()) {
      if (!liveKeys.has(key)) map.delete(key);
    }
  }
}

/** Why a stamp did not stick, as far as the evidence goes. Never "restart the
 *  session": the old text said exactly that, and sent the user restarting
 *  sessions over a hand-renamed tab and a suspended twin on the same tty —
 *  restarting fixes neither (2026-10-01). */
function contestedWarning(pid: number, title: string, readTerminals: boolean): string {
  const head = `tab title contested for pid=${pid}: "${title}" did not stick; not re-stamping that tab for 10 min.`;
  return readTerminals
    ? `${head} Something else writes that terminal's title: another agent process on the same tty, or a program ` +
        `titling itself (Claude Code does when CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 did not reach it).`
    : `${head} Checked against the Window menu, which lists TAB names: a tab renamed by hand ` +
        `(View > Change Tab Title…) beats every program title and looks the same as another writer. ` +
        `Allow Stream Deck to control Ghostty (Privacy & Security > Automation) to tell them apart.`;
}
