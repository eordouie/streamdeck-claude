# Deck shows wrong sessions for the open Ghostty tabs: effort log

> **Status:** FIXED, built and running live from branch
> `fix/deck-wrong-sessions` (PR to `ghostty-focus`). Verified from the plugin
> log and Ghostty's API; one check left that only a key press can do.
> **Last updated:** 2026-10-01
> **Next step:** Ehsan presses the `nebula` key (log should read
> `terminal exact="claude-33832-nebula"` and land on the Humain tab), then
> merges the PR. Follow-up candidate, not started: replace the keystroke tab
> launcher with Ghostty 1.3's AppleScript `new tab`.

## Symptom (Ehsan, 2026-10-01)

"My stream deck is showing wrong sessions for the agents that I have open in
Ghostty." Five Ghostty tabs, six deck keys: `crucible` twice, and a `nebula`
key whose tab reads `claude-33832-Humain` and which never jumps there.
Restarting things seemed to be the only cure.

## Live state at diagnosis (11:15 EDT)

| pid | tty | ps stat | conversation (sid) | deck word | tab name |
|---|---|---|---|---|---|
| 15263 | ttys000 | S+ | 28c31594 | harvest | claude-15263-harvest |
| 33832 | ttys001 | S+ | 74805e71 | nebula | **claude-33832-Humain** |
| 67318 | ttys002 | S+ | f5e102c4 | crucible | claude-67318-crucible / claude-69552-crucible (flips) |
| 69552 | ttys002 | **T** | f5e102c4 | crucible | (same tab) |
| 57669 | ttys003 | S+ | de43118f | pmma | claude-57669-pmma |
| 74258 | ttys004 | S+ | d1638952 | deckstate | claude-74258-deckstate |

Plugin log: `sessions=6 live=5`, and 352 `tab title contested` warnings in the
current log (1 and 4 in the two before it).

## Root causes (each verified, not inferred)

### 1. A suspended Claude gets its own key and fights for the tab title

Timeline on ttys002 (from the plugin log + session jsons):

- Sep 28 20:49 UTC: pid 69552 starts conversation f5e102c4 (`crucible`).
- ~20:51: 69552 is suspended (Ctrl+Z, `ps` stat `T`, pgid 69552 ≠ tpgid).
- 20:52: pid 72694 resumes the SAME conversation in the same tab.
- 20:55: first `contested` warning — 69552 and 72694 both stamping ttys002.
- Oct 1 15:11: 72694 exits, 67318 resumes f5e102c4 again. Contest continues.

Two independent faults stack:

- `kill -0` succeeds on a stopped process, so a suspended Claude counts as
  live for as long as it sits in the shell's job table (three days here).
- Liveness is keyed by **sessionId**, not by process
  (`filterLiveSessions` → `live: Set<sid>`; `state-tracker` filters
  `live.has(s.sessionId)`). Every `<pid>.json` that shares a live
  conversation's sid passes the filter — so even a DEAD record would show,
  and `pruneDeadSessions` (same sid test) never deletes it. Latent producer:
  crash or closed tab, then `claude -c` of the same conversation.

Effects: a second `crucible` key; both pids' records reach `ensureTabTitles`,
which writes `claude-69552-crucible` and `claude-67318-crucible` to the same
tty in turn, each one marking the other "contested" and backing off 10 min, so
the tab name flips every few minutes.

### 2. A hand-renamed Ghostty tab ignores every program title

The ttys001 tab was renamed by hand around Sep 30 21:01 UTC (first
`contested for pid=33832`) to `claude-33832-Humain` — the session had moved
from Nebula to the Humain layout. No transcript wrote that title (searched
every transcript touched in the last 4 days). Ghostty 1.3.1's
View > Change Tab Title… sets a tab-level override that beats OSC 2.

Measured: writing `ESC]2;…BEL` to `/dev/ttys004` changed that tab's menu name
within 0.3 s; the same write to `/dev/ttys001` left `claude-33832-Humain` in
place at 0.1, 0.5 and 2 s. Ghostty's AppleScript dictionary (new in 1.3)
shows both layers: tab `name` = `claude-33832-Humain`, that tab's terminal
`name` = `claude-33832-nebula`. The terminal keeps the program title; the tab
shows the override.

