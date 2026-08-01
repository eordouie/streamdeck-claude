# Lessons — streamdeck-claude fork

Fork-specific gotchas (eordouie/ghostty-focus). Upstream docs live in
`docs/`; this file records what bit us while operating the plugin on the
MacBook Pro.

## The Stream Deck app ignores SIGTERM and rewrites profiles at quit

Building the Claude page (2026-07-31): `pkill -TERM "Stream Deck"` did
nothing (twice); the app only exits via Apple Events quit or SIGKILL. And
on any exit it flushes runtime state — including `Pages.Current` in the
device profile manifest — which silently reverted a page edit made while
it was running.

Rule: edit `ProfilesV3` only with the app fully dead, in this order:
`osascript -e 'quit app "Elgato Stream Deck"'`, poll `pgrep -x "Stream Deck"`,
`pkill -KILL` as fallback, THEN edit, then `open -a "Elgato Stream Deck"`.
`dotfiles/streamdeck/apply-layout.sh` encodes the sequence — use it instead
of hand-editing.

## Profile page JSON: keys are "col,row"; the visible page is Pages.Current

Page manifests live at
`ProfilesV3/<device>.sdProfile/Profiles/<page>/manifest.json` with
`Controllers[0].Actions` keyed `"col,row"` (col 0-4 left to right, row 0-2
top to bottom on the MK.2). Which page the deck shows is
`Pages.Current` in the *device* profile's own `manifest.json` — writing a
page's keys without pointing `Current` at that page looks like a silent
no-op (the plugin logs `actions=0`).

## The plugin runs live from this working tree

`pnpm sd:link` symlinks `com.julien.claudesessions.sdPlugin/` out of this
checkout into the SD app's Plugins dir. Consequences: switching branches
changes the deck in place, and `bin/plugin.js` is whatever the last
`pnpm build` produced — not what's committed. After editing:
`pnpm build && pnpm sd:reload` (~1 s respawn). SDK logs land in
`com.julien.claudesessions.sdPlugin/logs/` — `.0.log` is current; note
`ls -t` is eza-aliased on this machine and does NOT sort by mtime, so use
`/bin/ls -t` when hunting the newest log.

## Ghostty background tabs are not AX windows — jump via the Window menu

First tab-jump attempt (2026-07-31) enumerated `windows of process
"Ghostty"` and AXRaised the best title match. It could never work: with N
native tabs, System Events sees ONE AXStandardWindow per window (the
frontmost tab); background tabs are simply absent from the AX window list.
What DOES list every tab — live titles included — is Ghostty's **Window
menu**; System Events can `click (first menu item whose name ends with
<title>)` and the right tab is selected, even from the background.

Two supporting facts for the title join:
- Claude Code names the tab `<spinner|✳> <session title>` where the title is
  the session's `aiTitle` (or `customTitle` after a rename). It is NOT in
  `~/.claude/sessions/<pid>.json` (title stays null) but IS in the transcript
  JSONL as `"aiTitle":"…"` lines — and the hook payload carries
  `transcript_path`, so stamping it at SessionStart closes the loop.
- cwd is useless as a join key here: every deck-launched tab starts in the
  same working directory, so cwd-token scoring is degenerate by design.

## A tab identity you don't own is not an identity

Three successive tab-jump mechanisms failed for the same underlying reason
(2026-07-31): every one of them read an identity that something else
controlled.

- **Session title** — Claude Code paints the tab title itself AND animates a
  spinner glyph into it (~10 updates/s while working). Any match races the
  next repaint; a `whose name ends with` specifier resolved a beat later
  dies with AppleScript -1728.
- **A marker we write, then restore** — same race, lost by definition on a
  busy session.
- **Position** — untitled sessions all share the tab name "Claude Code", and
  the tab strip's order is NOT session start order (verified by comparing
  each session's tty against the strip). Indexing into it picks a
  confidently wrong tab the moment a tab is opened manually or dragged.

The fix was to stop reading someone else's identity and own one:
`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (undocumented but real — found by
grepping the CLI binary for `CLAUDE_CODE_*TITLE*`) hands title control over,
then the plugin stamps each tab with a unique canonical name by writing
`ESC ] 2 ; <name> BEL` to the session pid's controlling tty. The tty **is**
the tab's pty, so that write can't hit the wrong tab, and it's an output-path
write — the running TUI never sees it on stdin.

Rules:
- Prefer an identity you assign over one you infer, and re-assert it
  periodically rather than assuming it holds.
- Never let a matcher fall back to a positional guess: a wrong jump is worse
  than no jump. Fall back to "focus the app" and let the human finish.
- When guessing whether a knob exists, grep the binary before concluding it
  doesn't — the docs didn't mention this env var at all.

## Elgato's built-in action settings are a private schema

The system actions (Text, Hotkey, Multi Action) declare `PrivateAPI: true`
— their Settings shapes live in the app binary, and factory profiles only
carry *unset* examples (`NativeCode: -1`). Guessed encodings fail silently.
That's why command keys here are a first-party plugin action
(`com.julien.claudesessions.command`) with explicit settings instead of
profile-baked built-ins.
