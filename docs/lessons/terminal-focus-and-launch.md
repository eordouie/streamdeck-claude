# Terminal focus and tab launching — streamdeck-claude lessons

Part of streamdeck-claude LESSONS — split 2026-08-22.

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

## Ghostty on macOS cannot be told to open a tab

The AppleScript keystroke launcher in
`dotfiles/streamdeck/scripts/ghostty-new-agent.sh` (named
`ghostty-new-claude.sh` when this was written) looks like a workaround
waiting to be replaced. It is not. `ghostty +new-window` answers **"not
supported on this platform"** — Ghostty's IPC is Linux/D-Bus only, so there is
no CLI or socket that reaches the *running* instance on macOS.

`open -na Ghostty --args -e <cmd>` was measured as the alternative and is worse:
each invocation starts a **separate Ghostty application instance** (pids went
1 → 2 → 3 across two launches). That breaks tab focus outright — `tell process
"Ghostty"` is then ambiguous, and the observed window count went 1 before → 0
after because System Events resolved to a different instance.
`AppleWindowTabbingMode` is also unset (default `fullscreen`), so the tab-merge
path would not apply outside fullscreen anyway.

Typing keystrokes into the existing instance is the only mechanism that works.
Do not revisit without new upstream IPC support.

## A launcher exit code of 0 does not mean the command reached the right tab

`spawnCapture` reported `code 0` for every empty-slot press in a burst that
included a press whose command text was typed into an **already-running Claude
session's prompt** instead of a new tab. Two sessions launched correctly in the
same burst (pids 5508, 7712), so the script is not simply broken — it loses a
race intermittently.

The race is in `ghostty-new-agent.sh`: it sends Cmd+T, waits a blind
`delay 0.4`, then types. `assertGhosttyFrontmost` verifies the *application* is
frontmost but never that a **new tab actually appeared**, so if the tab isn't
ready the keystrokes go to whichever tab was already active. The script already
polls (rather than sleeps) for the cold-launch window — the Cmd+T path needs the
same treatment, and should abort rather than type if no new tab materialises.
Converting this failure into "nothing launched" is strictly better than "typed
into your session".

Corollary for diagnosis: the launcher's exit status is worthless as evidence
here. Check for a new session/pid, not a zero exit.

## A headless agent has no tab, and the focus chain will not tell you that

Pressing a background job's key walked the full back-compat focus chain — warp,
then VS Code, then Ghostty — missed all three, and logged
`no-tab-named "claude-43095"`. It cost ~2 s per press and could never have
succeeded: a bg job runs behind `--bg-pty-host` with no terminal tab anywhere.
`tab-title.ts` already knew this and skipped bg sessions when *stamping*
titles; nothing taught the *focus* path the same fact.

"No match" and "cannot match" are different answers and deserve different code.
The reachable thing is the interactive session that parked the job, which
Claude Code records as `parkedJobId` on the launcher and `jobId` on the job —
match them and the key has somewhere to go. Where the link is missing or
contested, resolve to **nothing** and say so: a bg tile is how a parked job
tells you it needs an answer, and sending that press to a merely plausible tab
means answering the wrong agent's question.
