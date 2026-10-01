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
3. **Focus is an exact match** (`src/ghostty-focus-mac.ts`), tried two ways:
   - **Terminal title, through Ghostty's AppleScript** (`src/ghostty-script.ts`,
     Ghostty 1.3+): `focus` the terminal whose `name` **equals** the canonical
     name; Ghostty selects its tab and raises its window.
   - **Window menu, through System Events** (fallback when that API can't be
     asked — no Automation grant, older Ghostty): read `name of menu items` as
     one atomic snapshot, find the item whose name **equals** the canonical
     name, click it by numeric index.

The terminal path comes first because a **tab renamed by hand** (View >
Change Tab Title…) shows its hand-set name in the tab strip and the Window
menu and ignores every OSC 2 title from then on. The terminal inside it still
reports the stamp: measured 2026-10-01, tab `claude-33832-Humain`, its terminal
`claude-33832-nebula`. Only the terminal match reaches that tab.

Ghostty's Window menu is used rather than the accessibility window list
because **background native tabs are not AX windows** — System Events sees one
`AXStandardWindow` per window (the frontmost tab). The Window menu lists every
tab, background ones included.

Stamps are confirmed the same way: 4 s after a write, the plugin checks that
some terminal carries the title (tab names on the fallback path). A stamp that
did not stick is logged as `contested` and left alone for 10 min.

**One tab, one stamp.** Only processes that are on the deck get stamped, and a
process stopped with Ctrl+Z (`ps` stat `T`) is not on the deck. Before
2026-10-01 a suspended Claude and the session that resumed its conversation in
the same tab both stamped that tty, and the tab name flipped between their two
titles every few minutes.

### Canonical names

`canonicalTabTitle()` (in `src/naming-policy.ts`) returns
`claude-<pid>-<word>` once the namer has assigned the session's one-word
deck name (`src/deck-namer.ts`), else `claude-<pid>`. The word persists in
`<sid>.deckname` past session death, so a resumed conversation (same sid)
reclaims it; the pid part keeps every live title unique even if a dormant
conversation's word gets reused.

It deliberately never uses the session's *display label*: that falls back to
the cwd basename, which every session started in the same directory would
share — and a shared name is precisely the ambiguity this mechanism exists to
kill. Deck words are unique among live sessions by construction (the namer
refuses words already taken).

Side benefit: the Ghostty tab bar ends up carrying the deck's one-word names,
embedded in the stable `claude-<pid>-<word>` convention.

### Fallback ladder

```
exact match: terminal title (Ghostty API), else Window-menu tab name
  └─ miss → re-stamp the tty, wait 250 ms, match again   (covers a drifted title)
       └─ miss → activate Ghostty (open -b) and stop     (never guesses a tab)
```

`open -b` is used for app activation rather than AppleScript `activate`, so
activation works even without the Automation grant.

## Setup

- **`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` must be set** before `claude`
  starts. Without it the mechanism silently degrades: Claude keeps repainting,
  the exact match misses, and every press falls through to plain app focus.
  Set it in `~/.claude/settings.json` (`env` block) and/or your shell rc.
- **Stream Deck.app needs Automation access to Ghostty** (System Settings →
  Privacy & Security → Automation; macOS asks once, the first time the plugin
  talks to Ghostty). Without it the plugin falls back to the Window menu, logs
  `ghostty api unavailable (…)` once, and a tab renamed by hand is unreachable.
- **Stream Deck.app needs Accessibility permission** (System Settings →
  Privacy & Security → Accessibility) — same prompt the Warp/VS Code paths
  need. Without it, menu reads fail and presses fall back to app focus.
- Sessions started *before* the env var was set keep Claude's animated title
  for their lifetime; their presses still work via the re-stamp tier, but they
  only become first-try exact after a restart. That is the ONLY case a restart
  fixes — a renamed tab or a suspended twin survives it (see Troubleshooting).

## Troubleshooting

Every press logs its outcome. Watch
`com.julien.claudesessions.sdPlugin/logs/com.julien.claudesessions.0.log`:

| Log line | Meaning |
|---|---|
| `focus(ghostty): terminal exact="x"` | Clean hit through Ghostty's API. |
| `focus(ghostty): menu exact="x"` | Clean hit through the Window menu (API unavailable). |
| `… exact="x" (re-stamped)` | Title had drifted; recovered. Expect this on pre-env-var sessions. |
| `ghostty exact miss (terminal no-match, menu ERR:no-menu-match)` | No terminal or tab carries that name — usually a session whose tab was closed, or the env var isn't set. |
| `ghostty api unavailable (…)` | The Ghostty API call failed; `-1743` = no Automation grant, `timeout` = a consent prompt is waiting. Logged once; the Window menu is used meanwhile. |
| `tab title contested for pid=N` | The stamp did not stick. On the API path: something else writes that terminal's title. On the menu path it can also be a tab renamed by hand. |
| `tick: … suspended=PID` | A process stopped with Ctrl+Z (`ps` stat `T`): kept alive, no key, no stamp. |
| `ERR:not-running` | Ghostty isn't running. |
| `timeout` | System Events is wedged, or Accessibility permission is missing. |
| `tab title: pid=N -> "x"` | A stamp was written (logged only when the name changes). |

Quick manual check — tab names next to the titles their terminals carry:

```bash
osascript -e 'tell application "Ghostty" to get name of every terminal'
osascript -e 'tell application "System Events" to tell process "Ghostty" to get name of menu items of menu "Window" of menu bar item "Window" of menu bar 1'
```

Each live session should appear exactly once under its canonical name in the
first list. A tab whose menu name differs from its terminal's title was
renamed by hand. Tabs you opened by hand (plain shells) should match no
canonical name at all. Avoid `name of every tab of every window`: that nested
specifier hung for over 80 s on Ghostty 1.3.1.

Two causes that look like "the deck is wrong" and that no restart fixes:

- **A suspended agent.** `ps -o pid,stat,tty -p <pids>` shows `T`. It sits in
  that tab's shell job table until `fg` or the tab closes. The deck hides it.
- **A tab renamed by hand.** The key still jumps there (terminal match), but
  the tab shows your name and the key shows the deck word.

## Implementation

- `src/tab-title.ts` — canonical names, tty resolution, OSC writes, per-tick
  re-assertion.
- `src/ghostty-focus.ts` — platform dispatch + options.
- `src/ghostty-focus-mac.ts` — exact match (terminal, then menu), re-stamp retry, app activation.
- `src/ghostty-script.ts` — Ghostty AppleScript: terminal titles, focus, front terminal; 60 s backoff after a failure.
- `src/terminal-focus.ts` — routes `terminal: "ghostty"` here (stamped at
  SessionStart by the hook from `$TERM_PROGRAM`).
