/** Which terminal application hosts a Claude Code session. Stamped once at
 *  SessionStart by the hook (from $TERM_PROGRAM) and used to pick the focus
 *  strategy when a slot key is pressed. */
export type TerminalKind = "vscode" | "warp" | "iterm" | "ghostty" | "other" | "unknown";

const KINDS: ReadonlySet<TerminalKind> = new Set([
  "vscode",
  "warp",
  "iterm",
  "ghostty",
  "other",
]);

/** Coerce a raw `term` field (already canonicalised by the hook) into a
 *  TerminalKind. Anything absent or unrecognised becomes "unknown" so the
 *  dispatch falls back to the safe Warp→VS Code path. */
export function normaliseTerm(raw: string | undefined): TerminalKind {
  return raw && KINDS.has(raw as TerminalKind) ? (raw as TerminalKind) : "unknown";
}

/** Whether a session record's declared `entrypoint` means a terminal TUI.
 *
 *  Claude Code writes a `<pid>.json` for EVERY interactive session it runs,
 *  including ones no terminal hosts: the Claude Desktop app's local agent
 *  mode spawns a stream-json `claude` child (`entrypoint: "claude-desktop"`,
 *  fd 0 is a socket) that stays alive as long as the desktop conversation —
 *  a live pid with a session file and no tab to focus or kill. The deck's
 *  contract is one key per REACHABLE session, so only records that declare
 *  the terminal entrypoint ("cli") get a tile.
 *
 *  Allowlist, not a denylist of known headless hosts: any future non-terminal
 *  entrypoint ("sdk", another app) must fail CLOSED — no proof of a terminal,
 *  no tile. Absent means an older CC version that predates the field (or a
 *  bridge record that never had it); those stayed on the deck for years, so
 *  absence keeps them. */
export function terminalHostedEntry(entrypoint: string | undefined): boolean {
  return entrypoint === undefined || entrypoint === "cli";
}
