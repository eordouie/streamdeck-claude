# Deck words go missing and name the wrong thing: effort log

> **Status:** BUILT, RUNNING LIVE and verified from the plugin log — branch
> `feat/deck-naming-quality`, PR to `ghostty-focus`; 155 tests green.
> **Last updated:** 2026-10-31
> **Next step:** Ehsan merges the PR (streamdeck-claude is outside the
> self-merge grant) and watches the next few real sessions' words; the
> plugin already runs this branch from the working tree.

## Ask (Ehsan, 2026-10-31, voice)

The word at the top of each Ghostty tab (and on the deck key) is sometimes
missing, and when present is often not the word that best represents the
session. The namer should understand the session's context and pick the
word that represents it best.

## Findings

### Missing words (plugin log, 2026-10-19 … 10-31: 50 words assigned)

| Cause | Count | What happened |
|---|---|---|
| Shape rejection loop | 4 sessions, 12 rejections | `DECK_WORD_RE` refused `cone-visualization` (second part > 11 letters), `hotel-reimbursement` (same), `amt-3921` / `3921-amt` (digits first), `az-el` (first part < 3 letters). Each time the namer re-sent the IDENTICAL prompt, got the same answer, and after three gave up for good (`gaveUp`). Three of the four sessions never got a word; the fourth was renamed by hand (`miniHive`). |
| `unknown` on a thin opener | 4 sessions | Correct behaviour, resolved by the next prompt each time; a one-prompt session would stay bare. |
| Contested stamp | 17 warnings | The word exists but the tab keeps `claude-<pid>` for 10 min. 14 of the 17 are the hand-renamed `optics_FEA` tab under the Window-menu fallback; 2 are the reboot of 2026-10-30 23:54. |
| Call failure / timeout | 0 | None in this window. |

### Poor words

