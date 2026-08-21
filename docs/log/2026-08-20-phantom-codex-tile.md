# A Codex tile for a Codex nobody opened — effort log

> **Status:** root-caused, fixed, tested, built, reloaded, live. Verified against
> the running machine (before: 4 sessions, 2 of them phantom; after: 2).
> **Fix revised once** — v1's per-provider verb lists were replaced by an fd-0
> stdio test after Ehsan pushed back on provider coupling. See "Fix".
> **Last updated:** 2026-08-20
> **Independence work:** Ehsan picked all three steps. Steps 1 and 2 are DONE
> (config-driven agent list, four Claude defaults deleted). Step 3 as specified
> — identity with no names at all — was investigated and NOT built: it tiles
> `vim`. Finding + the opt-in variant are below, awaiting his call.
> **Next step:** Ehsan to eyeball the deck, and to say whether he wants the
> opt-in `tileDeckOpenedTabs` switch from step 3.
> LESSONS.md + CLAUDE.md entries are WRITTEN.
> **Uncommitted:** yes, deliberately — this repo's WIP routes through Ehsan's
> `/push-all` / `/release-all`.

## Symptom

Reported verbatim: *"I'm seeing the projects key with codex that is turned on,
but there is no codex session that I have opened … I keep seeing this bug that
without my ask there is a codex session open and there is nothing opened."*

Persistent, not transient: the tile lasted as long as the Claude session did, and
there were as many phantoms as there were Claude sessions open.

## Root cause

The Codex MCP server. Every Claude Code session with `mcp__codex__codex`
configured spawns, **as a child of the interactive `claude` and therefore on
`claude`'s tty**:

```
47080 47038 ttys000  claude --effort max
47154 47080 ttys000  node /opt/homebrew/bin/codex mcp-server
47192 47154 ttys000  …/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex mcp-server
```

`process-scan.ts` scanned `ps -Ao pid=,tty=,comm=` and accepted anything whose
`basename(comm)` was `claude`/`codex` and had a controlling terminal. For pid
47192 `comm` is `…/bin/codex` → basename `codex`, and the tty is the host
session's `ttys000` — byte-identical to a real TUI. `provisional-sessions.ts`
then read its cwd (inherited from `claude`, i.e. `~/Projects`) and produced a
`pending:codex:47192` tile labelled **Projects**, tagged **codex**. Two Claude
sessions → two phantoms.

The documented defence — "a real tty is required … the only thing keeping the
ChatGPT app's `codex` app-server off the deck" — is real but insufficient: the
ChatGPT app-server has no tty, an MCP child inherits one.

Ruled out on the way: `~/.codex/streamdeck/sessions/` was empty (no Codex hook
bridge records on this Mac), so the process scan was the only possible source.

Measured and useless as discriminators: the MCP child shares the host's `pgid`,
its `tpgid` matches, and `ps` reports it `S+` — every foreground signal says
"this is the terminal's job", because it genuinely is.

## Fix

### v1 (replaced, kept here as the record of a wrong kind of fix)

Scanned `ps -Awwo pid=,ppid=,tty=,args=` and added two rules: a per-provider
subcommand denylist (built from `codex --help` / `claude --help`) and an
agent-ancestor `ppid` walk. Both worked — the phantoms went away and the tests
passed. Both were wrong in kind: they taught the scanner Codex's CLI grammar, so
every headless verb OpenAI ships next is a future phantom and a future release,
and the deck grew MORE provider-specific at exactly the point Ehsan wants it
provider-neutral.

### v2 (live)

One structural test that names no provider. `ps` still says which processes are
an agent binary on a terminal — a candidate list, not a verdict — and fd 0 says
whether anybody is typing into it:

| | TUI (pid 47080) | MCP server (pid 47192) |
|---|---|---|
| `comm` | `claude` | `codex` |
| tty | ttys000 | ttys000 (inherited) |
| pgid / tpgid | 47080 / 47080 | 47080 / 47080 |
| state | `S+` | `S+` |
| cwd | `~/Projects` | `~/Projects` (inherited) |
| **fd 0** | **`tCHR /dev/ttys000`** | **`tunix ->0xb139…`** |

Only the last row differs, and it differs for a reason that holds for every
agent: a TUI reads the terminal, plumbing is handed pipes. `readProcessIo` reads
cwd and fd 0 in ONE `lsof -a -d cwd,0` — the same call that already fetched the
cwd, so the check costs no extra spawn. Rejections are memoised per `pid:tty`
(an MCP server outlives nothing, so re-buying the verdict every tick is pure
waste) and pruned when the pid leaves the scan.

Fails closed: no positive proof of a terminal, no tile.

Also deleted with v1: the `-Awwo`/argv parsing (back to upstream's `comm`, which
keeps the fork diff smaller) and ~60 lines of provider tables.

## Verification

- 7 tests in `src/process-scan.test.ts` (was 3), fixtures built from this Mac's
  real `ps` AND `lsof -Fftn` output, including the exact MCP pair. One test
  asserts the process table CANNOT judge the MCP server, so the split between
  "which binary" and "is anybody typing" stays documented. Suite: 110 pass / 0
  fail.
- Same live process table, old rule vs new: old returned
  `claude:47080, codex:47192, claude:20785, codex:20905`; new returns
  `claude:47080, claude:20785`.
- `pnpm build && pnpm sd:validate && pnpm sd:reload` → plugin respawned 13:57:23
  and logged `tick: sessions=2 live=2 actions=8`.

## Known limits (accepted)

