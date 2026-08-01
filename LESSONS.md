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

## Ghostty background tabs are not AX windows — reach them via the Window menu

First tab-jump attempt (2026-07-31) enumerated `windows of process "Ghostty"`
and AXRaised the best match. It could never work: with N native tabs, System
Events sees ONE AXStandardWindow per window (the frontmost tab); background
tabs are absent from the AX window list entirely. What DOES list every tab,
live titles included, is Ghostty's **Window menu** — `click menu item <idx>`
selects a background tab fine.

Two mechanics that matter when driving that menu:
- Read `name of menu items` as ONE atomic list and click by **numeric index**.
  Per-item specifiers re-resolve by name on access, so a name that changes
  in between (Claude animates a spinner into it) fails with `-1728`.
- cwd is useless as a join key: every deck-launched tab starts in the same
  working directory, so cwd-token scoring is degenerate by design.

Which tab belongs to which session is a separate problem — see the next
lesson; matching on titles you don't control is a dead end.

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

## A tool that drives Claude Code will meet its own reflection

Two self-reference traps hit within an hour of each other (2026-07-31), both
in the deck-name feature:

- The namer picks a session's word with a headless `claude -p` call — which
  *is* a Claude Code session, so it appeared on the deck, took a slot, and
  triggered naming for itself, recursively. Fix: run it from a sentinel cwd
  (`~/.claude/deck-namer`) that the session reader filters out. Any component
  that shells out to the thing it monitors needs a way to recognise its own
  reflection.
- The tab's canonical name first fell back to the session's display label,
  which falls back to the cwd basename — so five sessions started in the same
  directory were all named "Projects", and exact matching became a coin flip.
  A name used as an identity must be unique **by construction**, not by
  coincidence; derive it from something already unique (the pid, or a word the
  namer refuses to reuse).

## Elgato's built-in action settings are a private schema

The system actions (Text, Hotkey, Multi Action) declare `PrivateAPI: true`
— their Settings shapes live in the app binary, and factory profiles only
carry *unset* examples (`NativeCode: -1`). Guessed encodings fail silently.
That's why command keys here are a first-party plugin action
(`com.julien.claudesessions.command`) with explicit settings instead of
profile-baked built-ins.

## `<clipPath>` outside `<defs>` renders as a black box

Making the `working` mascot walk off one edge and back in the other needed
the character hidden at the frame. The first attempt clipped the motif with
a `<clipPath>` emitted as a plain child of the motif group. On the deck the
key turned into a black rectangle with only two slivers of border showing:
the Stream Deck app painted the clip's `<rect>` as ordinary content — the
128x264 rect, default black fill, covering everything but the left and right
edges.

Clipping itself is fine. `icons/text.ts` has clipped the marquee since day
one — the difference is that it wraps its `<clipPath>` in `<defs>`. Outside
`<defs>`, the element is drawn.

Two things worth keeping from this:

- **resvg is more forgiving than the deck.** The local `@resvg/resvg-js`
  preview honoured the stray clip and looked perfect, so the filmstrip
  actively hid the bug. A preview proves geometry, never renderer support —
  anything relying on an SVG feature has to be seen on the hardware.
- **Paint order beat the clip anyway.** Drawing the border *after* the motif
  gets the same result with nothing but z-order, and it is what the effect
  wanted in the first place: the mascot passes behind the frame. Reach for
  ordering before reaching for a renderer feature.

A third trap, in the preview harness rather than the plugin: compositing
tiles into one sheet with `<g transform>` lets a tile's off-screen wrap copy
paint over its neighbour, which looked exactly like a duplicate-sprite bug.
Each key on the deck is its own 144x144 image and has no neighbours. Use a
nested `<svg>` per tile — it establishes a viewport and clips to it — or the
harness will invent bugs the product doesn't have.

## Desync is about when things change, not what they look like

The `subagent` motif walks the slot's mascot with three small copies of itself
in tow. Drawn from one sprite they read as one object stamped four times, so
each member runs its own frame offset (legs, breathing) and blink phase. Two
traps, both invisible in a still frame and only findable by doing the
arithmetic:

- **Offsets alias against the cycle they are offsetting.** The first blink
  stagger was `(i+1) * 1130 ms`. It looks like three distinct phases until you
  notice `3 x 1130 = 3390`, essentially the 3400 ms blink period — so the last
  baby blinked in lockstep with the parent, which is precisely what the offset
  existed to prevent. Any stagger has to be checked modulo the period it is
  spreading across, not just eyeballed for distinctness.
- **With N poses and more than N members, sharing a pose is unavoidable — so
  stagger the transitions instead.** The leg cycle has two poses and switches
  every 3 frames, giving only three distinct switch phases. Frame offsets that
  are multiples of 3 put a baby's stride change on the exact frame as the
  parent's: opposite pose, identical rhythm, which is what "in sync" looks like
  in motion. Offsets 1, 2, 4 keep every baby off the parent's switch frames.

Both were verified by printing the phases and the switch frames, not by looking
at a render. A still frame cannot show a rhythm.
