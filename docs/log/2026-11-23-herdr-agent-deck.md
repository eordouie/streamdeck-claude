# Herdr agent deck: effort log

> **Status:** PLANNING 2026-11-23. All 28 animals are drawn and committed (19 of the agreed 20, plus a lion where the triceratops failed; a butterfly is a finished spare). The plan is in Codex crossfire: round 03 frozen, round 04 with Codex. No deck behaviour has changed yet: the Stream Deck app still runs the old plugin and the old layout.
> **Last updated:** 2026-11-23
> **Next step:** Fold Codex's round 04 until two clean rounds in a row, then show Ehsan the plan and the animal gallery and wait for his go before building the deck engine (plan Tasks 2 to 13).
> **Open questions:** For Ehsan: the lion in the triceratops's place, yes or which animal instead? At the hardware step: split of a long project name ("raytracer" above, "engine" below) or the whole name scrolling? Technical: does herdr keep pane ids across a server restart (the animal memory falls back to the session id either way)? Does the Stream Deck app hold 14 keys redrawing at 8 frames a second without lag (v1 ran 8)?

## What this is

Ehsan wants the Stream Deck back, now showing herdr's agents instead of
Ghostty tabs (2026-11-23: "this will be the second version of streamdeck for
my workflow, no longer only with ghostty tabs"). The deck has been off since
2026-11-02 and the plugin as built cannot work under herdr: it finds agents by
Ghostty tab, and herdr is one Ghostty tab.

Branch `feat/herdr-agent-deck`, worktree `.claude/worktrees/herdr-deck`.

## Decisions (Ehsan, 2026-11-23)

| Decision | Choice |
|---|---|
| Keys | 14 agent keys per page, two pages, so 28 agents. One arrow key bottom-right on each page. |
| Other keys | Mic, input, dictate, meeting, repos and Slack keys leave the deck ("no mic button or anything else is needed"). |
| Order | Active agents go to the higher spots. |
| Claude and Codex | No difference in behaviour or in design. |
| Look | The mascot style of the old deck. Project name on top, which is the herdr workspace name; one more word at the bottom only where two agents share a project. He rejected a text-only mock-up first. |
| Animals | No animal appears twice. The eight existing ones stay as they are. Twenty new ones, list agreed: triceratops, pterodactyl, giraffe, flamingo, penguin, snail, turtle, crocodile, frog, hedgehog, rabbit, pig, octopus, bee, ladybug, duckling, parrot, kangaroo, moose, sheep. "Do it all, if it does not look good we change it." |
| Process | Plan first, Codex crossfire review until no gaps, then execution on his go. |

## Decided by the agent, open to his veto

| Item | Choice and reason |
|---|---|
| Rank | Needs-you first, then working, then finished and not yet looked at, then idle; inside a group the agent that entered it last comes first. |
| Animal follows the agent | An agent keeps its animal when it moves to another key or page. |
| Finished blips | A "finished" state must hold 4 s before the deck believes it. Measured: a Codex agent reported finished for 2 s between two steps (16:18:41 to 16:18:43). |
| Finished signal | Flashes for the first minute, then keeps the white dot until he looks at the agent in herdr. |
| Paging | The arrow key belongs to the plugin and flips its own two pages; the Stream Deck profile keeps one page. Same key position on both pages. |
| New plugin beside the old one | Own plugin folder and id in this repo, sharing the mascot drawing code. The old plugin's code stays untouched and is unlinked from the app at cutover. |

## Measured on the live system (2026-11-23)

- herdr 0.9.5, socket `~/.config/herdr/herdr.sock`, one JSON line per request and reply. `session.snapshot` returns every workspace, tab and agent in one 30 KB reply in 0.6 ms; `ping` in 0.1 ms.
- Agent states are `idle`, `working`, `blocked`, `done`, `unknown`. `done` means finished and not yet seen; a focus command marks it seen.
- `agent.focus` switches workspace, tab and pane of the attached herdr view in one step. Found the wrong way: a test call at 16:17:48 pulled Ehsan's view from another workspace to this session's pane for 20 s. A focus command belongs to a key press and nowhere else.
- Ghostty 1.4.0 reports each terminal's tty over AppleScript; the herdr view runs on `ttys000`. Ghostty's terminal title follows the focused workspace's name, so the title cannot identify the terminal; the tty can.
- 19 agents were live across 14 workspaces.
- The old plugin restarted with the app at 14:39. Its 8 keys show folder names and its naming call fails (35 failures in two minutes); it wrote no tab titles.

## Animals (2026-11-23)

Four drawing agents drew five each against `.cache/mascot-brief.md`, checking every change on a rendered contact sheet (`scripts/mascot-sheet.mjs`). Outcome:

| Animal | Result |
|---|---|
| pterodactyl, giraffe, flamingo, penguin, snail, turtle, crocodile, frog, hedgehog, rabbit, pig, octopus, bee, ladybug, duckling, parrot, moose, sheep | Passed as drawn |
| kangaroo | First concept read as a tan wedge at rest. Second concept passed: a joey in the pouch, the tail separated from the haunch, a long hind foot. |
| triceratops | Failed twice in ten rendered rounds. First its frill read as a mane; redrawn teal with a standing frill and long brow horns it read as a moose or a ram. Dropped. |
| lion | Drawn as the replacement; in the roster where the triceratops stood. Ehsan has not confirmed it yet. |
| butterfly | Drawn as the second candidate; kept as `butterfly.ts` outside the roster, the first spare. |

Commits: 5286b54 (kit and sheet script), 63785f3 (animals, roster, test, gallery), a8b1968 (test pins the original eight's order). The gallery is `.cache/mascot-gallery.html`.

## Crossfire rounds

| Round | By | What it changed |
|---|---|---|
| 01 | Claude Fable 5.2, max | Draft. Every code block run in a throwaway copy before freezing: 92 tests, build and validator clean. |
| 02 | Codex GPT-6.2-Astra, max, 31 min, 10 % of the weekly allowance | Fixed 14 key positions instead of counting keys as they appear; a press checks the pane still holds the same session before the one focus command; the terminal is matched as the single foreground `herdr` viewer; animal memory keyed by session first; malformed snapshots rejected; the demo isolated on a private socket with its own selector; a backup of the profile page and the three plugin links before the cutover; a blocked agent keeps its animal inside the orange pulse. |
| 03 | Claude Fable 5.2, max | Verified round 02's claims on the machine. Reversed two of its changes (long names split at the hyphen as Ehsan was shown; a key keeps its place through a blip shorter than one poll). Recorded the triceratops outcome. The agent drives the demo, Ehsan only looks and presses. 100 tests. |

## Files

- Plan and crossfire rounds: `docs/plans/2026-11-23-herdr-agent-deck/` in the main checkout (the relay rule keeps it out of worktrees).
- Mock-ups shown to Ehsan: session scratchpad, not kept.
- Contact sheets: `.cache/mascot-sheets/` in this worktree (ignored).
