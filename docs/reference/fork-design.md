# Fork design — eordouie / ghostty-focus

> Extracted from the repo L2 2026-08-24 (structure audit) — canonical home;
> `agent-workflow.md` keeps the invariants + a pointer. File paths are
> repo-root-relative unless prefixed.

This checkout is Ehsan's fork (`origin` = eordouie/streamdeck-claude,
`upstream` = JulienCr). Branch `ghostty-focus`, based on upstream's
`feat/vscode-terminal-focus`. Target: **macOS + Ghostty**, eight session slots
plus command keys on a Stream Deck MK.2.

## What the fork adds

**Ghostty backend with owned tab identity.** The hook stamps
`TERM_PROGRAM=ghostty` at SessionStart; `terminal-focus.ts` routes those
sessions to `ghostty-focus(-mac).ts`. The plugin **assigns** each tab its
identity rather than inferring one: `tab-title.ts` writes a unique canonical
name (`claude-<pid>-<word>` once named, else `claude-<pid>`) as an OSC 2 sequence to `/dev/<tty>` of
the session's pid — the tty *is* that tab's pty — re-asserting every 30 s.
Focus is then an exact Window-menu match, with re-stamp-and-retry, then app
activation; it never guesses a tab. **Requires
`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`** or Claude's animated title fights the
stamp. Full rationale and the three mechanisms this replaced:
[`docs/ghostty-focus.md`](../ghostty-focus.md).

**One deliberate word per session** (`deck-namer.ts`). Once a session has real
context (first substantial prompt and/or Claude's generated title), a single
headless `claude -p --model haiku` call picks ONE distinguishing lowercase
word. Persisted to `~/.claude/sessions/<sid>.deckname`, never changed for the
session's life, and kept past SessionEnd so a plain `claude --resume` (same
sid) reclaims it; dormant sidecars age out after 30 days dead. Until then the key shows the cwd
basename. Resumed sessions whose truncated events log has no substantial
prompt yet are named from the transcript's original first prompt
(`readFirstUserPrompt` in `transcript-title.ts`). The namer runs from a
**sentinel cwd** (`~/.claude/deck-namer`) that
`sessions.ts` filters out — its own headless session would otherwise occupy a
slot and recursively trigger naming.

**Attention flash** (`state-tracker.ts`). A busy → needs-you transition
(idle/awaiting/permission/plan/question/error) arms a per-session flag; the
tile pulses and strobes its border white until the key is pressed
(`acknowledge()`) or the session goes busy again. Static idle does not flash —
only "finished or needs input *since you last engaged it*".

**Per-slot mascots** (`icons/motifs.ts`). Each key position gets its own pixel
character, in key order: Clawd, Chrome T-Rex, blue sauropod, silly goose, baby
elephant, an olive-green stegosaurus, llama, panda. All walk in place on idle
(leg poses alternating every 3 frames + torso bob) and blink on a shared
cadence with per-slot phase offsets; `working` walks the character across the
key and `subagent` gives it four desynchronised babies (`slotCharacterWalk` /
`subagentWalk`). What DRIVES `subagent` is a live-set keyed on the hook's
`agent_id` (reconciled by the `bgIds` snapshot every SubagentStop carries) —
never start/stop depth, which CC does not pair — and it outlives the turn:
the family keeps walking on an idle rawStatus while background agents run.

The single `MASCOTS` table owns each character's draw function, travel
direction, and foot line together. Those were three parallel
`switch ((slot - 1) % 5)` blocks, which is how you end up with a mascot that
moonwalks or a family whose babies hover. A fourth field, `drawBaby`, is
optional and defaults to the parent's own draw function — every current baby
is believably just a small copy of its parent (the stegosaurus's included: a
scaled-down copy with smaller plates reads fine as a hatchling). Nothing
currently uses `drawBaby`, but keep the field — the hen/chick and cat/kitten
pairs that occupied this slot before both needed it. (The stegosaurus is that
slot's third occupant: a hen went through four rejected rebuilds, a cat went
through two more, and both got replaced outright rather than rebuilt a fifth
or third time — see [`docs/lessons/icon-rendering.md`](../lessons/icon-rendering.md).)

