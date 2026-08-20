# A background job's key spun forever and went nowhere — effort log

> **Status:** fixed, built, reloaded, live. Regression-guarded (10 new tests).
> **Last updated:** 2026-08-19
> **Next step:** Ehsan to press the bg slot and confirm it lands on the `lever`
> tab. LESSONS.md entries are WRITTEN (he approved them, unlike the sibling
> effort's, which are still proposed).
> **Uncommitted:** deliberately. See "Why nothing was committed" below — the
> ten files cannot be committed as a slice, and this repo's WIP routes through
> Ehsan's `/push-all` / `/release-all`.
> **Sibling effort, same day, same checkout:**
> `2026-08-19-stopfailure-red-latch.md` — the red error-bolt on the `lever`
> key. Same deck, adjacent session (`lever` is this job's parent), disjoint
> files.

## Symptom

Reported verbatim: *"one of the bottoms I have for the agents is constantly
working but no pages is open on this … the circle is rotating there … it's just
going on and on without any reason there is no page open for that."*

The key was slot-bound to `13fb99e8-c3cf-41a0-ba23-e6a60ec9377f`, pid 43095,
name `lever-ats-auth-issue` — a **background job**, forked 20 h earlier from
session `d8319a89` (the `lever` key) as:

```
claude --bg-pty-host … -- claude --session-id 13fb99e8 --fork-session \
  --resume …/d8319a89.jsonl --effort max --permission-mode auto
```

Alive the whole time, ~11.7 % CPU, `status: "busy"`. Not a phantom: its first
prompt is *"I want to connect to lever and evaluate more that 100 candidates
from here"* and it was still fanning out subagents while being diagnosed.

## What was actually wrong

The spinning circle was **correct** — `states.ts` gives `bg_working` the
`spinnerArc` motif deliberately, so a background agent does not masquerade as
the slot's own mascot. Three real defects sat behind it, all descending from
one wrong comment: *"a bg job's PID is a shared `--bg-spare` daemon."*

A **claimed** job is its own dedicated process (43095) under its own private
pty host (43063). Nothing shared. From that one belief:

| Defect | Where |
|---|---|
| Press ran the full focus chain on a job that has no tab — ~2 s of warp → vscode → ghostty misses, logging `no-tab-named "claude-43095"` | `slot-action.ts` `runShortPress` |
| Hold-to-kill disabled, so the one tile you could not clear was the one you wanted gone | `render-loop.ts` `killable` |
| …and it would have failed anyway: the guard tested `comm === "claude"`, but bg jobs run as `claude.exe` | `kill-session.ts` |
| Liveness used a 90 s json-freshness heuristic instead of `kill -0`; a *busy* job stops rewriting its json, so working read as dead and the tile flapped (`live=9` → `live=8`, nothing died) | `live-pids.ts` |

The decisive evidence was in the plugin log — the user's presses at 09:53:23 and
09:53:28, six seconds after the job raised an `AskUserQuestion` at 09:53:17,
both missing. The tile is how a parked job asks for input, and the ask was
unreachable.

## Fix

- **`bg-owner.ts`** (new, pure) — links job to launcher via `jobId` ↔
  `parkedJobId`. Missing or contested link resolves to **nothing**: a wrong tab
  means answering the wrong agent's question.
- **`slot-action.ts`** — press follows a `focusTarget` (own tab for
  interactive, owner's tab for bg); no target → immediate alert, not a doomed
  chain.
- **`render-loop.ts` / `live-pids.ts` / `sessions.ts`** — kill enabled for bg,
  real `kill -0` liveness, dead bg jsons now prunable.
- **`provider-process.ts`** (new) — the identity guard, moved out of the
  SDK-importing module so it could be honestly tested, plus `claude.exe`.

## Verified

`tsc --noEmit` clean; **95/95 tests** (10 mine, 6 the sibling effort's, 79
pre-existing); built 162285 → 163075 B; reloaded; `sessions=9 live=9` stable
where it used to flap. Owner resolution run against the real session files:

```
bg  lever-ats-auth-issue (pid 43095, job 13fb99e8)
  -> owner: pid 94689  => focuses tab "claude-94689-lever"
```

which is the exact tab `tab-title.ts` is stamping in the live log. **Not
verified: the physical key press** — that needs Ehsan.

## Why nothing was committed

Two reasons, found after the branch-commit was agreed:

1. **The slice does not compile.** `slot-action.ts` and `render-loop.ts` import
   `launch-command.ts` and `pending-launch.ts`, both still untracked from the
   provider-independent-sessions WIP. A ten-file commit would be a broken tree.
2. **Convention.** The sibling effort log states it for this repo: the large
   unrelated WIP routes through `/push-all` / `/release-all`, and that session
   committed nothing either. Two agents committing slices of one shared,
   actively-edited checkout is how you get a tree nobody can reason about.

File ownership today is clean by mtime — mine 10:07–10:11, the sibling's
10:11:32–10:12:05, no overlap — so the bulk flow can take both at once.