- An agent that runs its TUI on piped stdin would be invisible. No such thing
  exists — a TUI needs the terminal — but that is the assumption the rule rests
  on, stated plainly.
- `lsof` unavailable or failing means no provisional tiles at all (fails closed).
  Real sessions still appear from their own records; only the pre-record window
  goes dark.
- Windows-native hosts have neither `ps` nor `lsof`, so the provisional path is
  macOS/Linux only. Unchanged by this fix.

## Provider independence (Ehsan's follow-up, audited, NOT yet acted on)

His ask: "there should be no preference for any of the AI software I'm using …
I should just click on ghostty and type the name of that LLM and start working."

Audited state — 37 provider-name sites in `src/`, in three classes:

- **The launch gesture already is independent** and is documented as such:
  `LaunchSpec` names no agent, `AgentProvider` has no `launch` member, one
  `openAgentTab` path, `PendingLaunches` matches on launch id alone.
- **Irreducible mechanical differences** (a new agent needs an adapter, not a
  special case): where each agent publishes state (`SESSION_SOURCES`,
  `readOneSource` vs `readOneCodexSource`), the kill identity guard
  (`provider-process.ts`), Codex's self-reported liveness branch in
  `live-pids.ts`. Rich state (working/awaiting/permission) needs a hook per
  agent — that cannot be abstracted away.
- **Actual coupling, fixable:** `sessions.ts` closes the world with
  `SessionProvider = "claude" | "codex"` while `provider-types.ts` already has
  the open `ProviderId = string`; `AGENT_BINARIES` in `process-scan.ts` is a
  hardcoded 3-key table, so a third agent gets NO tile at all; four
  `?? "claude"` defaults (`kill-session.ts:24`, `slot-action.ts:130,139`,
  `naming-policy.ts:27`); and "a bare tile means Claude, only Codex is tagged"
  stops being true the moment a third agent exists.

### Step 1 — the agent list is config (DONE)

New `src/agent-config.ts` reads `~/.claude/streamdeck-agents.json`:

```json
{ "agents": { "claude": ["claude", "claude.exe"], "codex": ["codex"], "gemini": ["gemini"] },
  "untaggedAgent": "claude" }
```

Absent file = the previous built-in behaviour, so no machine regresses.
`SessionProvider` is now `ProviderId` (an opaque string) instead of a closed
`"claude" | "codex"` union, and `AGENT_BINARIES` is gone from `process-scan.ts`.
A provider declares a LIST of binaries (`claude` + `claude.exe` are both Claude
Code) and matching also accepts npm's per-arch suffix, which replaced the old
`comm.includes("codex")` substring hack with a rule about npm packaging rather
than about Codex.

Path lives in `agent-config.ts`, not `env.ts`: env.ts throws at module load under
`tsx --test` and took two test files down with it on the first attempt.

### Step 2 — no implicit Claude (DONE)

Four `?? "claude"` defaults deleted (`kill-session.ts`, `slot-action.ts` x2,
`naming-policy.ts`). Provider is a required parameter at all four. In
`slot-action.ts` a slot that cannot say which agent it holds is now treated as
UNBOUND — a press opens a new tab — rather than having Claude assumed for it,
because the two actions behind that value are a log wipe and a SIGTERM.

The tile tag became a config preference (`untaggedAgent`) instead of a fact about
Codex: `providerTag()` tags every provider except the one named there. Default
`"claude"` reproduces today's look exactly (bare = Claude), `""` tags everything
evenly, and any other id moves the exception.

Also folded in: `live-pids.ts`'s codex-only liveness branch is now
provider-neutral — and tightened from `active !== false` to `active === true`
while doing it. `!== false` would have marked ANY pid-less record live forever,
which is the same inversion that produced the phantom tile in the first place.
Only the Codex reader sets that flag; every Claude record must fall through.

### Step 3 — identity with no names (INVESTIGATED, NOT BUILT)

The idea: the deck already records the tty of every tab it opens
(`launch-tty.ts`), so it could tile "whatever interactive program is on the tty I
opened" and never need a name.

It does not survive contact. Verified live on this Mac by declaring two binaries
this codebase has never heard of and running the real scanner:

```
zsh         pid=47038  tty=ttys000 stdin=/dev/ttys000  -> TILE
caffeinate  pid=32592  tty=ttys000 stdin=(pipe)        -> rejected
```

`zsh` tiles exactly the way `gemini` would, because nothing at the OS level
separates an LLM CLI from any other interactive program. Name-free discovery
therefore tiles `vim`, `git log`'s pager, `htop` — anything run in a tab opened
from an agent key — and short commands would flicker a tile in and out. Steps 1+2
already reduce "support another LLM" to one config line, once, ever; that is a
much better trade than a permanently noisier deck.

The salvageable version, if he wants it: an OPT-IN config flag
(`tileDeckOpenedTabs`, default off) scoping the rule to ttys the deck itself
launched, with a ~5 s age gate to kill flicker. Bounded, no permanent state, and
it makes the stated workflow zero-config for anyone who turns it on. Not built —
his call.

### Verification of the independence work

- 118 tests pass (was 109), `npx tsc --noEmit` clean, built + reloaded, live tick
  `sessions=2 live=2`.
- New `src/agent-config.test.ts` covers the fallback-whole-on-garbage behaviour,
  the untagged-agent preference in all three positions, and a config-only agent.
- `process-scan.test.ts` asserts that declaring `gemini` finds it AND that
  dropping `claude` from config drops it from the deck — no privilege either way.
