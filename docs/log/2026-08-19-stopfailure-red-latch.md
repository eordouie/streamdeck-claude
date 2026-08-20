# A healthy slot stuck on the red error bolt — effort log

> **Status:** fixed, built, reloaded, live. Regression-guarded.
> **Last updated:** 2026-08-19
> **Next step:** Ehsan to confirm the `lever` key is no longer red on the deck.
> A LESSONS.md entry is drafted and awaiting his yes/no (proposed, not written).
> **Uncommitted:** this repo's working tree carries large unrelated WIP
> (provider-independent agent sessions). This fix touches only
> `src/session-events.ts`, `src/session-events.test.ts`, `docs/architecture.md`
> and this log; the rest routes through Ehsan's `/push-all` / `/release-all`.

## Symptom

Reported verbatim: *"the lever … that I'm working on right now is just showing
danger sign caution sign or whatever you call it that's a red flashing and I'm
just chatting and nothing really happening it's just a normal session."*

"lever" is not a garbled word — it is the **deckname** of session
`d8319a89-2d46-4a32-9357-bb78c24dc3d6`, read off the key. Its slot had been
pulsing the red `errorBolt` (warning triangle + `!`, `states.ts` `error`
palette) for roughly 24 hours.

## Diagnosis

No guessing was needed — the plugin's own inputs are on disk. Replaying every
`~/.claude/sessions/*.events.ndjson` through the real `parseEventLog` +
`reduceEvents` found exactly one session with `errored: true`: `d8319a89`, with
three `StopFailure` events. Its last log write was 2026-08-18 13:52, and the
plugin log showed `claude-94689-lever` still being focused as a live Ghostty
tab — so: alive, idle, and red.

The sequence, from its own log:

```
13:36:02  Stop            <- turn ended CLEANLY
13:36:18  StopFailure     <- 16 s later
13:37:02  Notification idle_prompt
13:39:18  StopFailure
13:44:41  SubagentStop    <- session demonstrably working
13:52:07  Notification agent_completed
(nothing since)
```

Two independent defects combined:

1. **`StopFailure` was read as "the session failed".** It is not. The event
   fires when a Stop *hook* exits non-zero, and on this machine Stop hooks exit
   non-zero **by design**: `deck-capture-nudge.py` blocks to force a deck
   capture. Three Stop hooks are registered (`stop-nudge.py`,
   `deck-capture-nudge.py`, `streamdeck_claude_bridge.py`), so this is normal
   operation, not an incident. Worse, CC fires `StopFailure` at sessions that
   have already stopped — 16 s after a clean `Stop` here, and again two minutes
   after an idle reminder.
2. **`errored` was a latch with exactly ONE escape hatch.** Only
   `UserPromptSubmit` cleared it. Every other flag in the reducer clears on
   `Stop`, on tool events, *and* on `UserPromptSubmit`. So the red tile survived
   a `SubagentStop` and an `agent_completed` — both positive proof the session
   was fine — and would have survived indefinitely until someone happened to
   type a prompt in that specific tab.

The hooks themselves are faithful: `notification.sh` takes the event name
straight from CC's `hook_event_name`, and `~/.claude/streamdeck-bridge.log` is
empty (no pipeline failures ever recorded). The bug was entirely in the
interpretation.

Incidental confirmation of how routine this is: THIS session's deck-capture
guard blocked earlier the same day. It recorded no `StopFailure` only because a
blocking hook aborts the rest of the Stop chain before the bridge runs — the
event is written when CC fires its separate `StopFailure` hook, for which the
bridge is also registered.

## Fix

`src/session-events.ts`:

| Change | Why |
|---|---|
| `StopFailure` sets `errored: state.inTurn` instead of `errored: true` | A `StopFailure` arriving after the turn already stopped is hook bookkeeping. Only one that interrupts a turn in progress is evidence of failure. This alone resolves the observed case. |
| `errored: false` added to `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | A tool call is proof of life — the one thing an error tile claims is not happening. Cleared **outside** the `subagentDepth` gate: work is work, whoever is doing it. |
| `errored: false` added to `Stop` | A turn that reached a clean Stop is a turn that worked. |
| `errored: false` added to `SubagentStart` / `SubagentStop` | Exactly the events that would have healed the `lever` tile five minutes after it went red. |

Deliberately NOT done:

- **The signal is not deleted.** An in-turn `StopFailure` still shows the error
  face, and a test pins that.
- **No TTL.** Considered, since `bgAgentStartTimes` already uses one
  (`BG_AGENT_TTL_MS`) for the same "unbounded accumulator" reason. Rejected as
  unnecessary: with five clearing paths an infinite latch now requires a session
  that produces literally no events after a failed turn — and in that case red
  is the honest face.
- **No new "a Stop hook is failing" indicator.** That is a config problem, and
  the repo already has a home for it (the setup key's hook-warning tile,
  `renderHookWarning` + `hook-check.ts`). Adding one would also be pure noise
  here, since the guard hook blocks intentionally.

## Verified

- `pnpm test` 95/95, `tsc --noEmit` clean, built and reloaded with zero
  warnings in the fresh plugin log (`tick: sessions=9 live=9 actions=8`).
- **The guards are real guards.** Temporarily restored the old semantics and
  re-ran: 5 of the 6 new tests fail. The 6th (`StopFailure DURING a turn still
  errors`) passes both before and after, which is its job — it proves the fix
  did not over-correct and delete the legitimate signal.
- **Against the real log on disk**: `d8319a89` now derives `errored: false`
  while still carrying all three `StopFailure` events. All 8 session logs:
  zero errored, zero stuck flags.
- Same-class audit: of the reducer's booleans (`awaiting`,
  `awaitingPermission`, `awaitingQuestion`, `awaitingPlan`, `errored`,
  `inTurn`), `errored` was the only alarm with a single clearing path. This was
  the last unbounded alarm latch.
- Not machine-verifiable: that the physical key is no longer red — Ehsan's eyes.

## Notes

- The fix is upstreamable, as this fork's diff must stay: it is a plain bug fix
  in the fork's own reducer, with no local-only assumptions baked in.
- Worked in the repo root rather than a worktree, deliberately: this plugin runs
  live from its working tree, so a fix in a worktree would not have taken effect
  on the deck.
