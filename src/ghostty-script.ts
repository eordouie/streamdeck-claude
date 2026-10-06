import { spawnCapture } from "./spawn-capture.js";

/**
 * Ghostty's own AppleScript dictionary (Ghostty 1.3+), used for the one thing
 * the Window menu cannot give: each TERMINAL's title, separately from its
 * TAB's name.
 *
 * A tab renamed by hand (View > Change Tab Title…) shows the hand-set name in
 * the tab strip and in the Window menu, and ignores every OSC 2 title from
 * then on. The terminal inside it still reports the title its program wrote.
 * Measured 2026-10-01 on Ghostty 1.3.1: tab `claude-33832-Humain`, its terminal
 * `claude-33832-nebula` — the plugin's stamp, intact one layer down. Every
 * Window-menu match missed that tab; a terminal match finds it.
 *
 * Talking to Ghostty needs the macOS Automation grant "Stream Deck → Ghostty"
 * (one prompt; Stream Deck declares NSAppleEventsUsageDescription). Any
 * failure — no grant, a prompt still open, a Ghostty without the dictionary —
 * reads as `unavailable`, and callers fall back to the Window menu. After a
 * failure the API is left alone for a minute: the slow tick awaits these
 * calls, and a pending consent prompt would otherwise stall every tick for
 * the full timeout.
 */

const GHOSTTY = 'application id "com.mitchellh.ghostty"';
const BACKOFF_MS = 60_000;
const TIMEOUT_MS = 2_000;

let unavailableUntil = 0;
/** Why the last call failed ("" once one succeeds). -1743 = no Automation
 *  grant; a timeout = a consent prompt still open, or Ghostty not answering. */
let lastFailure = "";

/** The newest failure reason, for the caller to log; "" while the API works. */
export function ghosttyScriptFailure(): string {
  return lastFailure;
}

/** An AppleScript string literal for `text`. AppleScript has no backslash
 *  escapes, so a double quote is spliced in with the `quote` constant. */
export function appleScriptString(text: string): string {
  return `"${text.replace(/"/g, '" & quote & "')}"`;
}

type ScriptAnswer = { ok: true; out: string } | { ok: false };

async function runGhosttyScript(body: string): Promise<ScriptAnswer> {
  if (Date.now() < unavailableUntil) return { ok: false };
  const script = `
    if not (${GHOSTTY} is running) then return "ERR:not-running"
    tell ${GHOSTTY}
      ${body}
    end tell
  `;
  const r = await spawnCapture("/usr/bin/osascript", ["-e", script], { timeoutMs: TIMEOUT_MS });
  if (r.err || r.timedOut || r.code !== 0) {
    unavailableUntil = Date.now() + BACKOFF_MS;
    lastFailure = r.err ?? (r.timedOut ? `timeout after ${TIMEOUT_MS} ms` : r.stderr.trim() || `exit ${r.code}`);
    return { ok: false };
  }
  lastFailure = "";
  const out = r.stdout.trim();
  // Not running is an answer about Ghostty, not about the API — no backoff.
  if (out === "ERR:not-running") return { ok: false };
  return { ok: true, out };
}

/** Title of every Ghostty terminal (splits included), or null when the API
 *  can't be asked. These are the titles programs wrote — never a hand-set
 *  tab name. */
export async function listTerminalTitles(): Promise<string[] | null> {
  const r = await runGhosttyScript(`
      set ns to name of every terminal
      set AppleScript's text item delimiters to linefeed
      return ns as text
  `);
  if (!r.ok) return null;
  return r.out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Select the tab holding the terminal titled exactly `title` and bring its
 *  window forward. */
export async function focusTerminalTitled(title: string): Promise<"focused" | "no-match" | "unavailable"> {
  const r = await runGhosttyScript(`
      set hits to (every terminal whose name is ${appleScriptString(title)})
      if (count of hits) is 0 then return "ERR:no-match"
      focus (item 1 of hits)
      return "OK"
  `);
  if (!r.ok) return "unavailable";
  return r.out === "OK" ? "focused" : "no-match";
}

/** Title of the terminal the user is looking at: Ghostty frontmost, its front
 *  window's selected tab, that tab's focused split. "" when Ghostty is not the
 *  active app; null when the API can't be asked. */
export async function frontTerminalTitle(): Promise<string | null> {
  const r = await runGhosttyScript(`
      if not frontmost then return ""
      try
        return name of focused terminal of selected tab of front window
      on error
        return ""
      end try
  `);
  return r.ok ? r.out : null;
}

/** Every tab's name paired with the title of its focused terminal, or null
 *  when the API can't be asked. The two differ exactly when the tab was
 *  renamed by hand (see the header). */
export async function listTabTerminalPairs(): Promise<{ tab: string; terminal: string }[] | null> {
  const r = await runGhosttyScript(`
      set sep to character id 9
      set out to {}
      repeat with w in windows
        repeat with t in tabs of w
          try
            set end of out to (name of t) & sep & (name of focused terminal of t)
          end try
        end repeat
      end repeat
      set AppleScript's text item delimiters to linefeed
      return out as text
  `);
  if (!r.ok) return null;
  return r.out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((parts) => parts.length === 2)
    .map(([tab, terminal]) => ({ tab: tab.trim(), terminal: terminal.trim() }));
}
