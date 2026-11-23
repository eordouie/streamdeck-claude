# Herdr agent deck — relay rounds

## How this works (rules for every model, any harness)
1. Read plan.md fully and form YOUR OWN critique first.
2. Then read this file: Pinned (human) is binding — never reverse a
   pinned item; you may log an objection. Then read prior rounds.
3. Revise plan.md as an independent engineer; keep its writing-plans
   structure; never silently drop content — removals go in your
   entry under Reversed or Rejected, with reasons.
4. Freeze your full revised plan.md as v/NN-<model>.md. Never edit
   or delete existing v/ files or prior round entries.
5. Append your round entry below (format of the entries you see) and
   update plan.md's Status line. Do not commit anything.
6. No file access (you were pasted this)? Reply with exactly: your
   round entry, then the full revised plan — nothing else.

## Pinned (human)

Ehsan's decisions of 2026-11-23, in his words where quoted. Models do not reverse these.

1. The Stream Deck is used again, now for herdr's agents instead of Ghostty tabs: "this will be the second version of streamdeck for my workflow, no longer only with ghostty tabs and with herdr agents section."
2. Layout: "make it 14 agents with two pages, total of 28 and two arrow key, no mic button or anything else is needed." So 14 agent keys and one arrow key per page; the mic, input, dictate, meeting, repos and Slack keys leave the deck.
3. Order: "the active ones always should go higher spot."
4. Claude and Codex: "it should work with claude and codex with no difference ... in terms of design also no difference should be between codex and claude."
5. Look: the old deck's mascot style, "the same style as before with one project name at top and if two one more word at bottom." He rejected a text-only key design ("not like this").
6. Animals: "none of the mascots should be repetitive and we need to design all others as well but the current ones are great." The eight existing animals stay unchanged. The list of twenty new ones (plan.md, "What the owner decided", item 5) was put to him and answered: "do it all if does not look good we change it, start."
7. Process: "lets plan first and review it with codex ... crossfire until no gaps and mistakes in the plan before execution." The deck build starts only on his go after this relay.

Not pinned: everything under "What the author decided" in plan.md. Reviewers may challenge and change those, with reasons.

## Rounds

## Round 01 — claude (2026-11-23)
- Recommendations: initial draft. A new plugin beside the old one, reading herdr's socket snapshot twice a second; pure functions for settle, rank, labels, animal assignment and pages; a press sends one focus command and raises herdr's Ghostty terminal by tty.
- Changes applied: wrote plan.md. Before freezing, every code block was extracted into a throwaway copy of the worktree and run: `tsc --noEmit` clean, 92 tests pass across 15 test files, the rollup build and Elgato's `streamdeck validate` succeed, and the layout tool's 6 tests and its read-only dry run against the live profile pass ("15 keys valid, nothing written"). That run found and fixed two defects in the draft: a `log` helper typed `void` that returned the SDK's logger, and a test server that never released a connection nobody read from, which hung the test run. Five of the twenty animal files did not exist yet and were stubbed for that run only.
- Reversed: none
- Rejected: events.subscribe instead of polling (a poll cannot miss an event and needs no resubscribe after herdr restarts; a snapshot costs 0.6 ms); putting herdr behind the old plugin's provider interface (its state tracker, tab mirroring, naming and kill paths are built on session files and Ghostty tabs); Stream Deck's own page keys for paging (the plugin would not know which page shows, and a second profile page would have to be managed).
- Questions for the user: none. Open for the hardware step, not for him: whether Ghostty's `focus t` works on a reference from a repeat loop (two alternatives are written into Task 11), and whether 14 animated keys load the Stream Deck app more than v1's 8 did (measured in Task 11, with one fallback).
- Snapshot: v/01-claude.md
- Model and effort: Claude Fable 5.2, max.
