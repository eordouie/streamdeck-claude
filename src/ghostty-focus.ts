import { platform } from "node:os";
import type { SessionOrigin } from "./sessions.js";
import type { FocusResult } from "./terminal-focus.js";
import { focusGhosttyTabOnMac } from "./ghostty-focus-mac.js";

/** Options for the Ghostty focus attempt. */
export interface GhosttyFocusOpts {
  /** When true, a failed tab match still counts as "landed in Ghostty" (the
   *  user picks the tab themselves). Set by the stamped "ghostty" dispatch;
   *  false in the "unknown" back-compat chain. NOTE the macOS matcher must
   *  activate Ghostty to read its Window menu at all, so even a miss with
   *  this false can leave Ghostty frontmost — the flag governs the reported
   *  outcome and the retry behavior, not whether activation happens. */
  activateOnMiss?: boolean;
  /** Session pid — its controlling tty IS the tab, so a drifted title can be
   *  re-stamped and matched again. */
  pid?: number;
  /** The unique name the plugin stamps on this session's tab (tab-title.ts).
   *  Focus is an EXACT match on it — no suffix or ordinal guessing. */
  canonicalTitle?: string;
}

/**
 * Best-effort: select the Ghostty tab hosting the session, by the exact title
 * the plugin stamps on its terminal (ghostty-focus-mac.ts has the ladder).
 * macOS only (Ghostty ships no Windows build); silent no-op elsewhere.
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
