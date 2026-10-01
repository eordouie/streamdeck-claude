import streamDeck from "@elgato/streamdeck";
import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import type { GhosttyFocusOpts } from "./ghostty-focus.js";
import { spawnCapture } from "./spawn-capture.js";
import { ttyForPid, writeTabTitle } from "./tab-title.js";
import { focusTerminalTitled, frontTerminalTitle } from "./ghostty-script.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

/**
 * Select the Ghostty tab hosting the session, on macOS.
 *
 * The plugin OWNS each session's terminal title (see tab-title.ts): every
 * live session's terminal carries its unique canonical name, and Claude
 * Code's own animated title is disabled. So the jump is an exact match — no
 * suffix/ordinal guessing, immune to tab reordering and manually opened tabs.
 *
 * Two ways to match, in order. Ghostty's AppleScript (1.3+) matches the
 * TERMINAL title, which is where OSC 2 lands, and selects its tab — the only
 * path that reaches a tab renamed by hand, because a hand-set tab name
 * replaces the title everywhere else (2026-10-01: the `nebula` key never
 * reached `claude-33832-Humain`). The Window menu matches TAB names and is
 * the fallback when that API can't be asked; it lists every tab, background
 * ones included, which matters because background native tabs are NOT AX
 * windows.
 *
 * Ladder: exact match (terminal, then menu) → re-stamp the tty and retry
 * (covers a title that drifted) → app activation. Never guesses a tab.
 *
 * The menu path needs Accessibility for Stream Deck.app; the terminal path
 * needs Automation (Stream Deck → Ghostty).
 */
export async function focusGhosttyTabOnMac(
  cwd: string,
  origin: SessionOrigin,
  opts: GhosttyFocusOpts = {},
): Promise<FocusResult> {
  const miss = async (reason: string): Promise<FocusResult> => {
    if (!opts.activateOnMiss) return { matched: false, reason };
    const activated = await activateApp();
    return { matched: false, reason: `${reason}; ${activated ? "app-activated" : "activate-failed"}` };
  };

  const canonical = opts.canonicalTitle ?? "";
  if (!canonical) return miss("no-canonical-title");

  // Before raising anything: is the user already looking at this session?
  const alreadyFront = await isSessionTabFrontmost(canonical);

  // Raising the app first is wanted on success anyway, and a menu interaction
  // on a frontmost app is the reliable path.
  await activateApp();

  const first = await selectTabTitled(canonical);
  if (first.ok) return { matched: true, reason: `${first.via} exact="${canonical}"`, alreadyFront };

  // The title drifted (another writer on the tty, a session started before
  // the plugin owned titles): re-stamp it through the session's tty and retry.
  if (opts.pid !== undefined) {
    const dev = await ttyForPid(opts.pid);
    if (dev && (await writeTabTitle(dev, canonical))) {
      await new Promise((r) => setTimeout(r, 250));
      const second = await selectTabTitled(canonical);
      if (second.ok) return { matched: true, reason: `${second.via} exact="${canonical}" (re-stamped)`, alreadyFront };
      streamDeck.logger.info(`ghostty exact miss after re-stamp (${second.error}) title="${canonical}"`);
      return miss(`no-tab-named "${canonical}"`);
    }
  }
  streamDeck.logger.info(`ghostty exact miss (${first.error}) title="${canonical}"`);
  return miss(`no-tab-named "${canonical}"`);
}

/** Select the tab holding the terminal titled `title`: Ghostty's terminal
 *  titles first, the Window menu's tab names when that API can't be asked. */
async function selectTabTitled(
  title: string,
): Promise<{ ok: true; via: "terminal" | "menu" } | { ok: false; error: string }> {
  const viaTerminal = await focusTerminalTitled(title);
  if (viaTerminal === "focused") return { ok: true, via: "terminal" };
  const viaMenu = await clickWindowMenuTabExact(title);
  if (viaMenu.ok) return { ok: true, via: "menu" };
  return { ok: false, error: `terminal ${viaTerminal}, menu ${viaMenu.error}` };
}

/** True when Ghostty is the frontmost app AND `title` is its focused tab —
 *  the user is looking straight at that session. Checked BEFORE we activate
 *  anything, since activating would make the answer trivially true. Asks
 *  Ghostty for the focused TERMINAL's title first: the System Events window
 *  name is the tab name, which a hand rename replaces. */
async function isSessionTabFrontmost(title: string): Promise<boolean> {
  const front = await frontTerminalTitle();
  if (front !== null) return front === title;
  const escaped = title.replace(/"/g, '" & quote & "');
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "no"
      tell process "Ghostty"
        if not (frontmost) then return "no"
        if (count of windows) is 0 then return "no"
        if (name of window 1) is "${escaped}" then return "yes"
      end tell
      return "no"
    end tell
  `;
  const r = await runOsa(script, 3000);
  return r.ok && r.out === "yes";
}

/** Click the Window-menu item whose name is EXACTLY `title`.
 *
 *  Reads `name of menu items` as one atomic list and clicks by numeric index:
 *  per-item specifiers re-resolve by NAME on access, which dies with -1728 if
 *  the name changes in between. */
async function clickWindowMenuTabExact(title: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // AppleScript string literals don't honour backslash escapes; embed any
  // double-quote via the `quote` keyword instead.
  const escaped = title.replace(/"/g, '" & quote & "');
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "ERR:not-running"
      tell process "Ghostty"
        set ns to name of menu items of menu "Window" of menu bar item "Window" of menu bar 1
        set idx to 0
        repeat with i from 1 to count of ns
          set n to item i of ns
          if n is not missing value then
            if (n as text) is "${escaped}" then
              set idx to i
              exit repeat
            end if
          end if
        end repeat
        if idx is 0 then return "ERR:no-menu-match"
        click menu item idx of menu "Window" of menu bar item "Window" of menu bar 1
      end tell
      return "OK"
    end tell
  `;
  const r = await runOsa(script, 4000);
  if (!r.ok) return { ok: false, error: r.error };
  return r.out === "OK" ? { ok: true } : { ok: false, error: r.out };
}

/** Bring Ghostty forward without Apple Events: `open -b` re-activates a
 *  running app (and launches it when not running). */
async function activateApp(): Promise<boolean> {
  const r = await spawnCapture("/usr/bin/open", ["-b", GHOSTTY_BUNDLE_ID], { timeoutMs: 2000 });
  return !r.err && !r.timedOut && r.code === 0;
}

async function runOsa(
  script: string,
  timeoutMs: number,
): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const r = await spawnCapture("/usr/bin/osascript", ["-e", script], { timeoutMs });
  if (r.timedOut) return { ok: false, error: "timeout" };
  if (r.err) return { ok: false, error: `spawn: ${r.err}` };
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `exit-${r.code}` };
  return { ok: true, out: r.stdout.trim() };
}