Two drawing rules learned the hard way: **leg tops must tuck one unit under
the body**, or the walk bob opens a seam; and a character darker than the key
background needs a rim light and a catchlight eye, or it renders as a
character-shaped hole.

**Command keys** (`command-action.ts`, UUID
`com.julien.claudesessions.command`). Profile-baked `{label, script, args,
color}` settings; a press spawns the script. Exists because Elgato's built-in
Text/Hotkey/Multi Action settings are a private schema (see `LESSONS.md`).
Currently unused on the deck — every command key was retired in favor of
deck-signals' ambient keys — but the action remains available.

**A free slot opens a tab, it does not start an agent** (2026-08-17). Pressing an
empty slot runs `ghostty-new-agent.sh` with no command: one fresh Ghostty tab at
a bare prompt, and the user types `claude`, `codex`, or whatever else. The deck
never chooses the agent — that was the whole point of the change, and it is why
`slot-action.ts` has one launch path (`openAgentTab`) instead of a gesture
resolver, why the profile carries a single `launch` spec instead of a
`providerLaunches` table, and why `AgentProvider` has no `launch` member at all.
Superseded: tap→Claude / hold→Codex (`EMPTY_HOLD_MS`, `emptyHoldFired`, the
launch-on-KeyUp dance), and the `emptyScript`/`emptyArgs`/`emptyHoldArgs`
settings. **Do not reintroduce a per-key or per-provider launch command**; if a
second agent needs deck support it needs a session *reader*, not a launcher.

**The launch ID is the whole binding mechanism.** The tab's shell is spawned by
Ghostty, so it inherits nothing from the plugin: `buildLaunchCommand` puts
`STREAMDECK_LAUNCH_ID` into `STREAMDECK_LAUNCH_PREFIX`, the launcher types that
prefix into the new tab, and whatever agent the user then types inherits it and
stamps it through its hook. `PendingLaunches` matches on that id **alone** —
never on provider, because the gesture no longer knows which agent will claim the
key. Reservations last `DEFAULT_PENDING_TTL_MS` (2 min): the wait is a human
typing, not a process starting.

**A reserved slot renders as free.** The tab sits at a prompt until an agent is
typed, so the reserved key shows the resting mascot, not a walking one — a
walking mascot means a real session. The new tab is the only feedback a press
owes you (same rule as the no-`showOk` one below).

**A running agent gets a tile even with no record of its own**
(`process-scan.ts` + `provisional-sessions.ts`, 2026-08-17). Codex is why: its
TUI fires `SessionStart` when the *conversation* starts, not when the process
does, and it writes no rollout file before then — measured, a trusted, fully
started `codex` sat idle for 40 s having produced nothing on disk anywhere. So
each tick also scans `ps` for agent CLIs and turns any unclaimed one into a
normal `SessionInfo` (idle, aged by `ps -o lstart=`, cwd from `lsof`). Rules that
must survive edits here:

- **The process table says WHICH binary; fd 0 says whether anybody is typing
  into it.** A real tty in `ps` is a cheap pre-filter only. The verdict is
  `readProcessIo`: fd 0 is the terminal for a TUI (`f0 tCHR n/dev/ttys000`) and a
  pipe for anything spawned as plumbing (`f0 tunix n->0x…`) — MCP servers,
  app-servers, `--print` runs, and whatever the next agent calls its headless
  mode. This is deliberately provider-agnostic: `codex mcp-server` shares the
  TUI's binary name, tty, cwd, process group and `S+` state, and inherits its
  HOST session's terminal, so nothing but stdio can separate them. It costs no
  extra spawn — the same `lsof` already read the cwd. Fails closed: no proof of a
  terminal, no tile. See `LESSONS.md`, "An MCP server is the same binary".
- **Provisional sessions must never reach file code.** They have no files;
  `state-tracker.ts` appends them after `readAllSessions` and passes only
  `recorded` to `pruneDeadSessions`.
- **The pid is the handoff.** When the real record lands, the pid dedupe drops the
  provisional twin, and equal ages keep the tile in place. No special case.
