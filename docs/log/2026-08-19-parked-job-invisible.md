# A parked job's work was invisible on the only key you could press — effort log

> **Status:** fixed, built, reloaded, live. Verified against live session data.
> **Last updated:** 2026-08-19
> **Next step:** Ehsan to confirm `lever` now walks yellow while its parked job
> works. Sibling log for the same day's other root cause:
> `2026-08-19-stopfailure-red-latch.md`.
> **Uncommitted:** this repo carries large unrelated WIP (provider-independent
> agent sessions). This fix touches `src/bg-owner.ts`, `src/sessions.ts`,
> `src/state-tracker.ts`, `src/bg-owner.test.ts` and this log.

## Symptom

Reported verbatim: *"lever agent is right now working and doesn't show the agent
is walking … it's just to show me the blue edge in the stream deck not the yellow
one."* Plus two tiles the user could not account for: one labelled `codex` and
one background tile with a spinner and a BG badge.

## What was actually true

Three reports, one real bug. The accounting matters, because two of the three
were the deck telling the truth:

| Report | Verdict |
|---|---|
| `lever` blue/idle while working | **Real bug.** Its work was parked to a bg job and the activity never reached its own tile. |
| `codex` tile with nothing behind it | Not a defect. A real Codex session, pid 58165, since exited; the press at 13:10 actually SUCCEEDED (`menu exact="codex-58165" (re-stamped)`). The render loop clears an unassigned slot every tick. |
| BG tile with the spinner | Not a defect. A real parked job, `lever-ats-auth-issue`, correctly displayed. |

A freshness rule was designed and then **rejected on measurement**. The first
theory was that `lever`'s 23.5 h-old `statusUpdatedAt` should render as "I can't
tell". Checking every session killed it: idle tabs are legitimately stale — 22.9 h,
6.0 days, 7.9 days — so a staleness rule would have mislabelled four of six
sessions as unknown. Staleness is normal; it was never the signal.

## Root cause

Claude Code writes `idle` on a session the moment it **parks** a job — correctly,
its own turn loop is not running. The work continues on a bg job, which gets its
own tile. So:

- the tile that pulsed was the bg job, which has no terminal and cannot be
  focused directly;
- the tile the user had to press — the parking session's own tab — showed `idle`.

The plugin already computes the link. `bg-owner.ts`'s `resolveBgOwners` matches
`jobId` ⇄ `parkedJobId` so a press on a bg tile can borrow its owner's tab, and
its doc comment states the principle outright: *"The place you CAN reach the job
is the session that launched it."* That link was used for **routing only**.
`parkedJobId` appeared nowhere in state derivation. The plugin knew where the
work was and never said so.

## Fix

| Change | Where |
|---|---|
| `resolveParkedJobs` — the inverse link, owner → bg session, dropping contested claims exactly as `resolveBgOwners` does | `src/bg-owner.ts` |
| `adoptParkedState` — bg state → the owner-facing twin (`bg_working` → `working`, `bg_awaiting*` → `awaiting*`, `bg_idle` → nothing) | `src/bg-owner.ts` |
| `deriveState` takes an optional `parkedState` and adopts it **only over `idle`** — a session's own turn always outranks a delegate's | `src/sessions.ts` |
| The tick computes the parked map and passes each owner its delegate's state, sourced **only from LIVE bg jobs** | `src/state-tracker.ts` |

Two deliberate constraints:

- **Never hand an interactive tile a `bg_` state.** The `bg_` prefix is what
  draws the "bg" badge (`isBgState`), and stamping it on a real terminal tab
  would claim the tab *is* the background job rather than the place you answer it.
- **`bg_idle` adopts nothing.** A parked job sitting idle is not activity, and
  promoting it would leave every parked session permanently louder than an
  unparked one.

`adoptParkedState` lives in `bg-owner.ts`, not `sessions.ts`, because
`sessions.ts` imports the Elgato SDK and therefore cannot load under
`tsx --test` — the load-bearing rule of this fix would have been untestable
there. Its one `import type` is erased at compile time, so the module stays
importable from bare node, per the convention `naming-policy.ts` documents.

## Verified

- `pnpm test` 103/103, `tsc --noEmit` clean, built and reloaded with zero
  warnings in the fresh log.
- **Against live session data**, replaying the real `~/.claude/sessions/*.json`
  through the new pure functions: the parked link resolved
  (`d8319a89 → 13fb99e8`), and pid 94689 (`lever`) moved `own=idle` →
  `shows=working`. Blast radius exactly one tile: the four unparked sessions and
  the bg job itself were unchanged.
- 8 new tests: the live shape, the empty case, a job with no matching bg session,
  contested links in both directions, inverse-consistency with
  `resolveBgOwners`, the adoption mapping, the never-`bg_` invariant, and
  `bg_idle` adopting nothing.

## Robustness review (whole plugin, as asked)

Audited the trust surface. The input layer is in better shape than the day's bugs
suggested:

- **Liveness** propagates `fromCache` and `error`, and destructive work (deleting
  dead session files) is explicitly gated on a trustworthy answer.
- **Bounded state**: `owed` and `prevStates` are pruned against live ids each
  tick; `recentlyFinished` has `FINISHED_TTL_MS`; `KillSuppression` has
  `RECORD_TTL_MS` + `prune()`; `bgAgentStartTimes` has `BG_AGENT_TTL_MS`.
- **Shell-outs**: all 25 `spawnCapture` call sites inspect `err`/`code`/
  `timedOut`/`stdout`. The two that look bare pass the whole result into
  `parseAndCache`, which is where the cache/error signals come from.
- **bg liveness** requires a live pid AND a non-terminal status, so a job winding
  down does not read as running.

The weak layer was **derivation**, not input — turning inputs into a displayed
state had no equivalent discipline. Both of the day's real defects lived there:

1. `StopFailure` → `errored`, a latch with one escape hatch (sibling log).
2. Parked activity never reaching the reachable tile (this log).

**Remaining known gap, not fixed:** `process-scan.ts`'s `AGENT_COMMS` matches the
comm basename `codex`, which also matches `codex mcp-server` — an MCP server is
not an agent session. Today only the `tty === "??"` filter prevents a phantom
tile for it; if such a server ever runs attached to a tty, it becomes a slot.
Worth a `mcp-server` argv check when the provider WIP lands.
