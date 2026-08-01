import { platform } from "node:os";
import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import { focusGhosttyTabOnMac } from "./ghostty-focus-mac.js";

/** Options for the Ghostty focus attempt. */
export interface GhosttyFocusOpts {
  /** When true, a failed tab match still activates the Ghostty app (the user
   *  lands in Ghostty and picks the tab themselves). Set by the stamped
   *  "ghostty" dispatch; left false in the "unknown" back-compat chain so a
   *  guess never raises an app the session may not live in. */
  activateOnMiss?: boolean;
  /** Claude Code transcript path (from the SessionStart hook stamp). Mined
   *  for the session's customTitle/aiTitle — the exact string the tab is
   *  named — enabling a deterministic Window-menu jump. */
  transcriptPath?: string;
  /** Session id — fallback route to the transcript (derived path) for
   *  sessions whose event log predates the transcript stamp. */
  sessionId?: string;
  /** Session pid. Its controlling tty IS the tab's pty, so the tab can be
   *  identified deterministically: write a marker title to /dev/<tty>, click
   *  the menu item bearing it, restore. Survives any tab reordering. */
  pid?: number;
  /** Position among UNTITLED interactive sessions (start order) + their
   *  total — last-resort ordinal matching when the tty route fails. The
   *  click is refused unless the untitled tab and session counts agree. */
  tabOrdinal?: number;
  tabCount?: number;
}

/**
 * Best-effort: select the Ghostty tab hosting the session at `cwd`. Ghostty
 * uses native macOS window tabs, so each tab is an AXWindow that System Events
 * can enumerate and AXRaise — same mechanism as the VS Code backend, but
 * tab-level rather than window-level. macOS only (Ghostty ships no Windows
 * build); silent no-op elsewhere.
 */
export async function focusGhosttyTabForCwd(
  cwd: string,
  origin: SessionOrigin,
  opts: GhosttyFocusOpts = {},
): Promise<FocusResult> {
  switch (platform()) {
    case "darwin":
      return focusGhosttyTabOnMac(cwd, origin, opts);
    default:
      return { matched: false, reason: "unsupported-platform" };
  }
}