- **You cannot read the launch id from the process.** macOS returns no
  environment for another process — `ps -E` yields nothing even for a child we
  spawned ourselves, and a `ps eww` dump shows only the exec-time environment, so
  a variable exported by typing into a shell is invisible there too. The agent
  does inherit `STREAMDECK_LAUNCH_ID` (that is how its hook reports it); it just
  cannot be read back from outside. Hence the tab writes its tty under its launch
  id (`launch-tty.ts`), and the tty joins process to slot.

**The agent list is config, not code** (`agent-config.ts`, 2026-08-20).
`~/.claude/streamdeck-agents.json` declares which CLIs count as agents and which
one's tiles go untagged:

```json
{
  "agents": { "claude": ["claude", "claude.exe"], "codex": ["codex"], "gemini": ["gemini"] },
  "untaggedAgent": "claude"
}
```

Absent file = the built-in default (claude + codex, claude untagged), so nothing
breaks on a machine without it. Adding an agent is that one line plus `pnpm
sd:reload` — no code edit, no release. A provider declares a LIST of binaries
because `claude` and `claude.exe` are both Claude Code; matching also accepts
npm's per-arch suffix (`codex-darwin-arm64`).

Why a list at all, given it looks like the coupling it replaced: nothing at the
OS level distinguishes an LLM CLI from `vim` — both are interactive programs
holding a terminal — so discovery by shape alone would tile every editor and
pager. The list is irreducible; its LOCATION was the fixable part.

**The rule that keeps it honest: nothing under `src/` may branch on a member of
that list.** Provider ids flow through as opaque strings. `provider === "codex"`
is allowed only inside that provider's own reader/adapter, where the difference
is a genuinely mechanical one (a different on-disk layout, a different liveness
probe). Everything else is either a preference — which belongs in
`agent-config.ts` — or a bug. The four `?? "claude"` defaults that used to sit in
`kill-session.ts`, `slot-action.ts` and `naming-policy.ts` were exactly that bug:
a session whose provider went missing got Claude's namespace, Claude's kill
guard, and Claude's tab title. Provider is now required at every one of them, and
a slot that cannot say which agent it holds is treated as UNBOUND rather than
assumed to be Claude.

Still coupled, deliberately, and the remaining debt: `sessions.ts`'s prune logic
knows Claude writes `<pid>.json` while the Codex bridge writes
`<sessionId>.json`. That is real mechanical knowledge, but it belongs in each
adapter rather than in shared code — the next step if a third agent ever needs
pruning.

**Provider parity is the contract.** The only intended difference between a
Claude session and a Codex one is the word `claude` vs `codex`. Every
`provider === …` branch must justify itself as a *mechanical* difference — a
different reader (pid JSON vs bridge record), a different on-disk layout to
prune. Anything else is a regression: an audit on 2026-08-14 cut 12 branches to
7 and found five that were purely gratuitous (Codex excluded from the deck-word
namer, a truncated-session-id tab title, a cwd-basename label, never
`killable`, self-reported liveness). Launching left the list entirely on
2026-08-17 — there is nothing provider-shaped about opening a tab. Before adding
a provider branch, ask whether the mechanism genuinely differs or whether you are
just special-casing the newer provider.

**Only Codex is tagged on the tile.** `providerLabel` renders on the bottom line
for Codex and is absent for Claude. Labelling both was tried the day the bare-tab
launch landed and rejected on sight (Ehsan, 2026-08-17): the tag marks the
exception, and `claude` written across almost every tile is noise on a 72px key.
A bare tile reads as Claude.

**Log every empty-slot launch, not just failures.** The launcher can exit 0
having typed into the WRONG tab (the Cmd+T keystroke race, see
[`docs/lessons/terminal-focus-and-launch.md`](../lessons/terminal-focus-and-launch.md)),
which is indistinguishable from "the key did nothing", so `openAgentTab` logs
`script=… launchId=…` on every invocation.

