# streamdeck-claude — Agent Context

Stream Deck plugin mirroring live Claude Code session state (fork of
JulienCr/streamdeck-claude, branch `ghostty-focus`; the plugin runs live
from this working tree).

## Project Data

| Path | Contents |
|---|---|
| `src/` | TypeScript plugin source (tick loop, render pipeline, terminal focus, process scan) |
| `com.julien.claudesessions.sdPlugin/` | Built plugin the Stream Deck app loads (`bin/plugin.js`, manifest, icons) |
| `hooks/` + `scripts/` | Claude Code hook bridge + install/build scripts |
| `.claude/skills/` | 2 repo-scoped skills (process introspection, WSL plugin dev) |
| `LESSONS.md` + `docs/lessons/` | Distillate + on-demand topic files (split 2026-08-22) |
| `docs/log/`, `docs/plans/`, `docs/specs/` | Effort logs, executable plans, design specs |
| `docs/reference/` | Long-form design narratives (fork-design.md) |

## Branch policy

Origin's default branch (`main`) is a pristine upstream mirror and carries no
fork work. All fork work lives on `ghostty-focus` — sessions and fresh clones
must check out `ghostty-focus`, and PRs base on it.

## Sibling libraries

None — standalone TypeScript plugin; imports nothing from `~/Projects/libs/*`
(runtime dependency: `@elgato/streamdeck` only).

## Lessons

`LESSONS.md` (9 KB distillate + routing index) → `docs/lessons/*.md`
topic files. Read the distillate before touching src/ or hooks/.

## What this is

README.md covers setup and the user-visible behaviour — read it before changing anything in `scripts/` or `hooks/`.

## Common commands

Use **pnpm** (not npm/npx) — see global memory.

