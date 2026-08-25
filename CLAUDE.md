# streamdeck-claude — Claude Code Context

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

A Stream Deck plugin that mirrors live Claude Code CLI session state on up to N keys. The runtime is a single Node process (`com.julien.claudesessions.sdPlugin/bin/plugin.js`) launched by the host Stream Deck app. Supported hosts: **Windows (with optional WSL sessions)** and **macOS**. On WSL/Windows the SD app reads the plugin folder over a `\\wsl.localhost\<distro>\…` symlink; on macOS it's a native symlink into `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`. README.md covers setup and the user-visible behaviour — read it before changing anything in `scripts/` or `hooks/`.

## Common commands

Use **pnpm** (not npm/npx) — see global memory.

```bash
pnpm build              # rollup → com.julien.claudesessions.sdPlugin/bin/plugin.js (terser in prod, sourcemaps in watch)
pnpm watch              # rollup -w + auto-touches the reload trigger after each rebuild
pnpm sd:reload          # touch ~/.claude/.streamdeck-claude.reload → plugin self-exits → SD app respawns it (~1s)
pnpm sd:validate        # @elgato/cli validate manifest + assets (sd-cli.sh pins HOME=/mnt/c/Users/$WIN_USER on WSL; native HOME on macOS)
pnpm sd:pack            # bundle dist/*.streamDeckPlugin for distribution
pnpm sd:dev             # enable Stream Deck developer mode (one-time)
pnpm sd:link / sd:unlink           # (re)create the Windows-side mklink /D into Plugins/
pnpm install:hook                  # register every event feeding reduceEvents into WSL ~/.claude/settings.json
pnpm install:hook:windows          # same for Windows %USERPROFILE%\.claude\settings.json (no copy — registers the .ps1 over UNC)
pnpm install:codex-hook            # register the Codex lifecycle bridge in ~/.codex
pnpm install:codex-hook:windows    # same for Windows-native Codex
pnpm check:hooks                   # diff installed hook config against what install-hook.sh would write
pnpm check:codex-hooks             # same for the Codex bridge registration
pnpm check:vscode                  # enumerate VS Code windows + show which one matches a given cwd (debug)
pnpm icons:render       # regenerate icons/*.svg reference assets from src/icons/
pnpm icons:static       # rasterize manifest PNGs from assets/svg/ via @resvg/resvg-js
pnpm drill              # synthesize fake sessions so the live deck walks every state (visual check)
```