**Hook additions** (`hooks/notification.sh`): stamps `transcript_path` and the
terminal kind at SessionStart, clips each `UserPromptSubmit` prompt (200
chars) so the reducer can capture the session's first substantial prompt for
naming context. The `.deckname` sidecar survives SessionEnd for resume.

**The Codex bridge records only tty-backed sessions**
(`hooks/codex-notification.sh`, 2026-08-21). SessionStart requires the resolved
codex ancestor to have a terminal on fd 0, and later events never create a
record SessionStart refused — every codex frontend shares `~/.codex` and its
hooks, so `codex mcp-server` under a Claude session and the ChatGPT app's
bundled `codex app-server` otherwise tile as ghost sessions (see
[`docs/lessons/agent-process-identity.md`](../lessons/agent-process-identity.md)).
The `.ps1` mirror carries only the record-existence half — Windows has no cheap
fd-0 probe from a hook.

**No slot-number badge** on keys, and **no `showOk` checkmark** on a slot
press — landing on the tab is the feedback. Nor on a kill: the checkmark covers
the key for about a second, which is exactly when the tile is supposed to be seen
going dark.

**A kill you ordered skips the `finished` flash** (`kill-suppression.ts`,
2026-08-17). `FINISHED_TTL_MS` exists so a session that ends on its OWN is not
simply gone unexplained; a 3 s hold is already that explanation, and waiting it
out made a kill feel like it took "a couple of good seconds". So `killSlot` marks
the session on a delivered signal, and the tracker drops it from display at once
and skips the promotion. Three rules to keep if you touch it: mark only when
`killSession` reports `terminated` (a refused kill must leave the tile alone);
suppress by **pid as well as session id**, because a dying agent can lose its
session file before its process, and the process scan would otherwise hand the
tile straight back as a provisional twin; and keep the 5 s ceiling — a process
that survives both signals must reappear rather than leave a live session hidden.

## Where the deck config lives (not here)

Key layout and key behaviours live in the dotfiles repo, deliberately, so this
fork's diff against upstream stays upstreamable:

- `~/.claude/streamdeck-agents.json` — which CLIs count as agents (see "The
  agent list is config, not code" above). Plugin-side, read from `homedir()`, and
  optional. NOT in dotfiles today; symlink it there if it should follow the
  machine.
- `~/Projects/dotfiles/streamdeck/layout.toml` — 14 keys declared: eight
  `com.julien.claudesessions.slot` entries, five on row 0 and three on row 1
  left (this plugin), plus six
  `kind = "signal"` entries on rows 1-2 belonging to the sibling
  `com.eordouie.decksignals` plugin (`~/Projects/deck-signals`) —
  `signal = "meeting" | "slack" | "github" | "repos" | "apps" | "mic"`, mapped to that
  plugin's action UUIDs by `build_claude_page.py`. The `command` kind/action
  still exists in both files but is currently unused on this deck: every
  command key was retired in favor of deck-signals' ambient keys (see that
  repo's design spec for the rule that decided it) and remains available if
  a command key is ever wanted again.
  The single `[launch]` table in the same file is what every slot key carries:
  the script that opens a bare agent tab, plus the environment that tab exports.
- `~/Projects/dotfiles/streamdeck/apply-layout.sh` — quit app → regenerate the
  page manifest → relaunch. `--dry-run` validates without writing.
- `~/Projects/dotfiles/streamdeck/scripts/*.sh` — `ghostty-new-agent.sh` (the
  tab launcher; no args = bare tab, args = typed as the tab's first command,
  which is how deck-signals' repos key opens `claude /sync-status`) and what any
  command key would run.

## macOS hook registration

Hooks are registered in the **synced** `~/.claude/settings.json`, pointing at
`dotfiles/claude/hooks/streamdeck_claude_bridge.py` — a guard-shim that
forwards to this repo's `hooks/notification.sh` on this Mac and exits 0 on
machines without the checkout. A user-level `~/.claude/settings.local.json` is
**not** a scope Claude Code reads; hooks placed there never fire (that cost a
debugging round). `hook-check.ts` / `check-hooks.sh` accept any command
mentioning `streamdeck[-_]claude`, so both direct and bridged registrations
pass.
