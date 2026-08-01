# Ghostty tab focus

Pressing a slot key jumps to the Ghostty tab hosting that session. Unlike the
Warp and VS Code backends — which *infer* which window belongs to a session —
this backend **assigns** each tab an identity and matches it exactly.

macOS only (Ghostty ships no Windows build).

## Why identity is assigned, not inferred

Three inference mechanisms were built and all failed, each for the same
underlying reason: they read an identity something else controlled.

| Mechanism | Why it failed |
|---|---|
| Match the session's Claude title (`aiTitle`/`customTitle`) | Claude Code paints the tab title **and animates a spinner glyph into it** (~10 updates/s while working). Every match races the next repaint. An AppleScript item specifier resolved by name a beat later dies with `-1728`. Titles also collide: `ends with` matches any session whose title is a suffix of another's. |
| Write a marker title, match it, restore | Same race — lost by definition on a busy session, which is exactly when you want to jump. |
| Match by position (ordinal) | Untitled sessions all share the tab name `Claude Code`, and the tab strip's order is **not** session start order (verified by comparing each session's tty against the strip). One manually opened or dragged tab and the jump lands somewhere confidently wrong. |

A wrong jump is worse than no jump, so none of these are used any more.

## How it works now

1. **Claude stops painting titles.** `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`
   (see [Setup](#setup)) hands title control to us. Undocumented but real —
   found by grepping the CLI binary for `CLAUDE_CODE_*TITLE*`.
2. **The plugin stamps every tab** (`src/tab-title.ts`). Each live interactive
   session gets a unique canonical name written as an OSC 2 sequence
   (`ESC ] 2 ; <name> BEL`) directly to `/dev/<tty>` of the session's pid. The
   controlling tty **is** that tab's pty, so the write cannot land on the wrong
   tab, and it goes to the output path — the running TUI never sees it on
   stdin. Re-asserted every 30 s in case something else (a shell prompt, the
   user) overwrites it.
3. **Focus is an exact match** (`src/ghostty-focus-mac.ts`): read
   `name of menu items` of the Window menu as one atomic snapshot, find the
   item whose name **equals** the canonical name, click it by numeric index.

Ghostty's Window menu is used rather than the accessibility window list
because **background native tabs are not AX windows** — System Events sees one
`AXStandardWindow` per window (the frontmost tab). The Window menu lists every
tab, background ones included.

### Canonical names

`canonicalTabTitle()` returns the session's **deck word** once the namer has
assigned one (`src/deck-namer.ts`), else `claude-<pid>`.

It deliberately never uses the session's *display label*: that falls back to
the cwd basename, which every session started in the same directory would
share — and a shared name is precisely the ambiguity this mechanism exists to
kill. Deck words are unique among live sessions by construction (the namer
refuses words already taken).

Side benefit: the Ghostty tab bar ends up showing the same one-word names as
the deck keys.

### Fallback ladder

```
exact canonical-title click
  └─ miss → re-stamp the tty, wait 250 ms, click again   (covers a drifted title)
       └─ miss → activate Ghostty (open -b) and stop     (never guesses a tab)
```

`open -b` is used for app activation rather than AppleScript `activate` so no
Apple Events permission is needed.

## Setup

- **`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` must be set** before `claude`
  starts. Without it the mechanism silently degrades: Claude keeps repainting,
  the exact match misses, and every press falls through to plain app focus.
  Set it in `~/.claude/settings.json` (`env` block) and/or your shell rc.
- **Stream Deck.app needs Accessibility permission** (System Settings →
  Privacy & Security → Accessibility) — same prompt the Warp/VS Code paths
  need. Without it, menu reads fail and presses fall back to app focus.
- Sessions started *before* the env var was set keep Claude's animated title
  for their lifetime; their presses still work via the re-stamp tier, but they
  only become first-try exact after a restart.

## Troubleshooting

Every press logs its outcome. Watch
`com.julien.claudesessions.sdPlugin/logs/com.julien.claudesessions.0.log`:

| Log line | Meaning |
|---|---|
| `focus(ghostty): menu exact="x"` | Clean hit. |
| `menu exact="x" (re-stamped)` | Title had drifted; recovered. Expect this on pre-env-var sessions. |
| `ghostty exact miss (ERR:no-menu-match)` | No tab carries that name — usually a session whose tab was closed, or the env var isn't set. |
| `ERR:not-running` | Ghostty isn't running. |
| `timeout` | System Events is wedged, or Accessibility permission is missing. |
| `tab title: pid=N -> "x"` | A stamp was written (logged only when the name changes). |

Quick manual check — list what Ghostty currently calls its tabs:

```bash
osascript -e 'tell application "System Events" to tell process "Ghostty" \
  to get name of menu items of menu "Window" of menu bar item "Window" of menu bar 1'
```

Each live session should appear exactly once under its canonical name. Tabs
you opened by hand (plain shells) should match no canonical name at all.

## Implementation

- `src/tab-title.ts` — canonical names, tty resolution, OSC writes, per-tick
  re-assertion.
- `src/ghostty-focus.ts` — platform dispatch + options.
- `src/ghostty-focus-mac.ts` — exact menu match, re-stamp retry, app activation.
- `src/terminal-focus.ts` — routes `terminal: "ghostty"` here (stamped at
  SessionStart by the hook from `$TERM_PROGRAM`).