`pnpm test` runs the tsx/node:test suite — 15 test files (`src/*.test.ts`),
including the fork-critical process-scan, pending-launch, provider-registry,
kill-suppression, naming-policy, and session-events suites. For anything the
tests don't reach, verify by `pnpm build && pnpm sd:validate && pnpm sd:reload`,
then watch logs at `%APPDATA%\Elgato\StreamDeck\Plugins\com.julien.claudesessions.sdPlugin\logs\`
(Windows) or `~/Library/Logs/ElgatoStreamDeck/com.julien.claudesessions.sdPlugin/`
(macOS).

The Elgato `streamdeck restart` / `streamdeck list` commands fail from WSL with `EIO` because they `readlink` a UNC-targeted symlink — use `pnpm sd:reload` instead. First time after building, you still need to quit + relaunch the SD app once so the new bundle picks up the reload-watcher.

## Architecture

### Dual-origin sessions (the core asymmetry)

Claude Code drops `~/.claude/sessions/<pid>.json` per running CLI session. On Windows the plugin may see two namespaces at once: PIDs from a WSL `claude` and PIDs from a Windows-native `claude.exe` — liveness must be checked separately. On macOS there's only the native namespace (no WSL), so the WSL branch is dormant.

- `src/sessions.ts` reads both `WSL_SESSIONS_DIR_FROM_WIN` (UNC) and `WIN_SESSIONS_DIR` when running on `win32`, only the WSL dir on Linux. Each `SessionInfo` carries an `origin: "wsl" | "windows"` tag that follows it through the pipeline.
- `src/live-pids.ts` checks `wsl` PIDs via `wsl.exe -d <distro> -- kill -0 <pid>` (batched as one bash command), and `windows` PIDs via a single `tasklist.exe /NH /FO CSV` dump that we intersect ourselves. (Multiple `/FI "PID eq N"` filters AND together in tasklist — they don't OR — so per-PID filtering is impossible; one big dump is cheaper than N spawns.) Both checks run in parallel and have a 10s `CACHE_FALLBACK_MS` to absorb transient empty/errored spawns without flickering all keys to "finished".

Touching anything PID- or path-related almost always means touching both branches.

### Path / environment resolution (`src/env.ts`)

The plugin runs inside the Stream Deck app on Windows where neither `HOME` nor `WSL_DISTRO_NAME` is set. Rollup's `inject-build-env` plugin (in `rollup.config.mjs`) replaces two sentinels (`__BUILD_WSL_HOME__`, `__BUILD_WSL_DISTRO__`) at build time with whatever was live in the WSL build shell. At runtime, real env vars take precedence; the baked values are the fallback. `assertResolved` throws if a sentinel survived (e.g. running an unbuilt module). **All path/UNC math lives in `env.ts`** — don't re-derive UNC paths inline elsewhere.

### Tick loop (`src/plugin.ts`)

Two intervals share the same `state-tracker.ts` instance:

- **Slow tick (1s):** `tracker.tick()` re-reads sessions + liveness + notify/plan files, computes the sorted `DisplayEntry[]`, and `renderAll()`s every slot. Re-entrancy guarded by `slowTickRunning`.
- **Animation tick (120ms):** advances `frame`, then renders only if `tracker.needsAnimation()` is true (any animated motif OR a marquee-overflowing label). Same guard pattern.

`createStateTracker()` owns the cross-tick bookkeeping: `prevLiveIds` (so a session is promoted to `finished` only when it was alive *last tick* — stale junk files from previous CC runs never appear) and `recentlyFinished` (carry-over for `FINISHED_TTL_MS = 3000`ms after death). Deck membership is also gated on the record's declared entrypoint (`terminalHostedEntry`): app-driven sessions (e.g. Claude Desktop agent mode) keep live, hook-firing records with no terminal tab and are excluded at display level only.

State priority for an idle session: `awaiting_plan` > `awaiting` > plain `idle`. See `deriveState()` in `sessions.ts`.

### Render pipeline (`src/render-loop.ts` + `src/icons/`)

`SlotAction.orderedActions()` sorts visible action instances by Stream Deck `(row, column)` — that's what defines slot 1..N. `renderAll()` zips slots with `DisplayEntry[]`, calls `renderIcon()` to produce an SVG, base64-encodes a `data:image/svg+xml;base64,…` URL, and only calls `setImage` when the URL changed (per-slot dedup via `slotState.lastSvg`). The clipboard payload (`session.cwd`, copied on key press) is refreshed every tick regardless.

Icon code is split per concern across `src/icons/`: `theme.ts` (constants), `motifs.ts` (animated SVG fragments per state), `states.ts` (the single `STATES` registry mapping each `SessionState` to palette + motif + animated flag), `text.ts` (label splitting + marquee), `render.ts` (compose the final SVG). Adding a new state = one entry in `STATES` + plumb it through `deriveState`.

### Terminal focus on slot press (`src/terminal-focus.ts` + per-backend modules)

Pressing a slot key tries to bring the terminal hosting the session forward
(best-effort, no-op when unmatched). `src/terminal-focus.ts` dispatches by the
session's `terminal` kind — stamped at `SessionStart` by the hook from
`$TERM_PROGRAM` and reduced into `SessionInfo.terminal`:

- **warp** → `warp-focus.ts` (macOS AppleScript / Windows Warp sqlite DB +
  Win32 keystroke). See `src/warp-db.ts`, `src/warp-cwd.ts`.
- **vscode** → `vscode-focus.ts`: raise the best-matching VS Code *window*
  (title-based scoring in `vscode-window-match.ts`; Windows enumerates via
  `Get-Process Code` + raises the HWND, macOS via System Events `AXRaise`).
  Window-level only — no integrated-terminal-tab precision.
- **iterm** → placeholder (not implemented).
- **other** → bare terminal, nothing to raise.
- **unknown** → back-compat: try Warp, then VS Code.

The Win32 foreground machinery (P/Invoke bundle + `runPowerShell`) is shared by
the Warp and VS Code Windows backends in `src/win32-raise.ts`. Clipboard
fallback (the session cwd) runs regardless so the user always has something to
paste. `scripts/check-warp` and `scripts/check-vscode.ts` are CLI sanity-checks
for the two read paths.

### Reload trigger (`src/reload-watcher.ts`)

`pnpm watch` and `pnpm sd:reload` both `touch ~/.claude/.streamdeck-claude.reload`. The plugin polls the file's mtime each second; when it changes, the plugin calls `process.exit(0)` and the SD app respawns it (this is the SD app's normal crash-recovery behaviour, repurposed). `PROCESS_START_MS` guards against looping on startup if the trigger file already exists.

### Hook pipeline (`hooks/` + `scripts/install-hook.sh`)

Every registered Claude Code event runs the same hook script (`notification.sh` on WSL, `notification.ps1` on Windows). Both do exactly one thing: append a single JSON line — `{"ts":…,"event":…,"tool":…?}` — to `~/.claude/sessions/<sid>.events.ndjson`. There is no mapping table; the bash and PowerShell scripts are tiny mirrors of each other. `SessionStart` truncates the log first (clean reset, bounds long-lived sessions); `SessionEnd` unlinks it.

The plugin reads each session's event log every tick and replays it through the pure state machine in `src/session-events.ts` (`reduceEvents`). That function is the single source of truth for state transitions — adding a new state means one new case there plus registering the event in `install-hook.sh`. No `events.json`, no per-state sidecar files, no mtime heuristics; the one TTL is agent liveness (`BG_AGENT_TTL_MS`, 15 min — must exceed the 10-min Bash tool cap, the longest silent gap a live agent can have mid-call; see LESSONS "SubagentStart and SubagentStop are not a pair").

The Windows hook is **not copied** — `install-hook.sh --target=windows` registers a PowerShell command that runs `hooks/notification.ps1` directly over `\\wsl.localhost\<distro>\…\hooks\notification.ps1`, so a single repo edit propagates to both. PID liveness still handles the case where a CC process dies hard (no `SessionEnd`): the session disappears from display via `state-tracker.ts`'s `prevLiveIds` check, and orphan sidecars (event logs and .deckname files whose sid has no session file — sids are UUIDs and never reused) are removed by the grace-gated orphan sweep in `pruneDeadSessions`.

## Conventions worth knowing

- TypeScript ESM (`"type": "module"`), Node 20, `strict: true`. Source is `src/**/*.ts`, output is `com.julien.claudesessions.sdPlugin/bin/plugin.js` (single bundled file via rollup).
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

Workspace routing: [`~/Projects/CLAUDE.md`](../CLAUDE.md). Plugin
gotchas → `LESSONS.md` / `docs/lessons/`; effort logs →
`docs/log/YYYY-MM-DD-<topic>.md`; executable plans → `docs/plans/`
(Status header mandatory); design specs → `docs/specs/`; repo-scoped
procedures → `.claude/skills/`; deck-wide capture runs via `/deck-capture`.
