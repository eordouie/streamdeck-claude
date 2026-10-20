# Deck keys follow the Ghostty tab order; sessions named on the first real prompt: effort log

> **Status:** BUILT, RUNNING LIVE and verified from the plugin log — branch
> `feat/tab-order-and-early-names`, PR to `ghostty-focus`.
> **Last updated:** 2026-10-20
> **Next step:** Ehsan eyeballs the deck against Cmd+1…Cmd+8 and merges the
> PR (streamdeck-claude is outside the self-merge grant). Not yet exercised
> by a real press: an empty key inside the strip selecting its tab (no such
> key existed today — eight tabs, eight agents).

## Ask (Ehsan, 2026-10-20, voice)

1. New sessions no longer get a name on the deck: "there is no label anymore".
   The earlier behaviour — understand the concept, then pick one good word —
   was fine; waiting is maybe smarter, but keys must not sit unlabelled.
2. Key N on the deck must be Ghostty tab N (Cmd+N), in the same order, and
   follow the strip when tabs move.

## Live state at diagnosis (10:58 EDT, 7 tabs, 7 sessions)

| Cmd+ | pid | sid | tab / terminal title | deck word | deck key (old order) |
|---|---|---|---|---|---|
| 1 | 57229 | df061e80 | claude-57229 | none — `asphaltsiting` rejected ×3, gave up | 4 |
| 2 | 55486 | 5345c697 | claude-55486 | none — 1 prompt / 17 words | 6 |
| 3 | 61166 | ca6615b9 | claude-61166-labeling | labeling | 7 |
| 4 | 73362 | a83c84ec | claude-73362 | none — 2 prompts / 28 words | 5 |
| 5 | 4604 | 3d4799bf | claude-4604-sogstep | sogstep | 3 |
| 6 | 2554 | 4ec1dd19 | claude-2554-keyboard | keyboard | 2 |
| 7 | 2004 | 13de0914 | claude-2004-benefits | benefits | 1 |

The deck ordered keys by `startedAt` (state-tracker.ts), which is launch
order, never tab order; after two resumes and a reboot the two had nothing
in common.

## Root causes (verified in the plugin log and the session files)

### Naming

- `namingReady` (2026-10-06, PR #7) waits for three qualifying prompts or 30
  words. A one-task session ("set up my bamboo 3d printer…", 17 words) never
  reaches either, so its key shows the cwd basename — `Projects` for every
  session started from `~/Projects`, i.e. no label at all.
- `WORD_RE` caps a word at 12 characters. Sonnet, told "exactly one word",
  glues two together: `asphaltsiting`, `capacityfactor`, `selfassessment`,
  `ghostty-restore` — each rejected three times, then the namer gave up on
  the session for good (in-memory `gaveUp`).

### Order

- Nothing read the tab strip. The only Ghostty reads were title matches for
  focus and the 5 s hand-rename check (`listTabTerminalPairs`), which already
  walked `windows → tabs` — so the order was one property away.
- Ghostty 1.3.1's dictionary exposes `tab`: `index` (1-based in its window),
  `id` (stable), `selected`, `name`, `focused terminal`; and `window`:
  `id`, `front window`. Measured from the shell: the full walk of 7 tabs
  answers in 0.58 s.

## Decisions

- **Key N = tab N**, front window first, then the other windows in Ghostty's
  `windows` order, tabs by `index`. The session is matched to its tab by the
  pid in the terminal title the plugin itself stamps (`claude-<pid>[-word]`),
  so a hand-renamed tab still maps (its terminal keeps the stamp).
- Sessions with no tab (bg jobs, non-Ghostty terminals, a tab not yet
  stamped) take the keys AFTER the last tab, in start order; when nothing is
  free they count into the last key's `+N`.
- An empty key INSIDE the strip (a tab without an agent) selects that tab on
  press; an empty key beyond the strip opens a new tab as before. The new
  tab lands at the end of the strip, so it appears on the first key past
  the strip — the press-reservation (`pending-launch.ts`) is bypassed when
  the order is known and kept only as the fallback.
- Ghostty's API is polled every 3 s on its own timer (not inside the tick);
  the last good snapshot is kept through a failure (the log shows 2 s
  timeouts a few times a day). Without any snapshot ever (no Automation
  grant, old Ghostty) the old start-order path still runs.
- Naming: ready on the first qualifying prompt again (3+ words, no slash
  command). The model may answer `unknown` for an opener that names no
  subject ("continue the session"); that is not a failure — the namer waits
  for the next prompt. Two short words joined by a hyphen are accepted
  (`asphalt-siting`), single words up to 16 letters. The word still never
  changes once assigned (Ehsan's 2026-07-31 rule); the hand-rename override
  stays.

## Work (all done 2026-10-20, 152 tests green, `pnpm build` + `pnpm sd:reload`)

- [x] `slot-plan.ts` (pure, 8 tests): pid from a stamped title, key plan
- [x] `ghostty-script.ts`: `listTabs` (4 s timeout, `[]` when Ghostty is not
      running, null when the API can't be asked), `selectTabById`
- [x] `tab-order.ts`: 3 s poller on its own timer, sticky snapshot, one
      `tab order:` log line per change
- [x] `render-loop.ts` / `slot-action.ts` / `plugin.ts`: positional keys,
      empty-key tab select, one `keys:` log line per change
- [x] `tab-title.ts`: hand-rename adoption reads the snapshot (one osascript
      fewer every 5 s)
- [x] `naming-policy.ts` / `deck-namer.ts`: readiness, `unknown`, hyphens
- [x] docs: README key table, architecture, fork-design, both lessons files,
      LESSONS distillate

## Verification (plugin log, 11:10–11:13 EDT)

Reload at 15:10:32 UTC. First strip read 0.8 s later, keys planned 90 ms
after that, in strip order (an eighth session, `channelname`, had opened
since the diagnosis table):

```
tab order: 1=57229 2=55486 3=61166 4=73362 5=87164 6=4604 7=2554 8=2004
keys: 1=57229:asphalt-siting 2=55486:bambu-printer 3=61166:labeling
      4=73362:austin-lighthouse 5=87164:channelname 6=4604:sogstep
      7=2554:keyboard 8=2004:benefits
```

The three stuck sessions were named 3 s, 6 s and 8 s after the reload:
`asphalt-siting` (the word rejected as `asphaltsiting` three times this
morning), `bambu-printer` (one prompt), `austin-lighthouse` (two prompts).

Reorder: moving the selected tab from position 1 to 2 showed on the deck at
the next poll (`tab order:` 15:11:48.937, `keys:` 74 ms later); moving it
back likewise at 15:12:53. Gotcha found doing it: `perform action
"move_tab:±1" on <terminal>` acts on the window's SELECTED tab, not the
terminal named — the first call moved Ehsan's working tab (restored within
a minute; lesson in `docs/lessons/terminal-focus-and-launch.md`).

`select tab` + `activate window` by tab id (the empty-key press path) ran
in 0.19 s from the shell against the selected tab.

## Open

- A new session hops one key when its stamp lands (a few seconds): the tab
  is in the strip before the terminal title carries the pid. Matching an
  unstamped tab by `working directory` would close it; not done.
- Eight keys mirror Cmd+1…Cmd+8; Ghostty's Cmd+9 is "last tab", which the
  deck does not model.
- Other Ghostty windows' tabs follow the front window's in deck order; only
  the front window answers to Cmd+N.
