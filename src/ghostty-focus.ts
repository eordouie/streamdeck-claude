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
  /** Session pid — its controlling tty IS the tab, so a drifted title can be
   *  re-stamped and matched again. */
  pid?: number;
  /** The unique name the plugin stamps on this session's tab (tab-title.ts).
   *  Focus is an EXACT match on it — no suffix or ordinal guessing. */
  canonicalTitle?: string;
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
