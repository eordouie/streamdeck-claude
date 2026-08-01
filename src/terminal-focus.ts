import streamDeck from "@elgato/streamdeck";
import type { SessionOrigin } from "./sessions.js";
import type { TerminalKind } from "./terminal-kind.js";
import { focusWarpTabForCwd } from "./warp-focus.js";
import { focusVscodeWindowForCwd } from "./vscode-focus.js";
import { focusGhosttyTabForCwd } from "./ghostty-focus.js";

/** Outcome of attempting to focus the terminal hosting a session. */
export interface FocusResult {
  matched: boolean;
  reason: string;
}

/**
 * Dispatch the slot-press focus to the right terminal backend, keyed by the
 * terminal kind stamped at SessionStart. Best-effort throughout — the caller
 * always copies the cwd to the clipboard regardless of the result.
 *
 * - warp    → Warp tab focus (reads Warp's sqlite DB, sends a per-tab keystroke)
 * - vscode  → raise the matching VS Code window (title-based, window-level)
 * - ghostty → raise the matching Ghostty tab (title-based AXRaise; falls back
 *             to activating the app when no title matches)
 * - iterm   → not implemented yet (placeholder for the next backend)
 * - other   → bare terminal; nothing to raise
 * - unknown → back-compat: try Warp, then VS Code, then Ghostty. Covers sessions
 *             that started before the hook stamp existed or where env detection
 *             missed.
 */
export async function focusTerminalForSession(opts: {
  cwd: string;
  terminal: TerminalKind;
  origin: SessionOrigin;
  /** Claude Code transcript path — lets title-based backends (Ghostty) look
   *  up the session's tab title. */
  transcriptPath?: string;
  /** Session id — lets backends derive the transcript path for sessions that
   *  predate the transcript stamp. */
  sessionId?: string;
  /** Position among UNTITLED interactive sessions (start order) + their
   *  total — for ordinal tab matching while the session has no title yet. */
  tabOrdinal?: number;
  tabCount?: number;
}): Promise<FocusResult> {
  const { cwd, terminal, origin, transcriptPath, sessionId, tabOrdinal, tabCount } = opts;
  switch (terminal) {
    case "warp":
      return focusWarpTabForCwd(cwd);
    case "vscode":
      return focusVscodeWindowForCwd(cwd, origin);
    case "ghostty":
      return focusGhosttyTabForCwd(cwd, origin, { activateOnMiss: true, transcriptPath, sessionId, tabOrdinal, tabCount });
    case "iterm":
      return { matched: false, reason: "iterm-not-implemented" };
    case "other":
      return { matched: false, reason: "bare-terminal" };
    case "unknown": {
      const warp = await focusWarpTabForCwd(cwd);
      if (warp.matched) return warp;
      streamDeck.logger.info(`focus: unknown terminal, warp miss (${warp.reason}); trying vscode`);
      const vscode = await focusVscodeWindowForCwd(cwd, origin);
      if (vscode.matched) return vscode;
      streamDeck.logger.info(`focus: unknown terminal, vscode miss (${vscode.reason}); trying ghostty`);
      return focusGhosttyTabForCwd(cwd, origin, { transcriptPath, sessionId, tabOrdinal, tabCount });
    }
  }
}