The focus ladder matches the Window menu, which lists TAB names, so the
`nebula` key's exact match always missed, the re-stamp retry missed too, and
the press only activated Ghostty.

### 3. The warning sent the user the wrong way

`tab title contested … CLAUDE_CODE_DISABLE_TERMINAL_TITLE was not in effect
when that session started — restart it for a stable name`. Wrong for both
causes above: the env var was set in every session. Restarting a session
fixes neither (the stopped job and the tab override both outlive it); closing
the tab fixes both, which is why "restart everything" looked like the cure.

## Decisions (Ehsan, 2026-10-01)

- A hand-renamed tab: the deck word stays fixed (one-time word rule
  unchanged); the key must still jump there.
- A suspended (stat `T`) process: no key, no tab stamp; `fg` brings it back on
  the next tick. Its `<pid>.json` is NOT pruned — the process is alive.

## Plan

1. Liveness per process: one `ps -o pid=,stat= -p …` probe replaces the
   per-pid `kill -0` loop; the display gate requires the record's OWN pid
   alive and not stopped; pruning is per record, and the sid-keyed events log
   is kept while any record of that conversation is live.
2. Ghostty focus through its AppleScript: focus the terminal whose own title is
   the canonical stamp (immune to tab renames); the Window-menu ladder stays as
   the fallback. Stamp verification reads terminal titles too. Warning text
   names the real causes.
3. Tests for the pure parts, build, reload, live-verify, LESSONS + docs.

## What shipped

| File | Change |
|---|---|
| `src/record-liveness.ts` (new, SDK-free) | `parsePsStates`, `isStoppedStat`, `classifyRecords` (per-record live / suspended), `pruneCandidates` (events log kept while the conversation lives) |
| `src/record-liveness.test.ts` (new) | 10 tests, including the 69552/67318 case and a dead twin |
| `src/live-pids.ts` | one `ps -o pid=,stat= -p …` replaces the per-pid `kill -0`; nonzero exit + stderr = failed probe (cache, no prune) |
| `src/state-tracker.ts` | display gate per record, suspended excluded; `suspended=<pids>` in the tick log line |
| `src/sessions.ts` | `pruneDeadSessions` per record |
| `src/ghostty-script.ts` (new) | Ghostty AppleScript: terminal titles, focus by title, front terminal; 2 s timeout, 60 s backoff, failure reason exposed |
| `src/ghostty-focus-mac.ts` | ladder: terminal title → Window menu → re-stamp + retry → activate |
| `src/tab-title.ts` | stamp check reads terminal titles first; warning lists real causes, no "restart"; logs `ghostty api unavailable (…)` once |
| docs | `docs/ghostty-focus.md`, `README.md`, `docs/reference/fork-design.md`, `docs/architecture.md`, two `docs/lessons/` entries, one `LESSONS.md` rule |

Tests: 137/137 (127 before + 10). `tsc --noEmit` clean. `pnpm build`,
`pnpm sd:validate`, `pnpm sd:reload` run.

## Live verification (2026-10-01, 15:34–15:39 UTC)

- First tick after reload: `sessions=6 live=5 suspended=69552`; stamps went to
  the five real sessions only (69552 no longer stamps ttys002).
- First reload: the plugin's Ghostty API call failed (the Automation consent
  prompt it raised was still open), so the stamp check fell back to the Window
  menu and logged the new contested text for 33832 within 8 s. Second reload
  (15:36:50): the API answered — no `ghostty api unavailable` line, and no
  warning at all for 90 s across three or more stamp checks, so the
  terminal-title check found `claude-33832-nebula`. The prompt had been allowed
  in between.
- Ghostty API probed from the shell: `listTerminalTitles` returned all five
  stamps; `focusTerminalTitled` on a title with a double quote returned
  `no-match` (script compiles, quoting holds); `focus (first terminal whose
  name is …)` selected a background tab (tested once, view restored).
- Not verified: a real key press through the plugin's focus path.

## Gotchas met on the way

- `name of every tab of every window` hung over 80 s against Ghostty 1.3.1;
  `name of every terminal` answers at once.
- AppleScript reserves `before`/`after` — a variable named `before` is a
  syntax error (-2741).
- The suspended pid 69552 is still in ttys002's job table. The deck hides it;
  `fg` in that tab resumes it, closing the tab ends it.

