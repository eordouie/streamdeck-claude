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
- **An offset cannot desynchronise more members than the cycle has residues.**
  The leg cycle switches every 3 frames, so it has exactly three residues. The
  parent takes one, leaving two for three babies — by pigeonhole two must
  share. Two offsets sharing a residue differ by a multiple of 3, which pins
  them to the same switch frame forever: identical pose if the multiple is
  even, exactly mirrored if it is odd. **Mirrored-and-locked is still locked**
  — opposite pose, identical rhythm, which is what "in sync" looks like in
  motion.

  The first fix here was offsets `[1, 2, 4]`, chosen so none was a multiple of
  3. That correctly unlocked every baby from the *parent* and quietly locked
  babies 1 and 3 to *each other*, because `4 - 1 = 3`. Fixing one pairing in a
  set is not fixing the set: with N members every pair needs checking, not just
  every member against the leader.

  The way out is to stop offsetting a shared cycle and give each member its own
  cadence — here `[94, 83, 101]` ms per leg unit, so step periods of 282 / 249 /
  303 ms drift against the parent's 360 ms and against each other. No pigeonhole
  applies to distinct periods. It is also the physically right answer: small
  animals take quicker steps.

All three were found by printing the phases, the switch frames, and a
pose-agreement matrix over a long sample — never by looking at a render. A
still frame cannot show a rhythm, and the mirror-lock in particular looks
*correct* in every individual frame.

## Judging mascot cuteness needs an actual render, and sometimes needs a different animal

The hen went through four rebuilds across two review rounds (kawaii,
classic-refined, round-loaf, big-eye, front-facing, rounded-plush — see git
history on `src/icons/motifs.ts`) and was rejected every time. The panda
took two rebuilds to land. Two things made the difference:

- **Never judge pixel art from the coordinates.** Every "fixed" hen looked
  right on paper (comb touching the head, tail flush with the body, eye
  catchlight not cutting a corner) and still read as ugly or still had bugs
  the coordinates didn't reveal — a stray `translate()` wrapper once put an
  entire animal's body 6-7 units off from where its legs were drawn, and it
  only showed up once rendered. Rasterize every candidate (`@resvg/resvg-js`
  against the actual `renderIcon()` output, not a hand-rolled approximation)
  before showing it or committing it. A contact sheet of several candidates
  side by side made preferences legible in one round instead of several.
- **Iterating a design isn't the only move — sometimes the animal is wrong.**
  After the hen's fourth rejected rebuild, the fix wasn't a fifth rebuild; it
  was swapping the animal entirely (hen/chick → cat/kitten). Two hours of
  polishing comb shapes never fixed what a different silhouette fixed
  immediately. If N rebuilds of the same concept all get rejected, propose
  changing the concept before attempting N+1.

Two follow-ups landed after that entry was written, both worth recording
so they aren't re-litigated: the first cat (ginger, a longer lower-slung
body) was *also* rejected — the animal-swap fixed the hen's specific
failure mode, but didn't make every subsequent attempt automatically cute.
It took a second pass (beige palette, proportions pulled back in line with
the elephant/llama bar — bigger head, shorter torso, one tail segment fewer)
to land. And the panda's chibi/sitting redesign, despite surviving its own
contact-sheet review, was reverted back to the original side-profile
version after living on the deck for a while — a design can win a side-by-side
comparison and still lose to "the one I'm used to seeing" once it's the
thing actually sitting on the key. Don't re-propose the chibi panda or the
ginger cat without a specific reason.

Update: the beige cat was rejected too, on the very next round. Rather than
a third cat attempt, that slot became a stegosaurus — and it landed
immediately, on the first try, no contact sheet needed. The difference
looks like it was picking an animal with an iconic, simple, already-graphic
silhouette (round body, small head, a row of plates, a spiked tail) instead
of one whose "cute" depends on getting a lot of small proportions right
(a cat's ear angle, muzzle length, tail curl). When redesigning a mascot
that keeps failing, ask whether the animal itself has a strong enough
silhouette to carry sparse pixel-art detail before spending another round
tuning the same one's proportions.

Unrelated finding from the same session, in case it resurfaces: the
project's pinned `@resvg/resvg-js` occasionally panics
(`geom.rs` `Option::unwrap()` on `None`) rendering the `subagent` family
state, reproducible on stock, untouched mascots (e.g. the sauropod) — so
it's a latent bug in that dependency or its interaction with `Date.now()`
-driven blink timing, not a regression from any mascot's SVG. Harmless: the
live plugin never calls resvg for the animated per-slot icons (those go
straight from `renderIcon()` to `setImage` over the Elgato bridge); resvg
is only wired to the static manifest PNGs in
`scripts/render-static-pngs.mjs`. Worth a real fix only if it starts hitting
that script.

## `claude -p` names things after ITS cwd, not the subject you asked about

The deck namer runs a headless `claude -p` from a sentinel directory
(`~/.claude/deck-namer`) so its own session can be filtered off the deck. That
directory is not neutral: `claude -p` reports its working directory to the model
as context, and when the session being NAMED is thin the model reaches for it.

Measured 2026-08-17, same prompt, only the cwd differing:

| Run from | First request | Word |
|---|---|---|
| `~/.claude/deck-namer` | "what is the latest news" | `deck`, `deckname` |
| a neutral temp dir | "what is the latest news" | `news`, `briefing` |

Ten `.deckname` sidecars on this machine had quietly collected `deck`,
`deckname`, `decknamer` or `namer` — sessions named after the labelling tool.
Both providers were hit (two of the four `deck` sids were Claude's), so this was
never a Codex bug; it just SHOWS up on Codex, because a Codex rollout carries no
`customTitle`/`aiTitle`, leaving `firstPrompt` as the only signal where a Claude
session has two.

Two things did NOT fix it, worth knowing before trying them again:

- `--settings '{}' --strict-mcp-config --mcp-config '{"mcpServers":{}}'` —
  still `deck`. The leak is the working-directory PATH in the model's context,
  not settings, hooks, or MCP.
- Making the prompt more emphatic about "the specific subject" — the original
  prompt already said that.

What fixed it: telling the model outright that the session it is naming is not
the session it is running in, and to ignore its own working directory. Verified
4/4 sensible (`news`, `briefing`, `headlines`, `news`) from the real sentinel
cwd, with rich prompts still naming well (`stagnation`, `lighttools`).
`selfReferentialWords` in `naming-policy.ts` is the backstop for when the model
doesn't listen — derived from the sentinel path, so renaming the directory moves
the guard with it instead of leaving a stale blocklist.

Generalisation for any headless-LLM helper in this repo: **the helper's own
environment is part of its prompt whether you wrote it or not.** If the answer
must be about the caller's data, say so explicitly, and check the output against
the helper's own vocabulary before trusting it.

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

## The key already has two free text lines — measure before deleting one

`splitLabel` fills `top` (y=30, font 19) plus `line1`/`line2` (y=112/132, font
17). For a one-token label — which is every session once the namer assigns a
deck word — **both bottom slots render nothing**. Adding a second line there
costs no shrinkage.

This was nearly missed: a design discussion chose to *replace* the deck word
with model+effort specifically to avoid shrinking text that was never going to
shrink. Read `icons/theme.ts` before trading one piece of information for
another on a key face.

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
