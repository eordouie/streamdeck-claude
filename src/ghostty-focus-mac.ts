import streamDeck from "@elgato/streamdeck";
import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import type { GhosttyFocusOpts } from "./ghostty-focus.js";
import { spawnCapture } from "./spawn-capture.js";
import { ttyForPid, writeTabTitle } from "./tab-title.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

/**
 * Select the Ghostty tab hosting the session, on macOS.
 *
 * The plugin OWNS each tab's title (see tab-title.ts): every live session's
 * tab carries its unique canonical name, and Claude Code's own animated
 * title is disabled. So the jump is an exact Window-menu match — no
 * suffix/ordinal guessing, immune to tab reordering and manually opened
 * tabs. Ghostty lists every tab in that menu, background ones included,
 * which matters because background native tabs are NOT AX windows.
 *
 * Ladder: exact canonical-title click → re-stamp the tty and retry (covers a
 * title that drifted) → app activation. Never guesses a tab.
 *
 * All AX paths require Stream Deck.app to hold Accessibility permission.
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

  // Raising the app first is wanted on success anyway, and a menu interaction
  // on a frontmost app is the reliable path.
  await activateApp();

  const first = await clickWindowMenuTabExact(canonical);
  if (first.ok) return { matched: true, reason: `menu exact="${canonical}"` };

  // The tab's title drifted (shell prompt, user edit, session started before
  // the plugin owned titles): re-stamp it through the session's tty and retry.
  if (opts.pid !== undefined) {
    const dev = await ttyForPid(opts.pid);
    if (dev && (await writeTabTitle(dev, canonical))) {
      await new Promise((r) => setTimeout(r, 250));
      const second = await clickWindowMenuTabExact(canonical);
      if (second.ok) return { matched: true, reason: `menu exact="${canonical}" (re-stamped)` };
      streamDeck.logger.info(`ghostty exact miss after re-stamp (${second.error}) title="${canonical}"`);
      return miss(`no-tab-named "${canonical}"`);
    }
  }
  streamDeck.logger.info(`ghostty exact miss (${first.error}) title="${canonical}"`);
  return miss(`no-tab-named "${canonical}"`);
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
