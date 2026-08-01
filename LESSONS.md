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

## Elgato's built-in action settings are a private schema

The system actions (Text, Hotkey, Multi Action) declare `PrivateAPI: true`
— their Settings shapes live in the app binary, and factory profiles only
carry *unset* examples (`NativeCode: -1`). Guessed encodings fail silently.
That's why command keys here are a first-party plugin action
(`com.julien.claudesessions.command`) with explicit settings instead of
profile-baked built-ins.
