# Lessons — streamdeck-claude fork

Fork-specific gotchas (eordouie/ghostty-focus). Upstream docs live in
`docs/`; this file records what bit us while operating the plugin on the
MacBook Pro.

Split 2026-08-22: the rules that apply whatever you touch stay here; the
area-specific ones moved verbatim into `docs/lessons/`. The topic file for
the area you are editing is not optional reading — check the table first.

## Routing index

| Working on… | Read first |
|---|---|
| Ghostty tab focus, opening tabs, `ghostty-new-agent.sh`, the focus chain | [`docs/lessons/terminal-focus-and-launch.md`](docs/lessons/terminal-focus-and-launch.md) |
| `process-scan.ts`, liveness, the kill path, provider parity, hook gating | [`docs/lessons/agent-process-identity.md`](docs/lessons/agent-process-identity.md) |
| `src/icons/**` — motifs, mascots, animation phase, key-face text | [`docs/lessons/icon-rendering.md`](docs/lessons/icon-rendering.md) |
| `deck-namer.ts` or any headless `claude -p` helper in this repo | [`docs/lessons/headless-helpers.md`](docs/lessons/headless-helpers.md) |

What stays below: editing deck profiles, running the plugin from this
working tree, owned tab identity, telling a TUI from plumbing, recorded
sessions without terminals, and subagent liveness.

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

## An MCP server is the same binary as the TUI, on the same terminal

`process-scan.ts` turned any `codex`/`claude` process with a controlling
terminal into a deck tile, and the tty was documented as "the only thing"
keeping non-sessions off the deck. It is not. Every Claude Code session with the
Codex MCP server configured spawns

```
node /opt/homebrew/bin/codex mcp-server
  └─ …/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex mcp-server
```

as a **child of the interactive `claude`**, so it inherits `claude`'s tty. `ps
-Ao comm=` prints `codex` for it — byte-identical to a real TUI. The scan read
its cwd (inherited too) and drew a Codex tile labelled with the host session's
project. Two Claude sessions meant two phantom Codex tiles that lived exactly as
long as the sessions, which is why it read as "there is always a Codex session I
never opened".

Everything the process table offers is the same for both, measured: same `comm`,
same tty, same `pgid`, matching `tpgid`, both `S+`. Every foreground signal says
"this is the terminal's job", because it genuinely is.

**What separates them is fd 0.** A TUI somebody is typing into reads the terminal
(`f0 tCHR n/dev/ttys000`); anything spawned as plumbing is handed pipes (`f0
tunix n->0x…`). Inheriting a tty does not put it on fd 0. One `lsof -a -d cwd,0`
answers it, and that call was already being made for the cwd, so the check is
free.

The first fix attempt was a per-provider subcommand denylist (`mcp-server`,
`exec`, …) plus a ppid walk for "an agent spawned by an agent". Both worked and
both were wrong in kind: they taught the scanner Codex's CLI grammar, so every
new headless verb upstream ships is a future phantom and a future release. Prefer
the structural test — it is shorter, needs no verb lists, and covers agents this
repo has never heard of. **When a rule needs to know a provider's vocabulary to
work, look for the OS-level fact it is standing in for.**

Fails closed on purpose: no positive proof of a terminal means no tile. The cost
is a tile that appears late (only ever in the pre-record window); the cost of
failing open is a phantom that never leaves.

Side note also measured: macOS `ps` does **not** truncate `args=` when stdout is
a pipe (a 1948-char line came through whole), in case argv is ever needed here.

## A live recorded pid is not proof of a terminal session

Ghost "options" tile (2026-08-25): Claude Desktop's local agent mode spawns a
stream-json `claude` child that writes `~/.claude/sessions/<pid>.json`, fires
hooks (a real events.ndjson), earns a deck name, and stays alive as long as
the desktop conversation — 18 h observed, outliving every real session. Every
signal the plugin trusted said "session": live pid, valid record,
`kind: "interactive"`. What it lacks is a terminal — fd 0 is a unix socket,
and the record says so itself: `entrypoint: "claude-desktop"` vs `"cli"`.

Fix: deck membership requires the record to *declare* the terminal entrypoint
(`terminalHostedEntry` in terminal-kind.ts — "cli" or a pre-field record).
Allowlist, fails closed, same philosophy as the fd-0 verdict for scanned
processes: no proof of a terminal, no tile.

Two placement rules for whoever touches this next: filter at **display level**
(state-tracker), never in the reader — a record dropped at read time is exempt
from `pruneDeadSessions` and thrashes the json cache, so its files would sit
unread-but-re-stat'd forever after death; and hidden sessions must be skipped
in the naming loop, or every desktop conversation burns a headless naming call
and a deck word.

## SubagentStart and SubagentStop are not a pair

The `subagent` family motif died seconds after every spawn while agents kept
running for twenty more minutes. Root cause, measured on a live workflow
session: **21 SubagentStart events against 178 SubagentStop events.**
Workflow-tool agents fire stops without ever firing starts, so
`depth = starts − stops` floored to zero on the first unmatched stop and the
kids vanished. The FIFO badge list died the same death — every foreign stop
`slice(1)`d a start it didn't own.

What the raw payloads actually carry (probed by teeing `$INPUT`, 2026-08-20):
every hook fire that happens INSIDE a subagent — tool events included —
carries `agent_id`/`agent_type`, and main-thread fires carry neither; and
`SubagentStop` (only it) carries `background_tasks`, the authoritative array
of still-running tasks. The hook was dropping all of it. Liveness is now a
SET keyed on agent_id: any agent-context event upserts (a workflow agent's
first tool call is the only birth certificate it ever presents), the agent's
own stop removes, and each stop's snapshot reconciles the set both ways.
Deleting an id a foreign stop never added is a no-op, which is the property
depth counting lacked.

Two traps for whoever touches this next: a stopping agent can appear in its
own stop's `background_tasks` (observed live — apply the snapshot, THEN
delete the stopper), and `background_tasks` absent is not `background_tasks`
empty (old-CC lines make no claim; `[]` means nothing is running). The TTL
that ages a silent agent out must exceed the longest single tool call — Bash
caps at 10 min, so 15 — because an agent inside one long call emits nothing
between its PreToolUse and PostToolUse.

## gh on this fork resolves PRs to upstream by default (2026-08-28)

`gh pr create` here targets the fork parent (JulienCr/streamdeck-claude)
unless told otherwise, and fails with "Base ref must be a branch"
because upstream has no `ghostty-focus`. Every PR in this repo needs
`--repo eordouie/streamdeck-claude`. Bit live on the task13-checkers PR.

## hook-check.ts is not importable standalone on macOS (2026-08-28)

`src/hook-check.ts` throws at import without `WSL_DISTRO_NAME` set:
`env.ts` `assertResolved` expects rollup's build-time substitution.
Verify the runtime checker with that env var set, or through the built
plugin — never by bare ts-node/tsx import.
