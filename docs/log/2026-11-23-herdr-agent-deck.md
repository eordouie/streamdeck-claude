# Herdr agent deck: effort log

> **Status:** LIVE ON THE DECK 2026-11-23 18:09, from the feature worktree. The switch-over ran with Ehsan at the deck: the old plugin and deck-signals are unlinked, page 1 of the "Exowatt" profile is 14 agent keys and the arrow, and the plugin reads the real herdr. He confirmed the two pages, the names and the states on demo data, and Ghostty coming forward after a fix. Not yet confirmed by him: that a press lands on the right pane (the plugin now logs every press; the records so far agree). Not yet done: the app-restart check. Both pull requests are open; the final commit passes 260 tests, both plugin bundles build, and the validator accepts the new one.
> **Last updated:** 2026-11-23
> **Next step:** Ehsan merges the plugin PR (https://github.com/eordouie/streamdeck-claude/pull/11; the repo is outside the self-merge grant). Then merge the dotfiles PR (https://github.com/eordouie/dotfiles/pull/215) under the grant, rebuild and relink the plugin from the main checkout, check a fresh startup line from that bundle, and remove both worktrees. Still open with him: whether a live press lands on the right pane (every press is logged as `press: <pane> <result>`; none recorded yet since 18:28), the app-restart check, and the `agent-workflow.md` draft.
> **Open questions:** Does herdr keep pane ids across a server restart (the animal memory falls back to the session id either way)?

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

## Build (2026-11-23)

| Plan task | Commit (plugin repo unless noted) |
|---|---|
| 2 text lines, blocked state | e19e846 |
| 3 herdr client, stand-in, model | 11619b8 |
| 4 settle, rank, press | 60f637b |
| 5 key words | 25351a7 |
| 6 animal memory | 1c0a703 |
| 7 pages, tracker | ab653c6 |
| 8 jump | 9a43c1d |
| 9 plugin, manifest, build | 1e41f36 |
| 10 layout tool, cutover helper, setup notes | dotfiles b964ef6, 7af9fde |
| 11 step 1 demo script | d2a16a6 |
| lessons | f122038 |

One correction after the relay closed: the plan's sibling-layout test command ran `pnpm test` in a folder with a symlinked `node_modules`; pnpm 11 started an install and tried to purge the folder. The plan and LESSONS.md now call `tsx`, `rollup` and `streamdeck validate` directly.

## Hardware step (2026-11-23, Ehsan at the deck)

| Check | Result |
|---|---|
| Backup | `~/.config/herdr-deck/before-herdr.json` (page bytes, selected page, the three plugin links), written before any link changed |
| Installed page | 14 agent actions and the pager at 4,2; verified from the profile, not the exit code |
| Load, 14 keys animating | Stream Deck app 12.5 to 16.3 % of one core, the plugin's Node process 0.6 to 3 % |
| Two pages, names, animals | Ehsan: yes |
| States on demo data (working, needs-you, finished flash, dot, seen; arrow pulse) | Ehsan: "they all look correct". Log: working shown 0.7 s after the change, finished 4.9 s after the turn ended |
| Press reaches the right agent | Four demo presses recorded by the stand-in as the key's agent |
| Ghostty comes forward | Failed at first: AppleScript `activate` returned OK and did nothing. Fixed with `open -b` after the terminal is selected (0847652). Ehsan: "yes it comes front" |
| Live key order | Equal to the ranking computed from herdr's snapshot: 23 agents, 23 distinct animals |

Changes he asked for or that the hardware showed, each tested, rebuilt, reloaded and committed:

| Change | Commit |
|---|---|
| The arrow's `+N` means one thing on both pages: agents with no key at all. He could not read `+16` and `+2` | 0701653 |
| Ghostty forward with `open -b` | 0847652 |
| Two tabs, each with a claude and a codex: the tab on one line, the kind on the next ("streamdeck" / "codex", not "streamdeck 2") | e7e4b32 |
| Text lines painted behind the frame's corners ("make sure the banners are behind the corner edges") | b09af42 |
| One log line per press | 18cea2a |

He accepted the split of a long project name as shown (no objection at the look).

## Files

- Plan and crossfire rounds: `docs/plans/2026-11-23-herdr-agent-deck/` in the main checkout (the relay rule keeps it out of worktrees).
- Mock-ups shown to Ehsan: session scratchpad, not kept.
- Contact sheets: `.cache/mascot-sheets/` in this worktree (ignored).