For anything the
tests don't reach, verify by `pnpm build && pnpm sd:validate && pnpm sd:reload`,
then watch logs at `%APPDATA%\Elgato\StreamDeck\Plugins\com.julien.claudesessions.sdPlugin\logs\`
(Windows) or `~/Library/Logs/ElgatoStreamDeck/com.julien.claudesessions.sdPlugin/`
(macOS).

First time after building, you still need to quit + relaunch the SD app once so the new bundle picks up the reload-watcher.

## Architecture

Session discovery, env/UNC resolution, tick loop, render pipeline, reload trigger, hook pipeline: [`docs/architecture.md`](docs/architecture.md).

## Conventions worth knowing

- Touching anything PID- or path-related almost always means touching both origin branches (`wsl` / `windows`; the WSL branch is dormant on macOS).
- **All path/UNC math lives in `src/env.ts`** — never re-derive UNC paths inline elsewhere.
- Imports use the `.js` extension even for `.ts` files (NodeNext-style). Don't drop the extension.
- Three Stream Deck actions are registered: `com.julien.claudesessions.slot` (one key per live CC session, in `src/slot-action.ts`), `com.julien.claudesessions.setup` (a single maintenance key, in `src/setup-action.ts`), and `com.julien.claudesessions.command` (fork addition — runs a configured script, in `src/command-action.ts`). All use the `@action({ UUID: "..." })` decorator AND must be passed to `streamDeck.actions.registerAction(...)` — the decorator alone is not enough.
- The Setup action's key press (and its property inspector "Refresh States" button) calls `refreshNow()` in `plugin.ts`, which `wipeAllEventLogs()` (deletes every `<sid>.events.ndjson` across both source dirs) then runs an immediate `runSlowTick()`. The PI uses raw WebSocket against the Elgato bridge (`connectElgatoStreamDeckSocket`) — the SDK's TS API is plugin-side only.
- Background context for Stream Deck plugin development inside WSL lives in the local skill `streamdeck-plugin-wsl` (`.claude/skills/`); session-introspection internals (the `<pid>.json` schema, dual-namespace liveness, hook patterns) are in `claude-code-process-introspection`. Invoke them via the `Skill` tool when relevant.
- `docs/` holds reference notes (`architecture.md`, `development.md`, `warp-focus*.md`, `vscode-focus.md`, `ghostty-focus.md`). `docs/code-refacto.md` specifically is an audit doc, not authoritative — treat as a record of considered ideas, not a TODO list.

## Key files

| File | Role |
|---|---|
| `src/plugin.ts` | Entry: registers the three actions, runs the 1 s / 120 ms tick loops |
| `src/sessions.ts` | Reads session records (Claude + Codex bridge), `deriveState`, `pruneDeadSessions` orphan sweep |
| `src/session-events.ts` | Pure state machine — `reduceEvents` replays the NDJSON hook log |
| `src/state-tracker.ts` | Cross-tick bookkeeping: liveness promotion, attention flash, provisional merge |
| `src/process-scan.ts` | `ps` scan for agent CLIs; fd-0 TUI-vs-plumbing verdict |
| `src/pending-launch.ts` | Slot reservations keyed on the launch id (2 min TTL) |
| `src/provider-registry.ts` | Provider adapters keyed by opaque id (adapters in `src/providers/`) |
| `src/kill-suppression.ts` | Hides tiles for user-ordered kills (by pid + sid, 5 s ceiling) |
| `src/deck-namer.ts` | One-word session names via headless `claude -p` from the sentinel cwd |
| `src/icons/` | Render pipeline: theme / motifs / states / text / render |

## Fork invariants (eordouie / ghostty-focus)

This checkout is Ehsan's fork (`origin` = eordouie/streamdeck-claude,
`upstream` = JulienCr), branch `ghostty-focus`, targeting macOS + Ghostty on a
Stream Deck MK.2. The full design narrative and rationale live in
[`docs/reference/fork-design.md`](docs/reference/fork-design.md); the bare
invariants are:

- **`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` is required.** The plugin owns tab
  identity (OSC 2 titles written to the session's tty); Claude's animated
  title fights the stamp.
- **A free slot opens a tab, it does not start an agent.** One launch path
  (`openAgentTab`), one `[launch]` spec. **Do not reintroduce a per-key or
  per-provider launch command** — a second agent needs a session *reader*,
  not a launcher.
- **Nothing under `src/` may branch on a member of the agent list.** Provider
  ids are opaque strings; `provider === "codex"` is legal only inside that
  provider's own adapter for a mechanical difference. Provider parity is the
  contract: the only intended difference between a Claude and a Codex session
  is the word on the tile.
- Process scan (`process-scan.ts` + `provisional-sessions.ts`) rules:
  - **fd 0 is the verdict** — a TUI has the terminal on fd 0, plumbing has a
    pipe; the `ps` tty is a pre-filter only. Fails closed: no terminal, no tile.
  - **Provisional sessions never reach file code** — `state-tracker.ts`
    appends them after `readAllSessions` and passes only `recorded` to
    `pruneDeadSessions`.
  - **The pid is the handoff** — the real record's pid dedupe drops the
    provisional twin; equal ages keep the tile in place.
  - **You cannot read the launch id from the process** (macOS hides other
    processes' env) — the tab writes its tty under its launch id
    (`launch-tty.ts`), and the tty joins process to slot.
- Kill-suppression (`kill-suppression.ts`) keep-rules: mark only when
  `killSession` reports `terminated`; suppress by **pid as well as session
  id**; keep the 5 s ceiling so a signal-surviving process reappears.
- **No slot-number badge** on keys; **no `showOk`** on a slot press or a
  kill — the new tab (or the tile going dark) is the feedback.
- `~/.claude/streamdeck-agents.json` declares the agent list (config, not
  code). Shape: `{ "agents": { "<provider>": ["<binary>", …], … },
  "untaggedAgent": "claude" }`. Absent file = built-in default
  (claude + codex, claude untagged).
- **Deck config lives in dotfiles, not here** (keeps the fork upstreamable):
  `~/Projects/dotfiles/streamdeck/layout.toml` (key layout + the `[launch]`
  table), `apply-layout.sh` (quit app → regenerate page manifest → relaunch),
  `scripts/ghostty-new-agent.sh` (the tab launcher). Details in fork-design.md.
- **macOS hooks register in the synced `~/.claude/settings.json`** via the
  `streamdeck_claude_bridge.py` guard-shim. `~/.claude/settings.local.json`
  is **not** a scope Claude Code reads — hooks placed there never fire.

Operating gotchas: `LESSONS.md` — its routing index says which
`docs/lessons/` topic file to read for what you are touching.

## Where new facts go

Workspace routing: [`~/Projects/agent-workflow.md`](../agent-workflow.md). Plugin
gotchas → `LESSONS.md` / `docs/lessons/`; effort logs →
`docs/log/YYYY-MM-DD-<topic>.md`; executable plans → `docs/plans/`
(Status header mandatory); design specs → `docs/specs/`; repo-scoped
procedures → `.claude/skills/`; deck-wide capture runs via `/deck-capture`.