- **The namer sees 200 characters of a voice-dictated prompt and nothing
  else.** The hook clips the prompt to 200 codepoints (`notification.sh`),
  the transcript miner clips to 200 "for parity", and the "Session title"
  line has been `(none yet)` for every real session since 2026-07-31:
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` also stops Claude Code writing an
  `aiTitle` into the transcript. Of 393 transcripts touched in the last 30
  days, 9 carry an `aiTitle`, and all 9 are the namer's own headless
  sessions (which run without that env). So `heresder` (Handy's rendering
  of "herdr") became `headersd`, while the assistant's first reply in that
  session says "Reading the herdr evaluation log".
- **"ONE word" glues pairs together** despite the hyphen offer, and the
  16-letter single-word cap lets them through: `viewvisibility`,
  `channelupdates`, `channelname`, `weeklyupdate`, `shouldknow`,
  `opticalfab`, `cadreport` (all since 10-02).
- **The first prompt is the thinnest moment.** The assistant's first text
  reply arrives seconds to a minute later and restates the task in clean
  words ("locate the Performance tab's local-vs-site visibility
  mechanism", "Reading the windowless-receiver memory, the hive crucible
  logs, and the latest report").

### Measurement (2026-10-31, one call each, from the sentinel cwd with the plugin's flags)

Thin = today's input (200-char clip, no title). Rich = full first prompt
(≤ 1500 chars) + first assistant text reply (≤ 800 chars), prompt told
the request is voice-dictated and the reply authoritative, label = one or
two words separated by a space.

| Session (live word) | Sonnet thin | Opus thin | Sonnet rich | Opus rich |
|---|---|---|---|---|
| herdr review (`headersd`) | `heresder` | `heresder-upgrade` | `herdr upgrade` | `herdr upgrade` |
| Performance tab visibility (`viewvisibility`) | `view-toggle` | `archive-view` | `source visibility` | `calculated archive` |
| receiver STEP files (`stepfiles`) | `report-update` | `shaon-cad` | `crucible report` | `windowless crucible` |
| this session (`tabnaming`) | `tabnaming` | `unknown` | `tab labeling` | `namer hook` |

Latency 1.6–7.4 s for every call. Context is what moves the words; the
model barely does (Opus thin copied the mis-hearing too and answered
`unknown` for a 60-word prompt).

## Proposal

1. **Context:** name from the full first prompt plus the assistant's first
   text reply, mined from the transcript head; the hook's 200-char events
   stay as the "a prompt exists" signal only. If no reply has landed 90 s
   after the first qualifying prompt, name from the prompt alone (the
   `unknown` re-ask stays).
2. **Shape:** ask for one or two words separated by a space, ≤ 20 letters;
   the plugin joins them with a hyphen (`herdr-upgrade` in the tab, two
   lines on the key). `DECK_WORD_RE` loosens to tokens of ≥ 2 letters or
   digits, 20 chars total, within `canonicalTabTitle`'s 24.
3. **Never give up bare:** a rejected answer is re-asked with the reason
   ("`cone-visualization` is 18 letters, the limit is 20 including the
   space…"), not the identical prompt; after a second rejection the answer
   is clipped to fit. `gaveUp` keeps only real call failures.
4. **Model:** Sonnet stays (measured equal at rich context, faster);
   one constant to flip.
5. **Hand rename** keeps overriding everything.

## Decision (Ehsan, 2026-10-31, voice)

Option A: "I can wait a minute or two for the session to have a very
proper name." The word is chosen once, when the reply lands; no
provisional word.

## Work (all done 2026-10-31, 155 tests green, `pnpm build` + `sd:validate` + `sd:reload`)

- [x] `naming-policy.ts`: `NamingContext`, `namingReady(ctx, now)` (prompt
      + reply, or `NAMING_REPLY_WAIT_MS` = 90 s), `DECK_WORD_RE` = one or two
      tokens of letters/digits, 20 chars; `clipWord`, `rejectionReason`;
      context sizes 1500 / 300 / 800 chars
- [x] `transcript-title.ts`: `readNamingContext` (full first prompt, first
      assistant text reply, first-prompt timestamp) replaces
      `readUserPrompts`. An incremental scan, not a head chunk: the first
      reply sits 240–560 KB into every transcript measured (twelve from
      2026-10-28 … 31) because the CLAUDE.md, memory and skill attachments
      land between the prompt and the reply; the 256 KB head read never
      reached it, and the second live run below took the 90 s path for
      that reason. Each read resumes at the last line boundary; a complete
      context is final
- [x] `session-events.ts`: `firstPromptAt` from the hook's first collected
      prompt (the Codex path has no transcript to mine)
- [x] `sessions.ts`: the transcript is read only while the session is
      unnamed; `namingReply` / `firstPromptAt` on `SessionInfo`
- [x] `deck-namer.ts`: new system prompt (one or two words with a space;
      the request is dictated, the reply is authoritative), re-ask with the
      reason, clip as the last resort; `gaveUp` only for banned-word loops
      and call failures
- [x] docs: README row, fork-design, headless-helpers lesson, LESSONS
      distillate entry, this log

## Verification (plugin log, 2026-10-31 13:01–13:06 EDT)

Two throwaway Claude TUIs in a detached tmux session (no Ghostty tab, so
no stamp; the key and the sidecar are the evidence), each given one
dictated-style prompt, then `/exit`; their sidecars and transcripts were
removed afterwards.

| Prompt | Named after | Word | Key relabel |
|---|---|---|---|
| "my macbook keyboard repeats the letter e when I type fast, which macos setting fixes the key repeat delay…" | 16 s | `key-repeat` | session exited before the next `keys:` line |
| "the ghosty tab tittle somtimes shows the raw pid insted of the word, explain why…" (head-chunk build) | 94 s | `tab-title` | `6=33228:Projects` → `6=33228:tab-title` 134 ms after the namer line |
| same prompt, incremental-scan build | 17 s | `tab-title` | `6=41083:Projects` → `6=41083:tab-title` 114 ms after the namer line |

The second run exposed the head-chunk bug (reply at 17:04:50, 29 s after
the prompt; named at the 90 s cap); the third run, after the fix, named
from the reply. The misspellings (`ghosty`, `tittle`) reached no label. No
WARN or ERROR lines since either reload; the five live sessions kept their
words and keys.

## Open

- A first reply that streams for longer than 90 s (a long explanation
  before any tool call) is not seen; the prompt alone names the session.
  The cap could be raised, or readiness could watch for a partial reply —
  not done; the usual first reply here is one sentence before a tool call.
- A single transcript line over 512 KB (a giant tool result) is skipped;
  a first prompt that large would go unseen.
- The 2026-10-23 tty-stamp garble is untouched: the naming stamp now lands
  10–90 s after the first prompt instead of a few seconds after it.

## Related

- `docs/log/2026-10-20-deck-tab-order-and-naming.md` (first-prompt naming)
- `docs/log/2026-10-23-tty-title-stamp-garbles-prompt.md` (open; the later
  naming stamp moves with option A, the issue itself is untouched here)
- `docs/lessons/headless-helpers.md`
