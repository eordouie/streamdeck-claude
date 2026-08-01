import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";
import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import type { GhosttyFocusOpts } from "./ghostty-focus.js";
import { pickBestWindow } from "./vscode-window-match.js";
import { spawnCapture } from "./spawn-capture.js";

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

/**
 * Select the Ghostty tab hosting the session, on macOS. Three tiers:
 *
 * 1. **Window-menu click by session title.** Claude Code names the tab after
 *    the session's AI-generated title (spinner/✳ prefix + title), and Ghostty
 *    lists every tab — background ones included — at the bottom of its Window
 *    menu. The title is mined from the session transcript (`customTitle`
 *    falling back to `aiTitle`); clicking the menu item whose name ends with
 *    it selects that exact tab. Deterministic, and immune to the fact that
 *    background native tabs are NOT enumerable as AX windows.
 * 2. **AX window scan by cwd tokens** — only reaches frontmost-per-window
 *    tabs, kept as a cheap fallback for sessions without a transcript stamp.
 * 3. **App activation** (`open -b`, no Apple Events needed) when
 *    `activateOnMiss` is set — the user lands in Ghostty and picks the tab.
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

  // Tier 1: deterministic Window-menu jump by session title. A session with
  // no generated topic yet is tabbed "<✳> Claude Code" — matching that
  // default is still safe when exactly one such tab exists.
  const title = await sessionTitle(opts.transcriptPath, cwd, opts.sessionId);
  const target = title || "Claude Code";
  if (!title) {
    streamDeck.logger.info(
      `ghostty: no session title yet (transcript=${opts.transcriptPath || "unstamped"} sid=${opts.sessionId ?? "none"}); trying unique default-title match`,
    );
  }
  {
    // Activate first: raising the app is wanted on success anyway, and a
    // menu interaction on a frontmost app is the reliable path.
    await activateApp();
    const clicked = await clickWindowMenuTab(target, { requireUnique: !title });
    if (clicked.ok) return { matched: true, reason: `menu title="${target}"` };
    streamDeck.logger.info(`ghostty menu miss (${clicked.error}) title="${target}"`);
    // fall through to the window scan with the app already raised
  }

  // Tier 2: cwd-token match against enumerable (frontmost-per-window) tabs.
  const names = await enumerateWindowNames();
  if (!names.ok) return miss(`enumerate-failed: ${names.error}`);
  if (names.titles.length === 0) return miss("no-ghostty-windows");
  const best = pickBestWindow(cwd, names.titles.map((t) => ({ title: t })), origin);
  if (!best) return miss(`no-match (windows=${names.titles.length})`);
  const raised = await raiseWindowByName(best.title);
  if (!raised.ok) return miss(`raise-failed: ${raised.error}`);
  return { matched: true, reason: `raised title="${best.title}"` };
}

/** The session's display title: last customTitle (user rename) in the
 *  transcript, else last aiTitle (auto topic). Empty string when unknown.
 *  Prefers the hook-stamped transcript path; falls back to deriving it from
 *  cwd + sessionId (`~/.claude/projects/<encoded-cwd>/<sid>.jsonl`) so
 *  sessions that predate the stamp still resolve. */
async function sessionTitle(
  transcriptPath: string | undefined,
  cwd: string,
  sessionId: string | undefined,
): Promise<string> {
  const candidates: string[] = [];
  if (transcriptPath) candidates.push(transcriptPath);
  if (sessionId && cwd) candidates.push(derivedTranscriptPath(cwd, sessionId));
  for (const path of candidates) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const title = lastJsonString(text, "customTitle") || lastJsonString(text, "aiTitle");
    if (title) return title;
  }
  return "";
}

/** Claude Code's project-dir encoding: every non-alphanumeric cwd character
 *  becomes "-" (so `/Users/x/Projects` → `-Users-x-Projects`). */
function derivedTranscriptPath(cwd: string, sessionId: string): string {
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", enc, `${sessionId}.jsonl`);
}

/** Last occurrence of `"key":"<value>"` in raw JSONL, JSON-unescaped. */
function lastJsonString(text: string, key: string): string {
  const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, "g");
  let last = "";
  for (const m of text.matchAll(re)) last = m[1];
  if (!last) return "";
  try {
    return JSON.parse(`"${last}"`) as string;
  } catch {
    return "";
  }
}

/** Click the Window-menu item whose name ends with `title` (tab names carry a
 *  spinner/✳ status prefix ahead of the session title). With `requireUnique`,
 *  refuse ambiguous matches — used for the default "Claude Code" title, where
 *  guessing between two fresh sessions would jump to the wrong one. */
async function clickWindowMenuTab(
  title: string,
  opts: { requireUnique?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  // AppleScript string literals don't honour backslash escapes; embed any
  // double-quote via the `quote` keyword instead.
  const escaped = title.replace(/"/g, '" & quote & "');
  const uniqueGuard = opts.requireUnique
    ? `if (count of tabItems) is greater than 1 then return "ERR:ambiguous"`
    : "";
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return "ERR:not-running"
      tell process "Ghostty"
        set tabItems to (menu items of menu "Window" of menu bar item "Window" of menu bar 1 whose name ends with "${escaped}")
        if (count of tabItems) is 0 then return "ERR:no-menu-match"
        ${uniqueGuard}
        click item 1 of tabItems
      end tell
      return "OK"
    end tell
  `;
  const r = await runOsa(script, 4000);
  if (!r.ok) return { ok: false, error: r.error };
  return r.out === "OK" ? { ok: true } : { ok: false, error: r.out };
}

/** One window (= frontmost tab per window) name per line via System Events. */
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
  const r = await runOsa(script, 4000);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.out.startsWith("ERR:")) return r.out === "ERR:not-running"
    ? { ok: true, titles: [] }
    : { ok: false, error: r.out };
  const titles = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
  return { ok: true, titles };
}

/** Activate Ghostty and AXRaise the window whose name matches exactly. */
async function raiseWindowByName(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
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
