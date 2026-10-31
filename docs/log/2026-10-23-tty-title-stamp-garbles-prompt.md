# Tab-title stamp garbles the Claude Code prompt bar: effort log

> **Status:** DIAGNOSED 2026-10-23, no fix chosen yet.
> **Last updated:** 2026-10-23
> **Next step:** Ehsan picks a fix (stamp once and later / set titles through
> the Ghostty API instead of the tty / leave it and Ctrl+L).

## Symptom (Ehsan, 2026-10-23, screenshot 09:51)

Fresh session in a Ghostty tab, nothing typed yet. The prompt bar showed
three "question mark" glyphs in the middle of the input's top border, a
dimmed duplicate of the placeholder line prefixed with two dashes, and the
status line sitting where the bottom border belongs. "It was not like this
before."

## Findings

- The bar design did not change. Claude Code 2.1.306 (the version before the
  auto-updates of 2026-10-20 and 2026-10-22) and 2.1.309 draw the same six
  lines in a clean tmux pane: effort chip (`◈ max · /effort`) right-aligned
  on its own line, top border, input, bottom border, status line, mode hint.
  Captured at 185 and 120 columns.
- Zoomed, the three glyphs are U+FFFD replacement characters: the terminal
  received bytes it could not decode. One `─` is three UTF-8 bytes; if a
  foreign byte sequence lands between its lead byte and its continuation
  bytes the terminal prints three replacement glyphs for one dash. The border
  then becomes two cells too long, wraps, and every line below lands one row
  low. The wrapped `──` overwrote the `❯ ` of the old placeholder line, which
  is the "second prompt line" in the screenshot.
- The foreign bytes are ours. `src/tab-title.ts` writes the OSC 2 tab title
  straight into the session's tty device (`writeFile(dev, "\x1b]2;…\x07")`)
  and re-asserts it every 30 s (`REASSERT_MS`). The plugin log shows the
  stamp for this session (pid 29465, ttys001) at 13:50:53Z = 09:50:53 local,
  eight seconds before the screenshot, during Claude Code's start-up
  redraws; a second stamp followed at 09:51:44 when the first-prompt name
  landed. The file's own comment ("the running TUI never sees these bytes
  on its stdin") is true and beside the point: the bytes interleave with the
  TUI's *output* inside the terminal's decoder.
- The stamp has existed since 2026-07-31 (`a129c01`); the 2026-10-20 change
  (`dc3fd1d`, deck mirrors the tab strip, names from the first prompt) adds
  a second stamp in the first minute of every session, which is when Claude
  Code redraws most.
- Not reproduced on demand: forty OSC writes into a tmux pane during forced
  redraws stayed clean. The race needs the kernel to split Claude's frame
  write mid-character, which happens under load, not on cue.

## Remedy now

Ctrl+L redraws the frame; the garbage is gone until the next unlucky stamp.

## Fix options (open)

1. Stamp once per session, a few seconds after SessionStart, and drop the
   30 s re-assert. Small change; a stamp can still collide with a redraw.
2. Set the tab title through Ghostty's scripting API (the plugin already
   reads titles that way) and never write into the tty. No collision
   possible; depends on the API exposing a title setter.
3. Leave it. Cosmetic, Ctrl+L clears it.
