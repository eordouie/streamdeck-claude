import { spawnCapture } from "./spawn-capture.js";
import type { TabEntry } from "./slot-plan.js";

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
/** The strip walk visits every tab; 7 tabs answered in 0.6 s from the shell,
 *  and a slow answer is worth more than a backoff here. */
const LIST_TIMEOUT_MS = 4_000;

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

type ScriptAnswer = { ok: true; out: string } | { ok: false; notRunning?: true };

async function runGhosttyScript(body: string, timeoutMs = TIMEOUT_MS): Promise<ScriptAnswer> {
  if (Date.now() < unavailableUntil) return { ok: false };
  const script = `
    if not (${GHOSTTY} is running) then return "ERR:not-running"
    tell ${GHOSTTY}
      ${body}
    end tell
  `;
  const r = await spawnCapture("/usr/bin/osascript", ["-e", script], { timeoutMs });
  if (r.err || r.timedOut || r.code !== 0) {
    unavailableUntil = Date.now() + BACKOFF_MS;
    lastFailure = r.err ?? (r.timedOut ? `timeout after ${timeoutMs} ms` : r.stderr.trim() || `exit ${r.code}`);
    return { ok: false };
  }
  lastFailure = "";
  const out = r.stdout.trim();
  // Not running is an answer about Ghostty, not about the API — no backoff.
  if (out === "ERR:not-running") return { ok: false, notRunning: true };
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

/**
 * Every tab of every window, with the stable ids and the 1-based index that
 * Cmd+N selects, the tab's name and the title of its focused terminal. The two
 * names differ exactly when the tab was renamed by hand (see the header).
 * `[]` when Ghostty is not running (no tabs is the true answer); null when the
 * API can't be asked (grant missing, consent prompt open, timeout) so callers
 * keep whatever they last knew. The per-window walk is deliberate: a nested
 * `every tab of every window` specifier hung for 80 s on 1.3.1.
 */
export async function listTabs(): Promise<TabEntry[] | null> {
  const r = await runGhosttyScript(`
      set sep to character id 9
      set fid to ""
      try
        set fid to id of front window
      end try
      set out to {}
      repeat with w in windows
        set wid to id of w
        set isFront to "0"
        if wid is fid then set isFront to "1"
        repeat with t in tabs of w
          try
            set end of out to wid & sep & isFront & sep & (id of t) & sep & (index of t) & sep & (selected of t) & sep & (name of t) & sep & (name of focused terminal of t)
          end try
        end repeat
      end repeat
      set AppleScript's text item delimiters to linefeed
      return out as text
  `, LIST_TIMEOUT_MS);
  if (!r.ok) return r.notRunning ? [] : null;
  const out: TabEntry[] = [];
  for (const line of r.out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 7) continue;
    const [windowId, front, tabId, index, selected, tab, terminal] = parts;
    const idx = Number(index);
    if (!windowId || !tabId || !Number.isInteger(idx) || idx < 1) continue;
    out.push({ windowId, tabId, index: idx, front: front === "1", selected: selected === "true", tab: tab.trim(), terminal: terminal.trim() });
  }
  return out;
}

/** Select the tab with this stable id and bring its window forward. Used for
 *  an empty deck key that mirrors a tab with no agent in it; the id comes
 *  from a listTabs snapshot a few seconds old at most. */
export async function selectTabById(tabId: string): Promise<"selected" | "no-match" | "unavailable"> {
  const r = await runGhosttyScript(`
      repeat with w in windows
        repeat with t in tabs of w
          if (id of t) is ${appleScriptString(tabId)} then
            select tab t
            activate window w
            return "OK"
          end if
        end repeat
      end repeat
      return "ERR:no-match"
  `);
  if (!r.ok) return "unavailable";
  return r.out === "OK" ? "selected" : "no-match";
}
