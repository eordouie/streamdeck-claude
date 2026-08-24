# Persistent `claude-xxxx-{word}` tab names — design

Date: 2026-08-03
Status: approved (format + persistence), pending implementation plan

## Problem

The deck's naming convention (one deliberate word per session) lives only in
two ephemeral places: the deck key labels and the tab title *after* the namer
replaces `claude-<pid>` with the bare word. When the deck is disconnected the
tabs that never got a word show only `claude-<pid>`, and nothing survives a
reboot — the `.deckname` sidecar is deleted at SessionEnd, so a resumed
conversation is renamed from scratch.

Goal: the tab identity always carries both the `claude-` convention and the
deck word, and a conversation keeps its word across session end / reboot /
`claude --resume`.

## Decision

| Session state | Today | After |
|---|---|---|
| Unnamed | `claude-84213` | `claude-84213` (byte-identical) |
| Named | `mirrors` | `claude-84213-mirrors` |
| Resumed after reboot | new word | `claude-<newpid>-mirrors` (same word) |

`xxxx` stays the PID. It was chosen over a session-id prefix or word-only
format because it is the most conservative option: unnamed behaviour is
unchanged, and title uniqueness holds by construction (live PIDs are unique),
so no collision-handling code is added. The PID churns each run; the **word**
is the durable identity.

## Mechanism changes

1. **Format** — `canonicalTabTitle()` in `src/tab-title.ts` returns
   `claude-<pid>-<word>` when a valid word exists, else `claude-<pid>`.
   Stamp (OSC 2), Window-menu exact match, and stamp verification all
   already flow through this single function, so they cannot disagree.

2. **Word survives SessionEnd** — `hooks/notification.sh` (and the
   `notification.ps1` mirror, for parity) stop unlinking
   `<sid>.deckname` at SessionEnd. Plain `claude --resume` reuses the
   original session id (verified: only `--fork-session`/`/branch` mint a
   new one), so the existing `assignedName(sid)` lookup reclaims the word
   with no new lookup code. `/clear` produces a new sid → new word, which
   is correct (new conversation).

3. **Garbage collection** — `pruneDeadSessions()` in `src/sessions.ts`
   currently deletes `.deckname` orphans with the event-log sweep. Instead:
   `.deckname` files whose sid is not live are removed only when older than
   **30 days** by mtime; sidecars of live sessions are touched (mtime
   refresh) so an active conversation never ages out. A conversation idle
   for >30 days loses its word and gets a fresh one if resumed later.

4. **Taken-words scoping** — `takenWordsFromDisk()` in `src/deck-namer.ts`
   currently treats every sidecar on disk as taken; with persistence that
   would monotonically exhaust the vocabulary. Fix: only sidecars belonging
   to **live** sessions count as taken. The fresh-from-disk read is kept —
   it still closes the queued-naming race it was added for (the just-written
   sidecar always belongs to a live session).

## Explicitly unchanged

The namer call itself (model, prompt, queue, give-up logic), deck key labels
(bare word / cwd basename), focus + re-stamp + contested machinery, attention
flash, empty-slot launch, the hook event pipeline, and the Windows/WSL branch.

## Risks and accepted trade-offs

| Risk | Assessment |
|---|---|
| **Tab-bar truncation** | The word sits at the END of a longer title; with many narrow tabs the tab bar may ellipsize it away (Window menu and deck keys always show the full name). Severity unknown until seen live. Cheap mitigation if it bites: swap to word-first (`claude-mirrors-84213`) — deliberate format change, needs a fresh OK. |
| PID churn | The number changes every run/reboot. Accepted; the word is the stable part. |
| Duplicate words | A dead conversation's word may be reused by a new session; if the old one is later resumed, two keys show the same word. Titles stay unique via PID, so focus never mis-fires. Rare, cosmetic. |
| 30-day decay | A conversation untouched for a month is renamed on resume. Accepted. |
| Plugin availability | Nothing stamps or names while the Stream Deck app/plugin is not running (unchanged today). Once it returns, live sessions are stamped within one tick. |
| Sidecar accumulation | Bounded by the 30-day GC; worst case is tiny stray files in `~/.claude/sessions/`. |

## Tests

- New `src/tab-title.test.ts`: canonical title for named / unnamed /
  invalid-word (>24 chars, illegal chars) sessions.
- New coverage for the prune/GC decision (extracted as a pure helper so it
  is testable): deckname kept while live-or-recent, removed when dead and
  >30 days old, events.ndjson sweep unchanged.
- Taken-words: dead-session words are not reported as taken; live ones are.

## Rollout / rollback

`pnpm build && pnpm sd:reload`. Live sessions re-stamp to the new format on
the next reassert tick (≤30 s); no session restarts needed. Rollback is a
git revert + reload; titles converge back the same way.

## Out of scope

- Surfacing the deck word in the `claude --resume` picker (would require
  writing customTitle into the transcript — invasive).
- Word-first title format (only if tab-bar truncation proves annoying).
- Any Windows/WSL-side behaviour.
