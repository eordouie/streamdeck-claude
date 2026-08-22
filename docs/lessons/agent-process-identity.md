# Agent process identity, liveness and provider parity — streamdeck-claude lessons

Part of streamdeck-claude LESSONS — split 2026-08-22.

## Claude Code exposes its model but not its effort; Codex exposes both

Per-session model is structured on both sides — Claude writes `"model"` on every
assistant message, Codex writes `"model"` into every `turn_context` record — so
a tail read tracks mid-session `/model` switches on either.

Effort is asymmetric. Codex writes `"effort"` in `turn_context`; **Claude Code
has no effort field anywhere** — neither `~/.claude/sessions/<pid>.json` nor the
transcript. Its only trace is the `/effort` command's own output text ("Set
effort level to max"), which usually sits near the *start* of a session, so the
head chunk matters more than the tail. A session that never ran `/effort` leaves
no trace at all and must fall back to the `claude()` wrapper's pin (`max`) —
which misreports a `claude -q` session as `max` until the user touches
`/effort`.

## A self-reported liveness flag cannot detect a hard kill

Codex sessions were held live by their bridge record's own `active` field,
cleared by the `SessionEnd` hook. That works only when the session exits
cleanly: a crash, a `SIGKILL`, or a closed terminal leaves `active: true` on
disk forever, so the slot shows a session that no longer exists — and "shows a
dead session" is exactly the failure the pid-based path was built to avoid for
Claude.

The fix was to get a real pid and ask the OS (`kill -0`) like Claude does.
Getting that pid is the subtle part: the hook's `$PPID` is **not** reliably the
agent — depending on how Codex spawns hooks it can be a wrapping shell, whose
tty and lifetime are not the session's. Walk the parent chain to the nearest
process that actually is `codex` (verified by `ps -o comm=`), and record
**nothing** rather than a guess if no such ancestor exists — a wrong pid gets an
unrelated process killed on a kill-hold.

## One wrong sentence about a pid disabled three separate behaviours

A background job's `<pid>.json` was treated as untrustworthy on the grounds
that "its PID is a shared `--bg-spare` daemon." That sentence appears, in
French, in three places — `live-pids.ts`, `render-loop.ts`, `slot-action.ts` —
and it is wrong. The `--bg-spare` pool is shared, but a job that has been
**claimed** runs as its own dedicated process with its own private
`--bg-pty-host` parent. Verified live: job `13fb99e8` was pid 43095 under pty
host 43063, nothing shared about either.

Three behaviours were switched off by that one belief, and each looked like an
unrelated bug:

- **Liveness** fell back to "was the json rewritten in the last 90 s". A *busy*
  job stops rewriting its json, so working read as dead and the tile flapped on
  and off (`sessions=9 live=9` → `live=8` with nothing having died).
- **Hold-to-kill** was disabled outright, so the only tile you could not clear
  was the one you most wanted gone.
- **Pruning** skipped bg jsons forever, so dead ones accumulated unread.

The lesson is not "check your assumptions." It is that an assumption written as
a *justification comment* propagates by copy-paste into places that never
re-derive it, and each copy then reads as deliberate design. When you write
"we can't do X here because Y", Y is load-bearing — state how it was verified,
or someone will build three features around a guess.

## `claude` and `claude.exe` are both Claude Code

The kill path's identity guard — right in principle, since a `<pid>.json` can
outlive its process and pids get recycled — tested `comm === "claude"`.
Interactive sessions do run as `claude`. A background job runs as `claude.exe`,
the binary Claude Code execs behind `--bg-pty-host`. So every bg kill failed the
check and logged `refusing to kill`, which reads exactly like the guard doing
its job.

Also worth knowing before writing a test for that guard: `kill-session.ts`
imports the Elgato SDK, which **dies on import under `tsx --test` and is then
reported as one PASSING test** (the trap `naming-policy.ts` warns about). The
guard had to move to its own dependency-free module before it could be honestly
covered. A green suite that never executed your assertion is worse than no test.

## A default is a preference, and four of them said Claude

Auditing the deck for provider independence, the launch path came out clean —
one gesture, no agent named anywhere. The identity path did not, and the tell was
not the obvious `provider === "codex"` branches (most of those are real
mechanical differences: a different on-disk layout, a different liveness probe).
It was four fallbacks:

```
kill-session.ts    provider: ProviderId = "claude"
slot-action.ts     slot.provider ?? "claude"   (x2)
naming-policy.ts   session.provider ?? "claude"
```

Each one reads as harmless defensiveness and each one is a decision: a session
whose provider went missing got Claude's tab-title namespace, Claude's kill
identity guard, and Claude's event log. `?? "claude"` in a kill path is the
sharpest version — it decides which binary a SIGTERM is allowed to hit.

All four are now required parameters. The one that had to be handled rather than
just tightened was `slot-action.ts`: a slot whose provider is unknown is treated
as **unbound** (a press opens a new tab) instead of assumed to be Claude, because
the two actions behind that value are a log wipe and a kill.

Related, on where a name list belongs: `AGENT_BINARIES` was a hardcoded table, so
a third agent got no tile at all until someone edited the scanner and cut a
release. It moved to `~/.claude/streamdeck-agents.json`. Discovery by shape
instead — no list at all — was considered and rejected: verified live on this
Mac, declaring `zsh` in that config tiles a login shell exactly the way it would
tile `gemini`, because nothing at the OS level distinguishes an LLM CLI from any
other interactive program. The list is irreducible; its LOCATION was the fixable
part. Keep `ProviderId` an opaque string everywhere above the adapters.

Also learned the hard way (twice now, and the second time was self-inflicted):
`env.ts` asserts its build-time sentinels **at module load** and throws under
`tsx --test`. `agent-config.ts` imported it for one path constant and took two
unrelated test files down with it. Node builtins only means node builtins only —
`launch-tty.ts` computes its own dir for exactly this reason, and `homedir()` is
the plugin-side answer anyway.

## CODEX_HOME hooks fire for every frontend

A hook having fired is not evidence of a terminal session. `codex mcp-server`
spawned by a Claude session and the ChatGPT desktop app's bundled
`codex app-server` (`ChatGPT.app/Contents/Resources/codex`, comm literally
`codex`) share `~/.codex` — hooks included — so both fired the deck bridge on
their conversations and tiled as ghost codex sessions with live pids. One even
OSC-2-stamped its HOST Claude tab's title (`tab title: pid=20905 ->
"codex-20905"`), because the mcp-server inherits the Claude session's tty.

The bridge now gates on the resolved codex ancestor holding a tty on fd 0,
mirroring `readProcessIo`. Measured 2026-08-21: fd 0 is `tCHR /dev/ttysN` for
a real TUI and a unix socket for both embedded cores. Two halves keep it
airtight: SessionStart is the only place a record is born, and every later
event requires the record to exist, so a refused session's event stream can
never resurrect it.

Testing gotcha: you cannot fake a codex ancestor for hook tests. A shebang
script's `ps -o comm=` is `/bin/bash` (the kernel execs the interpreter), and
a copied `/bin/bash` binary is SIGKILLed (rc 137) on this machine even outside
the Bash-tool sandbox. Test `fd0_is_tty` against real pids — a live mcp-server
must reject, a live TUI pid must accept — and exercise the reject branches by
running the hook directly (the session's own parent chain has no codex).
