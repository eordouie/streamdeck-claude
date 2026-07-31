import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import type { GhosttyFocusOpts } from "./ghostty-focus.js";
import { pickBestWindow } from "./vscode-window-match.js";
import { spawnCapture } from "./spawn-capture.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

/**
 * Select the Ghostty tab matching `cwd` on macOS.
 *
 * Ghostty tabs are native NSWindow tabs, so System Events sees every tab as
 * its own AXWindow (background tabs included) and AXRaise on one selects it.
 * Titles are whatever the running program set via OSC — Claude Code stamps its
 * own — so matching reuses the tokenized title scorer shared with the VS Code
 * backend. Requires Stream Deck.app to hold Accessibility permission (same
 * prompt the Warp/VS Code paths need).
 *
 * On a miss with `activateOnMiss`, the app is still brought forward via
 * `open -b` — no Apple Events permission needed — so the user always lands in
 * Ghostty and picks the tab by hand.
 */
export async function focusGhosttyTabOnMac(
  cwd: string,
  origin: SessionOrigin,
  opts: GhosttyFocusOpts = {},
): Promise<FocusResult> {
  const names = await enumerateWindowNames();
  const miss = async (reason: string): Promise<FocusResult> => {
    if (!opts.activateOnMiss) return { matched: false, reason };
    const activated = await activateApp();
    return { matched: false, reason: `${reason}; ${activated ? "app-activated" : "activate-failed"}` };
  };

  if (!names.ok) return miss(`enumerate-failed: ${names.error}`);
  if (names.titles.length === 0) return miss("no-ghostty-windows");

  const best = pickBestWindow(cwd, names.titles.map((title) => ({ title })), origin);
  if (!best) return miss(`no-match (windows=${names.titles.length})`);

  const raised = await raiseWindowByName(best.title);
  if (!raised.ok) return miss(`raise-failed: ${raised.error}`);
  return { matched: true, reason: `raised title="${best.title}"` };
}

/** One window (= tab) name per line via System Events. */
async function enumerateWindowNames(): Promise<
  { ok: true; titles: string[] } | { ok: false; error: string }
> {
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "ERR:not-running"
      set out to ""
      repeat with w in windows of process "Ghostty"
        set out to out & (name of w) & linefeed
      end repeat
      return out
    end tell
  `;
  const r = await runOsa(script, 2000);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.out.startsWith("ERR:")) return r.out === "ERR:not-running"
    ? { ok: true, titles: [] }
    : { ok: false, error: r.out };
  const titles = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
  return { ok: true, titles };
}

/** Activate Ghostty and AXRaise the window whose name matches exactly. */
async function raiseWindowByName(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // AppleScript string literals don't honour backslash escapes; embed any
  // double-quote in the title via the `quote` keyword instead.
  const escaped = name.replace(/"/g, '" & quote & "');
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "ERR:not-running"
      tell process "Ghostty"
        set frontmost to true
        try
          set target to (first window whose name is "${escaped}")
          perform action "AXRaise" of target
        on error
          return "ERR:window-gone"
        end try
      end tell
      return "OK"
    end tell
  `;
  const r = await runOsa(script, 2000);
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
