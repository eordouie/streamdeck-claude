# Herdr agent deck: effort log

> **Status:** PLANNING 2026-11-23. Decisions below are Ehsan's. The plan is in Codex crossfire review; 20 new animals are being drawn. No deck behaviour has changed yet: the old plugin and the old layout are still what the Stream Deck app runs.
> **Last updated:** 2026-11-23
> **Next step:** Finish the crossfire rounds on `docs/plans/2026-11-23-herdr-agent-deck/plan.md` (main checkout), show Ehsan the animal sheet, then wait for his go before building the deck engine.
> **Open questions:** Does herdr keep pane ids across a server restart (decides whether an agent keeps its animal after a reboot)? Does the Stream Deck app hold 14 keys redrawing at 8 frames a second without lag (v1 ran 8)?

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

## Files

- Plan and crossfire rounds: `docs/plans/2026-11-23-herdr-agent-deck/` in the main checkout (the relay rule keeps it out of worktrees).
- Mock-ups shown to Ehsan: session scratchpad, not kept.
- Contact sheets: `.cache/mascot-sheets/` in this worktree (ignored).
