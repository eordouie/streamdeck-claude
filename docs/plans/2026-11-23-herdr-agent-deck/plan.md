# Herdr Agent Deck Implementation Plan

> **Status:** in relay — round 01, last claude

> **For agentic workers:** REQUIRED SUB-SKILL: Use the executing-plans skill to implement this plan task-by-task (or per-task delegation where the harness supports it — see Execution Handoff). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stream Deck MK.2 whose 14 agent keys show the most active herdr agents (28 over two pages), each as its own pixel mascot under its project name, where a press jumps to that agent, identically for Claude and Codex.

**Architecture:** A new Stream Deck plugin `com.eordouie.herdrdeck` lives in this repo beside the old one and shares its icon renderer (`src/icons/`). Twice a second it asks herdr's socket for one snapshot, turns it into a ranked list with pure functions (settle, rank, label, assign mascots, compose pages), and draws the keys; a press sends herdr one focus command and raises herdr's Ghostty terminal. It reads no session files, no hooks, no process table for state, and writes nothing into any terminal.

**Tech Stack:** TypeScript on the Stream Deck app's Node 20, `@elgato/streamdeck` 1.4.1 (already pinned), rollup, `tsx --test` with `node:test`, herdr 0.9.5 socket API (protocol 22), Ghostty 1.4.0 AppleScript, Python 3 for the layout tool in `~/Projects/dotfiles/streamdeck/`.

## Global Constraints

- macOS only. Stream Deck MK.2, 5 columns by 3 rows. Stream Deck app 7.x, `Software.MinimumVersion` "6.5" as the old manifest.
- No new runtime dependency. `@elgato/streamdeck` stays the only one.
- Use **pnpm**, never npm or npx. Imports carry the `.js` extension even for `.ts` files.
- Work happens in the worktree `/Users/ehsan/Projects/streamdeck-claude/.claude/worktrees/herdr-deck`, branch `feat/herdr-agent-deck`, based on `ghostty-focus`. PRs base on `ghostty-focus` (origin's `main` is a pristine upstream mirror). Never push to main. Commit with explicit paths, past-tense messages.
- **A herdr focus command is sent from a key press and from nowhere else.** It moves the owner's live view. No test, probe, or startup code may call `agent.focus`, `pane.focus`, `tab.focus` or `workspace.focus` against the real socket.
- The plugin never writes to a tty, never sets a terminal title, never calls `pane.report_agent` or any other herdr method that changes state. Its only herdr calls are `session.snapshot`, `ping` and, on a press, `agent.focus`.
- **Nothing may branch on the agent kind.** `kind` ("claude", "codex", ...) is an opaque word that can appear as text on a key and nothing else. A Claude key and a Codex key are drawn by the same code path with the same options.
- No `showOk` on a press. `showAlert` only when a press could not do what it means.
- Deck layout config stays in `~/Projects/dotfiles/streamdeck/` (`layout.toml`, `build_claude_page.py`, `apply-layout.sh`), not in this repo.
- The old plugin's source (`src/*.ts` outside `src/herdr-deck/` and `src/icons/`) and its folder `com.julien.claudesessions.sdPlugin/` are not edited, except the two files this plan names: `src/icons/render.ts` and `src/icons/motifs.ts` (plus the already committed `src/icons/mascot-kit.ts`).
- `pnpm test` in a worktree reports 2 failures that predate this work and are caused by the worktree's depth: "no arguments means a bare tab, not a defaulted agent" and "Ghostty launcher waits for the new tab and fails closed on an unreadable baseline" both read `../dotfiles/streamdeck/scripts/ghostty-new-agent.sh` relative to the repo root. Every "tests pass" in this plan means: no failure other than those two. In the main checkout all tests pass.
- Quitting or relaunching the Stream Deck app, and anything else that closes an application the owner opened by hand, needs the owner's go at that moment (Tasks 11 and 12 say where).
- Semver tags and bulk sync are the owner's own workflows. This plan creates no tag.

## What the owner decided (binding)

1. 14 agent keys per page, two pages, 28 agents. One arrow key bottom-right on each page. The mic, input, dictate, meeting, repos and Slack keys leave the deck.
2. Active agents go to the higher spots.
3. Claude and Codex: no difference in behaviour or in design.
4. The look is the old deck's mascot style: project name on top (the herdr workspace name), one more word at the bottom only where two agents share a project.
5. No animal appears twice. The eight existing animals stay as they are. Twenty new ones, in this order: triceratops, pterodactyl, giraffe, flamingo, penguin, snail, turtle, crocodile, frog, hedgehog, rabbit, pig, octopus, bee, ladybug, duckling, parrot, kangaroo, moose, sheep. All are drawn; any that does not look good is changed after he sees it.

## What the author decided (open to the owner's veto, reviewers may challenge)

| Item | Choice | Reason |
|---|---|---|
| Rank | blocked, then working, then done (finished, not yet looked at), then idle and unknown; inside a group the agent that entered it last comes first | "Active go higher"; an agent waiting on him is the most urgent thing on the deck |
| Animal follows the agent | An agent keeps its animal when it changes key or page | Otherwise every re-sort would change which animal means which agent |
| Hold for a finished turn | A change from working to done, idle or unknown is believed after it has held 4 s; changes to blocked and to working apply at once | Measured: a Codex agent reported done for 2 s between two steps |
| Finished signal | Flash for 60 s, then the white corner dot until herdr reports the agent seen | The old deck flashed until acknowledged; herdr now knows when he has looked |
| Paging | The arrow key is the plugin's own and flips the plugin's two pages on one Stream Deck profile page | The plugin always knows which page is showing; no second profile page to manage |
| Press under a moving key | A press within 250 ms of a key's picture changing means the agent shown before the change | A re-sort under a descending finger must not jump to the wrong agent |
| New plugin beside the old | Own folder and id, sharing `src/icons/` | The old plugin's 9,700 lines are built around session files, hooks, tty stamps and Ghostty tabs; none of it applies. Side by side keeps rollback to two symlinks |
| Polling, not events | One `session.snapshot` every 500 ms | The reply takes 0.6 ms; a poll cannot miss an event or need a resubscribe after herdr restarts |

## Evidence (measured on the owner's machine, 2026-11-23)

Reviewers can reproduce every line; the raw files are in the worktree under `.cache/evidence/`.

- `herdr --version`: 0.9.5. `herdr status`: protocol 22. Socket `~/.config/herdr/herdr.sock`, mode 600.
- Wire format: one JSON object per line. Request `{"id":"x","method":"session.snapshot","params":{}}`, reply `{"id":"x","result":{"type":"session_snapshot","snapshot":{...}}}`, error reply `{"id":"x","error":{"code":"agent_not_found","message":"..."}}`. Measured over a raw socket: `ping` 0.1 ms, `agent.list` 0.5 ms (9.8 KB), `session.snapshot` 0.6 ms (30.6 KB, 19 agents).
- `snapshot` keys: `focused_workspace_id`, `focused_tab_id`, `focused_pane_id`, `workspaces`, `tabs`, `panes`, `layouts`, `agents`. Agent keys: `agent`, `agent_session {source, agent, kind, value}`, `agent_status`, `completion_seq`, `cwd`, `focused`, `foreground_cwd`, `pane_id`, `revision`, `state_change_seq`, `tab_id`, `terminal_id`, `terminal_title`, `terminal_title_stripped`, `tokens`, `workspace_id`. Workspace keys: `label`, `number`, `workspace_id`, `focused`, `agent_status`, `active_tab_id`, `pane_count`, `tab_count`, `worktree`. Tab keys: `label`, `number`, `tab_id`, `workspace_id`, `focused`, `agent_status`, `pane_count`.
- `agent_status` enum in `herdr api schema`: `idle`, `working`, `blocked`, `done`, `unknown`. herdr's own skill text: `done` and `idle` both mean ready for input; "The CLI/API uses the server's seen state to distinguish them; explicit focus commands mark the target seen."
- `state_change_seq` is one counter for the whole server (values 18 to 179 across agents, strictly larger for later changes). An agent that went from done to idle kept its seq (pane `w4:p1`: seq 56, completion_seq 56, idle).
- `agent.focus {"target":"<pane_id>"}` returns `{"type":"agent_info","agent":{...}}` and switches the attached herdr view to that agent's workspace, tab and pane. Observed, not intended: at 16:17:48 a test call moved the owner's view from pane `wB:p2` to `w9:p4`. An unknown target returns error code `agent_not_found`.
- `events.subscribe` answers `{"type":"subscription_started"}` and keeps the connection open. Not used (see the table above).
- Turn-end blip: pane `w7:p2` (Codex) went working (seq 170) to done (seq 177) at 16:18:41 and back to working (seq 178) at 16:18:43.
- A real blocked state: pane `wB:p1` (Claude) went working to blocked (seq 179) at 16:19:11.
- Ghostty 1.4.0 AppleScript: `tty of terminal` reads `/dev/ttys000` for the one terminal, whose title was `Ehsans-MacBook-Pro.local: ssh-issues`. The title carries the focused workspace's name, so it changes as he moves. `ps` shows the herdr view as `herdr` on `ttys000` and the server as `/opt/homebrew/bin/herdr server` with no tty.
- 19 agents in 14 workspaces. Workspace names: personal, hive-2.0, raytracer-engine, solar-sim, herdr, git, displaylink-sec, updates-chats, meeting-record, ssh-issues, spirula-studio, benefits, interviews, TEA. Tab names he typed: health, amazon, simulation, customization, streamdeck, terminal, weekly-update, ssh, vpn, 3D rendering, hsa, lever. Default tab names: numbers, `agents`, `shell`, `Claude`.
- Key geometry from `src/icons/theme.ts`: canvas 144, `TOP_FONT` 19, `BOTTOM_FONT` 17, `VIEWPORT_W` 124. `approxWidth(text, size) = text.length * size * 0.58`, so the top line holds 11 characters and a bottom line 12 before the marquee starts.
- The eight existing mascots emit only `<g>` and `<rect>`.
- The Stream Deck profile "Exowatt" has two pages. Page 1 holds 8 old slot keys, 6 deck-signals keys and the app's next-page key at 4,2. Page 2 holds one previous-page key.
- The old plugin (v2.0.1) restarted with the app at 14:39: `tick: sources=wsl+wsl sessions=21 live=21 actions=8`, keys labelled by folder name, 35 `namer call failed` lines in two minutes, no `tab title:` line.

## File structure

New and changed files, all paths relative to the worktree root unless absolute.

| File | Responsibility |
|---|---|
| `src/icons/mascot-kit.ts` (exists) | The `Mascot` contract, blink clock, breathe and step helpers |
| `src/icons/mascots/<animal>.ts` (20 new) | One sprite each |
| `src/icons/mascots/index.ts` | The 20 new animals in roster order |
| `src/icons/motifs.ts` (edited) | `MASCOTS` = the eight originals + `NEW_MASCOTS` (already wired) |
| `src/icons/render.ts` (edited) | New optional `lines` field on `IconOptions` |
| `src/mascot-roster.test.ts` | 28 distinct animals, well-formed on every frame |
| `src/icon-lines.test.ts` | The `lines` option |
| `src/herdr-deck/herdr-client.ts` | One request, one reply over the socket; `readSnapshot`, `focusAgent` |
| `src/herdr-deck/fake-herdr.ts` | A unix-socket stand-in for tests and the hardware demo |
| `src/herdr-deck/model.ts` | `DeckAgent` and the mapping from a raw snapshot |
| `src/herdr-deck/settle.ts` | The 4 s hold on a finished turn |
| `src/herdr-deck/rank.ts` | The order of agents |
| `src/herdr-deck/press.ts` | Which agent a press means |
| `src/herdr-deck/labels.ts` | Top line, second word |
| `src/herdr-deck/mascot-pool.ts` | Which animal an agent has, and the state file |
| `src/herdr-deck/deck-view.ts` | Pages, key views, the arrow key's view |
| `src/herdr-deck/tracker.ts` | The cross-tick state that joins the pure pieces |
| `src/herdr-deck/key-svg.ts` | SVG for an agent key, an empty key, the arrow key |
| `src/herdr-deck/jump.ts` | Focus command, then raise herdr's Ghostty terminal |
| `src/herdr-deck/agent-key.ts`, `pager-key.ts` | The two Stream Deck actions |
| `src/herdr-deck/plugin.ts` | Entry: wiring, the 500 ms poll, the 120 ms animation tick |
| `src/herdr-deck/*.test.ts` | Tests beside each module |
| `com.eordouie.herdrdeck.sdPlugin/manifest.json`, `imgs/` | The plugin bundle (its `bin/` is built, ignored) |
| `rollup.herdr-deck.config.mjs`, `tsconfig.herdr-deck.json` | The new plugin's own build |
| `scripts/mascot-sheet.mjs` (exists), `scripts/mascot-gallery.mjs` | Contact sheet, animated gallery |
| `scripts/render-herdr-deck-pngs.mjs`, `scripts/link-herdr-deck.sh`, `scripts/herdr-deck-demo.mjs` | Manifest PNGs, the symlink, the hardware demo |
| `/Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py`, `layout.toml`, `SETUP.md` | Key kinds `agent` and `pager`, the 15-key layout, setup notes |
| `/Users/ehsan/Projects/dotfiles/tests/test_streamdeck_layout.py` | Tests for the layout tool |

Runtime files the plugin owns, all under `~/.config/herdr-deck/`: `state.json` (which pane has which animal), `config.json` (optional `{"socketPath": "..."}`), `reload` (touch to restart the plugin).

---

### Task 1: Twenty new animals

Already done before this plan: `src/icons/mascot-kit.ts`, `scripts/mascot-sheet.mjs`, `MASCOTS` exported and extended by `NEW_MASCOTS` (commit 5286b54). Four drawing agents are producing the sprite files against the brief in `.cache/mascot-brief.md`.

**Files:**
- Create: `src/icons/mascots/{triceratops,pterodactyl,giraffe,flamingo,penguin,snail,turtle,crocodile,frog,hedgehog,rabbit,pig,octopus,bee,ladybug,duckling,parrot,kangaroo,moose,sheep}.ts`
- Modify: `src/icons/mascots/index.ts`
- Create: `src/mascot-roster.test.ts`, `scripts/mascot-gallery.mjs`

**Interfaces:**
- Consumes: `Mascot`, `blinkScaleY`, `breatheScaleY`, `isStepA`, `ANIMATION_FRAMES` from `src/icons/mascot-kit.ts`.
- Produces: `MASCOTS` (from `src/icons/motifs.ts`) with length 28; `renderIcon({ slot })` draws animal `slot - 1`.

- [ ] **Step 1: Write the failing roster test**

`src/mascot-roster.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ANIMATION_FRAMES } from "./icons/mascot-kit.js";
import { MASCOTS } from "./icons/motifs.js";

const NEW = [
  "triceratops", "pterodactyl", "giraffe", "flamingo", "penguin", "snail", "turtle", "crocodile", "frog", "hedgehog",
  "rabbit", "pig", "octopus", "bee", "ladybug", "duckling", "parrot", "kangaroo", "moose", "sheep",
];

test("the roster holds 28 distinct animals, the original eight first", () => {
  assert.equal(MASCOTS.length, 28);
  assert.equal(new Set(MASCOTS.map((m) => m.draw)).size, 28);
  assert.deepEqual(MASCOTS.slice(8).map((m) => m.name), NEW);
});

test("every animal draws a well-formed sprite on every frame", () => {
  for (const [i, m] of MASCOTS.entries()) {
    for (let frame = 0; frame < ANIMATION_FRAMES; frame++) {
      const svg = m.draw(frame, i * 700);
      assert.match(svg, /^<g transform="translate\(/, `animal ${i + 1}, frame ${frame}`);
      assert.doesNotMatch(svg, /NaN|undefined|null/, `animal ${i + 1}, frame ${frame}`);
      const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((t) => t[1]));
      assert.deepEqual([...tags].sort(), ["g", "rect"], `animal ${i + 1} uses only <g> and <rect>`);
    }
  }
});

test("every animal faces a direction and stands on the ground line", () => {
  for (const [i, m] of MASCOTS.entries()) {
    assert.ok(m.dir === 1 || m.dir === -1, `animal ${i + 1} dir`);
    assert.ok(m.foot >= 80 && m.foot <= 100, `animal ${i + 1} foot ${m.foot}`);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/mascot-roster.test.ts`
Expected: FAIL, `8 !== 28`.

- [ ] **Step 3: Accept the sprites one by one on rendered sheets**

For each animal file the drawing agents delivered, render it beside two originals and look at the PNG:

```bash
node_modules/.bin/tsx scripts/mascot-sheet.mjs stego elephant <animal> --out .cache/mascot-sheets/review-<animal>.png
```

An animal passes when, on the two 72 px tiles, a person names it in one second, it stands on the shadow line, nothing vanishes into the #0f1115 background, and it does not look like another animal of the 28. An animal that fails is redrawn; after five failed rounds it is reported to the owner as a candidate for a swap (spares: butterfly, snake, dragon, lion, mammoth, camel, narwhal). Do not register a failing animal.

- [ ] **Step 4: Register the roster**

`src/icons/mascots/index.ts`:

```ts
import type { Mascot } from "../mascot-kit.js";
import { bee } from "./bee.js";
import { crocodile } from "./crocodile.js";
import { duckling } from "./duckling.js";
import { flamingo } from "./flamingo.js";
import { frog } from "./frog.js";
import { giraffe } from "./giraffe.js";
import { hedgehog } from "./hedgehog.js";
import { kangaroo } from "./kangaroo.js";
import { ladybug } from "./ladybug.js";
import { moose } from "./moose.js";
import { octopus } from "./octopus.js";
import { parrot } from "./parrot.js";
import { penguin } from "./penguin.js";
import { pig } from "./pig.js";
import { pterodactyl } from "./pterodactyl.js";
import { rabbit } from "./rabbit.js";
import { sheep } from "./sheep.js";
import { snail } from "./snail.js";
import { triceratops } from "./triceratops.js";
import { turtle } from "./turtle.js";

/** The animals added for the herdr deck, in roster order after the original
 *  eight in motifs.ts. The order is the owner's list of 2026-11-23 and decides
 *  which animal a new agent gets first; do not sort it. */
export const NEW_MASCOTS: Mascot[] = [
  triceratops, pterodactyl, giraffe, flamingo, penguin, snail, turtle, crocodile, frog, hedgehog,
  rabbit, pig, octopus, bee, ladybug, duckling, parrot, kangaroo, moose, sheep,
];
```

- [ ] **Step 5: Run the roster test and the type check**

Run: `node_modules/.bin/tsx --test src/mascot-roster.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 3 tests pass; `tsc` prints nothing.

- [ ] **Step 6: Write the gallery script**

The gallery is `.cache/mascot-gallery.html`: all 28 animals at 72 px and at 144 px, resting and walking, animated by the real renderer bundled into the page.

`scripts/mascot-gallery.mjs`:

```js
#!/usr/bin/env node
// Animated gallery of every mascot, drawn in the browser by the plugin's own
// renderer. Run: node scripts/mascot-gallery.mjs   then open the printed file.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esbuildDir = readdirSync(resolve(root, "node_modules/.pnpm")).find((d) => d.startsWith("esbuild@"));
const esbuild = resolve(root, "node_modules/.pnpm", esbuildDir, "node_modules/esbuild/bin/esbuild");
const bundle = (entry, name) =>
  execFileSync(esbuild, [resolve(root, entry), "--bundle", "--format=iife", `--global-name=${name}`, "--log-level=warning"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

const ORIGINALS = ["clawd", "trex", "sauropod", "goose", "elephant", "stego", "llama", "panda"];
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Deck mascots</title>
<style>
body{background:#181825;color:#cdd6f4;font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;margin:0;padding:24px 28px 60px}
h1{font-size:22px;margin:0 0 6px} p{color:#a6adc8;margin:0 0 18px;max-width:72ch}
.grid{display:grid;grid-template-columns:repeat(7,max-content);gap:18px 22px}
figure{margin:0;display:grid;grid-template-columns:72px 72px 144px 144px;gap:8px;align-items:end;background:#000;padding:12px;border-radius:14px}
figcaption{grid-column:1/-1;color:#a6adc8;font-size:13px}
.key{border-radius:14%;overflow:hidden} .key svg{display:block;width:100%;height:100%}
.s{width:72px;height:72px} .b{width:144px;height:144px}
</style></head><body>
<h1>The 28 deck animals</h1>
<p>Each animal resting (blue) and walking (amber), at the key's true 72 px and enlarged twice. Drawn live by the plugin's own code.</p>
<div class="grid" id="grid"></div>
<script>${bundle("src/icons/index.ts", "Icons")}</script>
<script>${bundle("src/icons/motifs.ts", "Motifs")}</script>
<script>
const ORIGINALS = ${JSON.stringify(ORIGINALS)};
const names = Motifs.MASCOTS.map((m, i) => m.name || ORIGINALS[i] || "animal " + (i + 1));
const grid = document.getElementById("grid");
grid.innerHTML = names.map((n, i) => '<figure><div class="key s"></div><div class="key s"></div><div class="key b"></div><div class="key b"></div><figcaption>' + (i + 1) + ". " + n + "</figcaption></figure>").join("");
let frame = 0;
function tick() {
  frame = (frame + 1) % Icons.ANIMATION_FRAMES;
  names.forEach((n, i) => {
    const cells = grid.children[i].querySelectorAll(".key");
    const rest = Icons.renderIcon({ state: "idle", slot: i + 1, label: n, lines: { top: n }, frame, now: Date.now() });
    const walk = Icons.renderIcon({ state: "working", slot: i + 1, label: n, lines: { top: n }, frame, now: Date.now() });
    cells[0].innerHTML = rest; cells[1].innerHTML = walk; cells[2].innerHTML = rest; cells[3].innerHTML = walk;
  });
}
tick();
setInterval(tick, 120);
</script></body></html>`;

const out = resolve(root, ".cache/mascot-gallery.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(out);
```

The gallery uses the `lines` option from Task 2. Until Task 2 lands, `lines` is ignored and the label splits at hyphens, which no animal name has.

- [ ] **Step 7: Run the gallery and the full sheet, and look at both**

```bash
node scripts/mascot-gallery.mjs
node_modules/.bin/tsx scripts/mascot-sheet.mjs --all --out .cache/mascot-sheets/all-28.png
```

Expected: the gallery path printed; `wrote .../all-28.png (2166x8554, 28 animals)`. Read the PNG. Every row must be recognisable at 72 px.

- [ ] **Step 8: Commit**

```bash
git add src/icons/mascots/ src/mascot-roster.test.ts scripts/mascot-gallery.mjs
git commit -m "Added twenty animals so 28 agent keys each carry their own"
```

- [ ] **Step 9: Owner's look**

Open `.cache/mascot-gallery.html` for the owner. Animals he rejects go back to Step 3. This gate does not block Tasks 2 to 10; it blocks Task 12.

---

### Task 2: Explicit text lines on a key

`renderIcon` splits its label at hyphens: "hive-2.0" becomes "hive" on top and "2.0" below. The herdr deck decides the lines itself.

**Files:**
- Modify: `src/icons/render.ts` (the `IconOptions` interface and the first lines of `renderIcon`)
- Test: `src/icon-lines.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IconOptions.lines?: { top: string; line1?: string; line2?: string }`. When set, `label` and `providerLabel` are not used for text.

- [ ] **Step 1: Write the failing test**

`src/icon-lines.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderIcon } from "./icons/index.js";

const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test("explicit lines replace the hyphen split of the label", () => {
  const svg = renderIcon({ state: "idle", slot: 1, label: "ignored-label", lines: { top: "hive-2.0", line1: "codex" }, frame: 0, now: 0 });
  assert.deepEqual(texts(svg), ["hive-2.0", "codex"]);
});

test("two explicit bottom lines are both drawn, in order", () => {
  const svg = renderIcon({ state: "idle", slot: 1, label: "", lines: { top: "raytracer", line1: "engine", line2: "codex" }, frame: 0, now: 0 });
  assert.deepEqual(texts(svg), ["raytracer", "engine", "codex"]);
});

test("a provider label is not drawn when lines are given", () => {
  const svg = renderIcon({ state: "idle", slot: 1, label: "x", providerLabel: "codex", lines: { top: "git" }, frame: 0, now: 0 });
  assert.deepEqual(texts(svg), ["git"]);
});

test("without lines the label still splits at the hyphen and the provider label takes the last line", () => {
  const svg = renderIcon({ state: "idle", slot: 1, label: "asphalt-siting", providerLabel: "codex", frame: 0, now: 0 });
  assert.deepEqual(texts(svg), ["asphalt", "siting", "codex"]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/icon-lines.test.ts`
Expected: the first three tests FAIL (`lines` is not a known option, so "ignored" and "label" are drawn); the fourth passes.

- [ ] **Step 3: Add the option**

In `src/icons/render.ts`, add to `IconOptions`, after `providerLabel`:

```ts
  /** The key's text, decided by the caller: `top` above the motif, up to two
   *  lines below it. When set, `label` is not split and `providerLabel` is not
   *  drawn. The herdr deck uses this: its top line is a whole project name,
   *  hyphens included. */
  lines?: { top: string; line1?: string; line2?: string };
```

Replace, inside `renderIcon`, from `export function renderIcon(` through the `const line2 = ...` statement with:

```ts
export function renderIcon({ state, slot, label, providerLabel, lines, frame = 0, now, todos, attention, awaitingReply, overflow, bgAgents }: IconOptions): string {
  const t = now ?? Date.now();
  const { bg, accent, label: labelColor } = STATES[state].palette;
  const flash = attention === true;
  const isEmpty = state === "empty";
  const explicit = !isEmpty && lines !== undefined;
  const split = isEmpty
    ? { top: "free slot", line1: "", line2: "" }
    : explicit
      ? { top: lines.top, line1: lines.line1 ?? "", line2: lines.line2 ?? "" }
      : splitLabel(label);
  const { top } = split;

  // The provider tag takes the lowest line. For a one-token label (the usual
  // case once a deck name is assigned) both bottom slots were empty, so this
  // costs nothing; for a multi-token label the remaining tokens collapse onto
  // the line above rather than being dropped. Explicit lines are drawn as given.
  const rest = [split.line1, split.line2].filter(Boolean).join("-");
  const line1 = !explicit && providerLabel ? rest : split.line1;
  const line2 = !explicit && providerLabel ? providerLabel : split.line2;
```

- [ ] **Step 4: Run the tests**

Run: `node_modules/.bin/tsx --test src/icon-lines.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 4 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/icons/render.ts src/icon-lines.test.ts
git commit -m "Let a caller give a key its text lines instead of a hyphen-split label"
```

---

### Task 3: Talking to herdr

**Files:**
- Create: `src/herdr-deck/herdr-client.ts`, `src/herdr-deck/fake-herdr.ts`, `src/herdr-deck/model.ts`, `src/herdr-deck/fixtures.ts`
- Test: `src/herdr-deck/herdr-client.test.ts`, `src/herdr-deck/model.test.ts`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Produces:
  - `DEFAULT_SOCKET: string`, `class HerdrError extends Error { code: string }`
  - `herdrCall<T>(socketPath: string, method: string, params?: object, timeoutMs?: number): Promise<T>`
  - `readSnapshot(socketPath: string): Promise<RawSnapshot>`, `focusAgent(socketPath: string, paneId: string): Promise<void>`
  - `RawSnapshot { focused_pane_id: string | null; workspaces: RawWorkspace[]; tabs: RawTab[]; agents: RawAgent[] }`
  - `startFakeHerdr(socketPath: string, snapshot: RawSnapshot): Promise<FakeHerdr>` with `FakeHerdr { socketPath; snapshot; focusCalls: string[]; close(): Promise<void> }`
  - `type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown"`
  - `DeckAgent { paneId; kind; status; seq; workspace; workspaceNumber; tab; sessionId }`, `toDeckAgents(snap: RawSnapshot): DeckAgent[]`
  - Test helpers `rawAgent(over)`, `rawSnapshot(agents)`, `deckAgent(over)`

- [ ] **Step 1: Make the test runner see the new folder**

In `package.json`, change the `test` script from `"tsx --test src/*.test.ts"` to:

```json
    "test": "tsx --test src/*.test.ts src/herdr-deck/*.test.ts",
```

- [ ] **Step 2: Write the fixtures**

`src/herdr-deck/fixtures.ts`:

```ts
import type { RawAgent, RawSnapshot } from "./herdr-client.js";
import type { DeckAgent } from "./model.js";

/** A raw agent as herdr reports it. Pane `wA:p1` lives in workspace `wA`, tab `wA:t1`. */
export function rawAgent(over: Partial<RawAgent> & { pane_id: string }): RawAgent {
  const workspace = over.pane_id.split(":")[0];
  return {
    workspace_id: workspace,
    tab_id: `${workspace}:t1`,
    agent: "claude",
    agent_status: "idle",
    focused: false,
    state_change_seq: 1,
    agent_session: { value: `session-${over.pane_id}` },
    ...over,
  };
}

/** A snapshot whose workspaces and tabs are derived from the agents: workspace
 *  `wA` is labelled "wA" and numbered in order of first appearance; every tab is labelled "1". */
export function rawSnapshot(agents: RawAgent[]): RawSnapshot {
  const workspaceIds = [...new Set(agents.map((a) => a.workspace_id))];
  const tabIds = [...new Set(agents.map((a) => a.tab_id))];
  return {
    focused_pane_id: agents.find((a) => a.focused)?.pane_id ?? null,
    workspaces: workspaceIds.map((id, i) => ({ workspace_id: id, label: id, number: i + 1 })),
    tabs: tabIds.map((id) => ({ tab_id: id, workspace_id: id.split(":")[0], label: "1", number: 1 })),
    agents,
  };
}

export function deckAgent(over: Partial<DeckAgent> & { paneId: string }): DeckAgent {
  return {
    kind: "claude",
    status: "idle",
    seq: 1,
    workspace: over.paneId.split(":")[0],
    workspaceNumber: 1,
    tab: "1",
    sessionId: `session-${over.paneId}`,
    ...over,
  };
}
```

- [ ] **Step 3: Write the failing client test**

`src/herdr-deck/herdr-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFakeHerdr } from "./fake-herdr.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import { focusAgent, HerdrError, herdrCall, readSnapshot } from "./herdr-client.js";

const socketIn = (name: string): string => join(mkdtempSync(join(tmpdir(), "hd-")), name);

test("readSnapshot returns what herdr holds", async () => {
  const fake = await startFakeHerdr(socketIn("a.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1", agent_status: "working" })]));
  try {
    const snap = await readSnapshot(fake.socketPath);
    assert.equal(snap.agents.length, 1);
    assert.equal(snap.agents[0].agent_status, "working");
  } finally {
    await fake.close();
  }
});

test("focusAgent sends the pane id and herdr moves its focus", async () => {
  const fake = await startFakeHerdr(socketIn("b.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]));
  try {
    await focusAgent(fake.socketPath, "wB:p1");
    assert.deepEqual(fake.focusCalls, ["wB:p1"]);
    assert.equal(fake.snapshot.focused_pane_id, "wB:p1");
  } finally {
    await fake.close();
  }
});

test("an unknown pane is a HerdrError with herdr's own code", async () => {
  const fake = await startFakeHerdr(socketIn("c.sock"), rawSnapshot([]));
  try {
    await assert.rejects(focusAgent(fake.socketPath, "w0:p9"), (err: unknown) => err instanceof HerdrError && err.code === "agent_not_found");
  } finally {
    await fake.close();
  }
});

test("no socket file means herdr is not running, reported as ENOENT", async () => {
  await assert.rejects(readSnapshot(socketIn("missing.sock")), (err: unknown) => err instanceof HerdrError && err.code === "ENOENT");
});

test("a herdr that accepts and never answers is a timeout", async () => {
  const path = socketIn("d.sock");
  // A socket nobody reads from never notices that the other side hung up, and
  // server.close() waits for every connection: destroy them, or this test never ends.
  const accepted: Socket[] = [];
  const server = createServer((conn) => accepted.push(conn));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await assert.rejects(herdrCall(path, "session.snapshot", {}, 100), (err: unknown) => err instanceof HerdrError && err.code === "timeout");
  } finally {
    for (const conn of accepted) conn.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/herdr-client.test.ts`
Expected: FAIL, cannot find module `./fake-herdr.js`.

- [ ] **Step 5: Write the client**

`src/herdr-deck/herdr-client.ts`:

```ts
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/** herdr's default session socket. A named session (`herdr --session x`) has
 *  its own; `~/.config/herdr-deck/config.json` can point the deck at it. */
export const DEFAULT_SOCKET = join(homedir(), ".config", "herdr", "herdr.sock");

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export interface RawAgent {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  agent: string;
  agent_status: string;
  focused: boolean;
  state_change_seq?: number;
  agent_session?: { value?: string };
}
export interface RawWorkspace {
  workspace_id: string;
  label: string;
  number: number;
}
export interface RawTab {
  tab_id: string;
  workspace_id: string;
  label: string | number;
  number: number;
}
export interface RawSnapshot {
  focused_pane_id: string | null;
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  agents: RawAgent[];
}

/** One request, one reply, one connection. herdr answers a full snapshot in
 *  under a millisecond, so a connection per call costs nothing and leaves no
 *  socket state to heal after herdr restarts. Rejects with a HerdrError whose
 *  code is herdr's own (`agent_not_found`), the socket's (`ENOENT`,
 *  `ECONNREFUSED`), or `timeout` / `closed` / `bad_reply`. */
export function herdrCall<T>(socketPath: string, method: string, params: object = {}, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    let buf = "";
    let settled = false;
    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      act();
    };
    const timer = setTimeout(
      () => finish(() => reject(new HerdrError("timeout", `${method} got no reply in ${timeoutMs} ms`))),
      timeoutMs,
    );
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(`${JSON.stringify({ id: "deck", method, params })}\n`));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const end = buf.indexOf("\n");
      if (end < 0) return;
      const line = buf.slice(0, end);
      finish(() => {
        let msg: { result?: T; error?: { code?: string; message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          reject(new HerdrError("bad_reply", `${method} reply is not JSON`));
          return;
        }
        if (msg.error) reject(new HerdrError(msg.error.code ?? "error", msg.error.message ?? method));
        else if (msg.result === undefined) reject(new HerdrError("bad_reply", `${method} reply has no result`));
        else resolve(msg.result);
      });
    });
    sock.on("error", (err: NodeJS.ErrnoException) => finish(() => reject(new HerdrError(err.code ?? "socket", err.message))));
    sock.on("close", () => finish(() => reject(new HerdrError("closed", `${method}: herdr closed the connection before replying`))));
  });
}

export async function readSnapshot(socketPath: string): Promise<RawSnapshot> {
  const result = await herdrCall<{ snapshot: RawSnapshot }>(socketPath, "session.snapshot");
  return result.snapshot;
}

/** Moves the owner's live herdr view to this agent. Called from a key press
 *  and from nowhere else. */
export async function focusAgent(socketPath: string, paneId: string): Promise<void> {
  await herdrCall(socketPath, "agent.focus", { target: paneId });
}
```

- [ ] **Step 6: Write the fake**

`src/herdr-deck/fake-herdr.ts`:

```ts
import { rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import type { RawSnapshot } from "./herdr-client.js";

export interface FakeHerdr {
  socketPath: string;
  /** Mutable: a test or the demo changes it and the next read sees the change. */
  snapshot: RawSnapshot;
  /** Every pane id an `agent.focus` asked for, in order. */
  focusCalls: string[];
  close(): Promise<void>;
}

/** A unix socket that speaks the three herdr methods the deck uses. For tests
 *  and for the hardware demo, so neither ever touches the owner's herdr. */
export function startFakeHerdr(socketPath: string, snapshot: RawSnapshot): Promise<FakeHerdr> {
  rmSync(socketPath, { force: true });
  // server.close() waits for every open connection; close() destroys them so
  // a client that never hangs up cannot keep a test or the demo from ending.
  const open = new Set<Socket>();
  const server = createServer((conn) => {
    let buf = "";
    open.add(conn);
    conn.setEncoding("utf8");
    conn.on("error", () => {});
    conn.on("close", () => open.delete(conn));
    conn.on("data", (chunk: string) => {
      buf += chunk;
      for (let end = buf.indexOf("\n"); end >= 0; end = buf.indexOf("\n")) {
        const line = buf.slice(0, end);
        buf = buf.slice(end + 1);
        conn.write(`${JSON.stringify(reply(fake, line))}\n`);
      }
    });
  });
  const fake: FakeHerdr = {
    socketPath,
    snapshot,
    focusCalls: [],
    close: () =>
      new Promise((resolve) => {
        for (const conn of open) conn.destroy();
        server.close(() => {
          rmSync(socketPath, { force: true });
          resolve();
        });
      }),
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(fake));
  });
}

function reply(fake: FakeHerdr, line: string): object {
  let req: { id?: string; method?: string; params?: { target?: string } };
  try {
    req = JSON.parse(line);
  } catch {
    return { id: "", error: { code: "bad_request", message: "not JSON" } };
  }
  const id = req.id ?? "";
  if (req.method === "ping") return { id, result: { type: "pong", version: "fake", protocol: 22 } };
  if (req.method === "session.snapshot") return { id, result: { type: "session_snapshot", snapshot: fake.snapshot } };
  if (req.method === "agent.focus") {
    const target = req.params?.target ?? "";
    const agent = fake.snapshot.agents.find((a) => a.pane_id === target);
    if (!agent) return { id, error: { code: "agent_not_found", message: `agent target ${target} not found` } };
    fake.focusCalls.push(target);
    for (const a of fake.snapshot.agents) a.focused = a.pane_id === target;
    fake.snapshot.focused_pane_id = target;
    return { id, result: { type: "agent_info", agent } };
  }
  return { id, error: { code: "unknown_method", message: String(req.method) } };
}
```

- [ ] **Step 7: Run the client test**

Run: `node_modules/.bin/tsx --test src/herdr-deck/herdr-client.test.ts`
Expected: 5 tests pass.

- [ ] **Step 8: Write the failing model test**

`src/herdr-deck/model.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { rawAgent } from "./fixtures.js";
import type { RawSnapshot } from "./herdr-client.js";
import { toDeckAgents } from "./model.js";

const snapshot: RawSnapshot = {
  focused_pane_id: null,
  workspaces: [
    { workspace_id: "w2", label: "hive-2.0", number: 2 },
    { workspace_id: "wT", label: "personal", number: 1 },
  ],
  tabs: [
    { tab_id: "w2:t1", workspace_id: "w2", label: "simulation", number: 1 },
    { tab_id: "wT:t3", workspace_id: "wT", label: 3, number: 3 },
  ],
  agents: [
    rawAgent({ pane_id: "w2:p2", tab_id: "w2:t1", agent: "codex", agent_status: "done", state_change_seq: 94, agent_session: { value: "abc" } }),
    rawAgent({ pane_id: "wT:p3", tab_id: "wT:t3", agent_status: "sleeping", state_change_seq: undefined, agent_session: undefined }),
    rawAgent({ pane_id: "wX:p1" }),
  ],
};

test("an agent carries its workspace's name and number and its tab's name", () => {
  const [a] = toDeckAgents(snapshot);
  assert.deepEqual(a, { paneId: "w2:p2", kind: "codex", status: "done", seq: 94, workspace: "hive-2.0", workspaceNumber: 2, tab: "simulation", sessionId: "abc" });
});

test("a status herdr does not define, a missing counter and a missing session are tolerated", () => {
  const b = toDeckAgents(snapshot)[1];
  assert.equal(b.status, "unknown");
  assert.equal(b.seq, 0);
  assert.equal(b.sessionId, "");
  assert.equal(b.tab, "3");
});

test("an agent whose workspace is not in the snapshot is named by its workspace id", () => {
  const c = toDeckAgents(snapshot)[2];
  assert.equal(c.workspace, "wX");
  assert.equal(c.workspaceNumber, Number.MAX_SAFE_INTEGER);
  assert.equal(c.tab, "");
});
```

- [ ] **Step 9: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/model.test.ts`
Expected: FAIL, cannot find module `./model.js`.

- [ ] **Step 10: Write the model**

`src/herdr-deck/model.ts`:

```ts
import type { RawSnapshot } from "./herdr-client.js";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
const STATUSES: readonly string[] = ["idle", "working", "blocked", "done", "unknown"];

export interface DeckAgent {
  paneId: string;
  /** "claude", "codex", ... An opaque word: it may be drawn, nothing may branch on it. */
  kind: string;
  status: AgentStatus;
  /** herdr's server-wide counter at this agent's last state change; larger is later. */
  seq: number;
  /** The workspace's name: the project name on the key's top line. */
  workspace: string;
  workspaceNumber: number;
  tab: string;
  sessionId: string;
}

export function toDeckAgents(snap: RawSnapshot): DeckAgent[] {
  const workspaces = new Map(snap.workspaces.map((w) => [w.workspace_id, w]));
  const tabs = new Map(snap.tabs.map((t) => [t.tab_id, t]));
  return snap.agents.map((a) => {
    const ws = workspaces.get(a.workspace_id);
    return {
      paneId: a.pane_id,
      kind: a.agent,
      status: (STATUSES.includes(a.agent_status) ? a.agent_status : "unknown") as AgentStatus,
      seq: a.state_change_seq ?? 0,
      workspace: ws?.label || a.workspace_id,
      workspaceNumber: ws?.number ?? Number.MAX_SAFE_INTEGER,
      tab: String(tabs.get(a.tab_id)?.label ?? ""),
      sessionId: a.agent_session?.value ?? "",
    };
  });
}
```

- [ ] **Step 11: Run both tests and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/herdr-client.test.ts src/herdr-deck/model.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 8 tests pass; `tsc` prints nothing.

- [ ] **Step 12: Commit**

```bash
git add package.json src/herdr-deck/herdr-client.ts src/herdr-deck/fake-herdr.ts src/herdr-deck/model.ts src/herdr-deck/fixtures.ts src/herdr-deck/herdr-client.test.ts src/herdr-deck/model.test.ts
git commit -m "Read herdr's snapshot over its socket and mapped it to deck agents"
```

---

### Task 4: Settle, rank, and what a press means

**Files:**
- Create: `src/herdr-deck/settle.ts`, `src/herdr-deck/rank.ts`, `src/herdr-deck/press.ts`
- Test: `src/herdr-deck/settle.test.ts`, `src/herdr-deck/rank.test.ts`, `src/herdr-deck/press.test.ts`

**Interfaces:**
- Consumes: `DeckAgent`, `AgentStatus` (Task 3); `deckAgent` fixture.
- Produces:
  - `HOLD_MS = 4000`, `type SettleState = Map<string, Settled>`, `settle(prev: SettleState, agents: readonly DeckAgent[], now: number): { agents: DeckAgent[]; state: SettleState }`. The returned agents carry the status the deck shows and, as `seq`, the counter at which they entered that status.
  - `rankAgents(agents: readonly DeckAgent[]): DeckAgent[]`
  - `PRESS_GRACE_MS = 250`, `Binding { paneId?: string; previous?: string; changedAt: number }`, `rebind(old: Binding | undefined, paneId: string | undefined, now: number): Binding`, `resolvePress(b: Binding | undefined, now: number): string | undefined`

- [ ] **Step 1: Write the failing settle test**

`src/herdr-deck/settle.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import type { AgentStatus } from "./model.js";
import { HOLD_MS, settle, type SettleState } from "./settle.js";

/** Feed one agent's raw (status, seq) at each time; return what the deck shows each time. */
function run(steps: Array<[number, AgentStatus, number]>): Array<[AgentStatus, number]> {
  let state: SettleState = new Map();
  return steps.map(([now, status, seq]) => {
    const r = settle(state, [deckAgent({ paneId: "wA:p1", status, seq })], now);
    state = r.state;
    return [r.agents[0].status, r.agents[0].seq];
  });
}

test("the measured 2 s finished blip never reaches the deck", () => {
  // Pane w7:p2 on 2026-11-23: working 170, done 177 at 16:18:41, working 178 at 16:18:43.
  assert.deepEqual(run([[0, "working", 170], [1000, "done", 177], [2500, "done", 177], [3000, "working", 178], [9000, "working", 178]]), [
    ["working", 170], ["working", 170], ["working", 170], ["working", 170], ["working", 170],
  ]);
});

test("a turn that stays ended is believed once it has held HOLD_MS", () => {
  assert.deepEqual(run([[0, "working", 10], [1000, "done", 20], [1000 + HOLD_MS - 1, "done", 20], [1000 + HOLD_MS, "done", 20]]), [
    ["working", 10], ["working", 10], ["working", 10], ["done", 20],
  ]);
});

test("needing the owner is shown at once, even during a hold", () => {
  assert.deepEqual(run([[0, "working", 10], [500, "idle", 11], [900, "blocked", 12]]), [["working", 10], ["working", 10], ["blocked", 12]]);
});

test("starting to work is shown at once", () => {
  assert.deepEqual(run([[0, "idle", 5], [100, "working", 6]]), [["idle", 5], ["working", 6]]);
});

test("seen after finished is shown at once and keeps the finish counter", () => {
  assert.deepEqual(run([[0, "done", 30], [100, "idle", 30]]), [["done", 30], ["idle", 30]]);
});

test("an agent the deck has not seen before is shown as herdr reports it", () => {
  assert.deepEqual(run([[0, "done", 7]]), [["done", 7]]);
});

test("an agent that left is forgotten", () => {
  const first = settle(new Map(), [deckAgent({ paneId: "wA:p1" }), deckAgent({ paneId: "wB:p1" })], 0);
  const second = settle(first.state, [deckAgent({ paneId: "wB:p1" })], 500);
  assert.deepEqual([...second.state.keys()], ["wB:p1"]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/settle.test.ts`
Expected: FAIL, cannot find module `./settle.js`.

- [ ] **Step 3: Write settle**

`src/herdr-deck/settle.ts`:

```ts
import type { AgentStatus, DeckAgent } from "./model.js";

/** How long a turn must stay ended before the deck believes it. Measured
 *  2026-11-23: a Codex agent reported `done` for 2 s between two steps, which
 *  would have thrown its key out of the working group and back. */
export const HOLD_MS = 4000;

export interface Settled {
  /** The status the deck shows. */
  shown: AgentStatus;
  /** herdr's counter when the agent entered `shown`: its place inside the group. */
  order: number;
  /** When herdr first reported the ended turn the deck is still holding back. */
  pendingSince?: number;
}
export type SettleState = Map<string, Settled>;

const ENDED: readonly AgentStatus[] = ["done", "idle", "unknown"];

/** Replace each agent's raw status and counter by what the deck shows. Only
 *  the end of a turn is held back; blocked and working apply at once. While
 *  the shown status is unchanged its counter is unchanged too, so a blip
 *  cannot move a key inside its group either. */
export function settle(
  prev: SettleState,
  agents: readonly DeckAgent[],
  now: number,
): { agents: DeckAgent[]; state: SettleState } {
  const state: SettleState = new Map();
  const out = agents.map((a) => {
    const p = prev.get(a.paneId);
    let next: Settled;
    if (!p) {
      next = { shown: a.status, order: a.seq };
    } else if (a.status === p.shown) {
      next = { shown: p.shown, order: p.order };
    } else if (p.shown === "working" && ENDED.includes(a.status)) {
      const since = p.pendingSince ?? now;
      next = now - since >= HOLD_MS ? { shown: a.status, order: a.seq } : { shown: "working", order: p.order, pendingSince: since };
    } else {
      next = { shown: a.status, order: a.seq };
    }
    state.set(a.paneId, next);
    return { ...a, status: next.shown, seq: next.order };
  });
  return { agents: out, state };
}
```

- [ ] **Step 4: Run the settle test**

Run: `node_modules/.bin/tsx --test src/herdr-deck/settle.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Write the failing rank test**

`src/herdr-deck/rank.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { rankAgents } from "./rank.js";

const ids = (agents: ReturnType<typeof rankAgents>): string[] => agents.map((a) => a.paneId);

test("needs-you, then working, then finished, then idle", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "idle", seq: 90 }),
    deckAgent({ paneId: "wB:p1", status: "done", seq: 80 }),
    deckAgent({ paneId: "wC:p1", status: "working", seq: 70 }),
    deckAgent({ paneId: "wD:p1", status: "blocked", seq: 60 }),
  ]);
  assert.deepEqual(ids(ranked), ["wD:p1", "wC:p1", "wB:p1", "wA:p1"]);
});

test("inside a group the agent that entered it last comes first", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "working", seq: 5 }),
    deckAgent({ paneId: "wB:p1", status: "working", seq: 9 }),
    deckAgent({ paneId: "wC:p1", status: "working", seq: 7 }),
  ]);
  assert.deepEqual(ids(ranked), ["wB:p1", "wC:p1", "wA:p1"]);
});

test("an unclassified agent ranks with the idle ones", () => {
  const ranked = rankAgents([
    deckAgent({ paneId: "wA:p1", status: "unknown", seq: 50 }),
    deckAgent({ paneId: "wB:p1", status: "idle", seq: 60 }),
    deckAgent({ paneId: "wC:p1", status: "done", seq: 1 }),
  ]);
  assert.deepEqual(ids(ranked), ["wC:p1", "wB:p1", "wA:p1"]);
});

test("equal counters fall back to workspace order, then pane number, so the order never flickers", () => {
  const a = deckAgent({ paneId: "wB:p10", workspaceNumber: 2, seq: 0 });
  const b = deckAgent({ paneId: "wB:p2", workspaceNumber: 2, seq: 0 });
  const c = deckAgent({ paneId: "wA:p1", workspaceNumber: 1, seq: 0 });
  assert.deepEqual(ids(rankAgents([a, b, c])), ["wA:p1", "wB:p2", "wB:p10"]);
  assert.deepEqual(ids(rankAgents([c, b, a])), ["wA:p1", "wB:p2", "wB:p10"]);
});

test("ranking does not mutate its input", () => {
  const input = [deckAgent({ paneId: "wA:p1", status: "idle" }), deckAgent({ paneId: "wB:p1", status: "blocked" })];
  rankAgents(input);
  assert.equal(input[0].paneId, "wA:p1");
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/rank.test.ts`
Expected: FAIL, cannot find module `./rank.js`.

- [ ] **Step 7: Write rank**

`src/herdr-deck/rank.ts`:

```ts
import type { AgentStatus, DeckAgent } from "./model.js";

/** Lower is higher on the deck. An agent herdr cannot classify sits with the idle ones. */
const GROUP: Record<AgentStatus, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 3 };

const paneNumber = (paneId: string): number => Number(paneId.split(":p")[1]) || 0;

/** Needs-you first, then working, then finished and not yet looked at, then
 *  idle. Inside a group the agent that entered it last comes first. The tail
 *  of the comparison only makes the order total, so two polls of the same
 *  state always give the same keys. */
export function rankAgents(agents: readonly DeckAgent[]): DeckAgent[] {
  return [...agents].sort(
    (a, b) =>
      GROUP[a.status] - GROUP[b.status] ||
      b.seq - a.seq ||
      a.workspaceNumber - b.workspaceNumber ||
      paneNumber(a.paneId) - paneNumber(b.paneId) ||
      a.paneId.localeCompare(b.paneId),
  );
}
```

- [ ] **Step 8: Run the rank test**

Run: `node_modules/.bin/tsx --test src/herdr-deck/rank.test.ts`
Expected: 5 tests pass.

- [ ] **Step 9: Write the failing press test**

`src/herdr-deck/press.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESS_GRACE_MS, rebind, resolvePress } from "./press.js";

test("a press means the agent on the key", () => {
  const b = rebind(undefined, "wA:p1", 1000);
  assert.equal(resolvePress(b, 5000), "wA:p1");
});

test("a press just after the picture changed means the agent shown before", () => {
  const first = rebind(undefined, "wA:p1", 1000);
  const second = rebind(first, "wB:p1", 9000);
  assert.equal(resolvePress(second, 9000 + PRESS_GRACE_MS - 1), "wA:p1");
  assert.equal(resolvePress(second, 9000 + PRESS_GRACE_MS), "wB:p1");
});

test("an unchanged key keeps the time of its last change", () => {
  const first = rebind(undefined, "wA:p1", 1000);
  assert.equal(rebind(first, "wA:p1", 2000), first);
});

test("a key that was empty a moment ago means the agent now on it", () => {
  const first = rebind(undefined, undefined, 1000);
  const second = rebind(first, "wA:p1", 2000);
  assert.equal(resolvePress(second, 2001), "wA:p1");
});

test("an empty key, or a key never drawn, means nothing", () => {
  assert.equal(resolvePress(rebind(undefined, undefined, 0), 5000), undefined);
  assert.equal(resolvePress(undefined, 5000), undefined);
});
```

- [ ] **Step 10: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/press.test.ts`
Expected: FAIL, cannot find module `./press.js`.

- [ ] **Step 11: Write press**

`src/herdr-deck/press.ts`:

```ts
/** A key's picture can change under a descending finger when the agents
 *  re-sort. Inside this window a press means what the key showed before. */
export const PRESS_GRACE_MS = 250;

export interface Binding {
  /** The agent the key shows now; undefined for an empty key. */
  paneId?: string;
  /** The agent it showed before its last change. */
  previous?: string;
  changedAt: number;
}

export function rebind(old: Binding | undefined, paneId: string | undefined, now: number): Binding {
  if (old && old.paneId === paneId) return old;
  return { paneId, previous: old?.paneId, changedAt: now };
}

export function resolvePress(b: Binding | undefined, now: number): string | undefined {
  if (!b) return undefined;
  if (b.previous !== undefined && now - b.changedAt < PRESS_GRACE_MS) return b.previous;
  return b.paneId;
}
```

- [ ] **Step 12: Run all three tests and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/settle.test.ts src/herdr-deck/rank.test.ts src/herdr-deck/press.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 17 tests pass; `tsc` prints nothing.

- [ ] **Step 13: Commit**

```bash
git add src/herdr-deck/settle.ts src/herdr-deck/rank.ts src/herdr-deck/press.ts src/herdr-deck/settle.test.ts src/herdr-deck/rank.test.ts src/herdr-deck/press.test.ts
git commit -m "Ranked agents by need and activity, held back turn-end blips, and bound a press to what the key showed"
```

---

### Task 5: The words on a key

**Files:**
- Create: `src/herdr-deck/labels.ts`
- Test: `src/herdr-deck/labels.test.ts`

**Interfaces:**
- Consumes: `DeckAgent`; `approxWidth` from `src/icons/text.ts`; `TOP_FONT`, `VIEWPORT_W` from `src/icons/theme.ts`.
- Produces:
  - `KeyLines { top: string; line1: string; line2: string }`
  - `typedTab(tab: string): string` ("" for a default tab name)
  - `splitProject(name: string): { top: string; rest: string }`
  - `secondWords(agents: readonly DeckAgent[]): Map<string, string>` (pane id to word, only for agents that share a project)
  - `keyLines(agent: DeckAgent, word: string): KeyLines`

- [ ] **Step 1: Write the failing test**

`src/herdr-deck/labels.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { keyLines, secondWords, splitProject, typedTab } from "./labels.js";

test("a project name that fits the top line stays whole, hyphen included", () => {
  for (const name of ["hive-2.0", "solar-sim", "ssh-issues", "interviews", "TEA", "git"]) {
    assert.deepEqual(splitProject(name), { top: name, rest: "" }, name);
  }
});

test("a longer name breaks at the last hyphen that still fits", () => {
  assert.deepEqual(splitProject("raytracer-engine"), { top: "raytracer", rest: "engine" });
  assert.deepEqual(splitProject("displaylink-sec"), { top: "displaylink", rest: "sec" });
  assert.deepEqual(splitProject("updates-chats"), { top: "updates", rest: "chats" });
  assert.deepEqual(splitProject("meeting-record"), { top: "meeting", rest: "record" });
  assert.deepEqual(splitProject("spirula-studio"), { top: "spirula", rest: "studio" });
  assert.deepEqual(splitProject("a-b-c-d-e-f-g-h"), { top: "a-b-c-d-e-f", rest: "g-h" });
  assert.deepEqual(splitProject("big design review"), { top: "big design", rest: "review" });
});

test("a long name with nowhere to break stays whole and scrolls", () => {
  assert.deepEqual(splitProject("supercalifragilistic"), { top: "supercalifragilistic", rest: "" });
});

test("default tab names are not words he typed", () => {
  for (const tab of ["1", "12", "agents", "Claude", "codex", "shell", ""]) assert.equal(typedTab(tab), "", tab);
  for (const tab of ["amazon", "vpn", "3D rendering"]) assert.equal(typedTab(tab), tab);
});

test("a lone agent in its project gets no second word", () => {
  assert.equal(secondWords([deckAgent({ paneId: "wA:p1", workspace: "git" })]).size, 0);
});

test("two agents in typed tabs are told apart by the tab names", () => {
  const words = secondWords([
    deckAgent({ paneId: "wT:p2", workspace: "personal", tab: "health", kind: "codex" }),
    deckAgent({ paneId: "wT:p3", workspace: "personal", tab: "amazon", kind: "codex" }),
  ]);
  assert.deepEqual([...words], [["wT:p2", "health"], ["wT:p3", "amazon"]]);
});

test("two agents side by side in one tab are told apart by their kind", () => {
  const words = secondWords([
    deckAgent({ paneId: "w2:p1", workspace: "hive-2.0", tab: "simulation", kind: "claude" }),
    deckAgent({ paneId: "w2:p2", workspace: "hive-2.0", tab: "simulation", kind: "codex" }),
  ]);
  assert.deepEqual([...words], [["w2:p1", "claude"], ["w2:p2", "codex"]]);
});

test("a mix falls back to the typed tab, else the kind, numbered when still equal", () => {
  const words = secondWords([
    deckAgent({ paneId: "w7:p1", workspace: "raytracer-engine", tab: "agents", kind: "claude" }),
    deckAgent({ paneId: "w7:p2", workspace: "raytracer-engine", tab: "agents", kind: "codex" }),
    deckAgent({ paneId: "w7:p5", workspace: "raytracer-engine", tab: "bakeoff", kind: "claude" }),
    deckAgent({ paneId: "w7:p9", workspace: "raytracer-engine", tab: "2", kind: "claude" }),
  ]);
  assert.deepEqual([...words], [["w7:p1", "claude"], ["w7:p2", "codex"], ["w7:p5", "bakeoff"], ["w7:p9", "claude 2"]]);
});

test("the numbering follows pane order, whatever order the agents arrive in", () => {
  const words = secondWords([
    deckAgent({ paneId: "wA:p10", workspace: "x", tab: "1" }),
    deckAgent({ paneId: "wA:p2", workspace: "x", tab: "1" }),
  ]);
  assert.equal(words.get("wA:p2"), "claude");
  assert.equal(words.get("wA:p10"), "claude 2");
});

test("lines: the project on top, the rest of a long name and the second word below", () => {
  assert.deepEqual(keyLines(deckAgent({ paneId: "wA:p1", workspace: "git" }), ""), { top: "git", line1: "", line2: "" });
  assert.deepEqual(keyLines(deckAgent({ paneId: "wA:p1", workspace: "hive-2.0" }), "codex"), { top: "hive-2.0", line1: "codex", line2: "" });
  assert.deepEqual(keyLines(deckAgent({ paneId: "wA:p1", workspace: "raytracer-engine" }), ""), { top: "raytracer", line1: "engine", line2: "" });
  assert.deepEqual(keyLines(deckAgent({ paneId: "wA:p1", workspace: "raytracer-engine" }), "codex"), { top: "raytracer", line1: "engine", line2: "codex" });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/labels.test.ts`
Expected: FAIL, cannot find module `./labels.js`.

- [ ] **Step 3: Write labels**

`src/herdr-deck/labels.ts`:

```ts
import { approxWidth } from "../icons/text.js";
import { TOP_FONT, VIEWPORT_W } from "../icons/theme.js";
import type { DeckAgent } from "./model.js";

export interface KeyLines {
  top: string;
  line1: string;
  line2: string;
}

/** Tab names herdr or the owner's standard layout gave, not words he typed
 *  for this tab. The same list the sidebar config hides. */
const DEFAULT_TABS = new Set(["agents", "claude", "codex", "shell"]);

export const typedTab = (tab: string): string => (tab === "" || /^\d+$/.test(tab) || DEFAULT_TABS.has(tab.toLowerCase()) ? "" : tab);

const fitsTop = (text: string): boolean => approxWidth(text, TOP_FONT) <= VIEWPORT_W;

/** The project name on the top line: whole when it fits, otherwise cut at the
 *  last hyphen or space that still fits, the remainder going below. A name
 *  with no usable break stays whole and the renderer scrolls it. */
export function splitProject(name: string): { top: string; rest: string } {
  if (fitsTop(name)) return { top: name, rest: "" };
  let cut = -1;
  for (let i = 1; i < name.length - 1; i++) {
    if ((name[i] === "-" || name[i] === " ") && fitsTop(name.slice(0, i))) cut = i;
  }
  return cut < 0 ? { top: name, rest: "" } : { top: name.slice(0, cut), rest: name.slice(cut + 1) };
}

const paneNumber = (paneId: string): number => Number(paneId.split(":p")[1]) || 0;

/** The second word, for agents that share a project name and for no others:
 *  the tab name when every one of them sits in a tab he named and the names
 *  differ; else the agent kind when the kinds differ; else the typed tab or
 *  the kind per agent, numbered in pane order where that still repeats. */
export function secondWords(agents: readonly DeckAgent[]): Map<string, string> {
  const groups = new Map<string, DeckAgent[]>();
  for (const a of agents) groups.set(a.workspace, [...(groups.get(a.workspace) ?? []), a]);
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const tellsApart = (word: (a: DeckAgent) => string): boolean =>
      group.every((a) => word(a) !== "") && new Set(group.map(word)).size === group.length;
    const byTab = (a: DeckAgent): string => typedTab(a.tab);
    const byKind = (a: DeckAgent): string => a.kind;
    const word = tellsApart(byTab) ? byTab : tellsApart(byKind) ? byKind : (a: DeckAgent): string => byTab(a) || byKind(a);
    const seen = new Map<string, number>();
    const inPaneOrder = [...group].sort((a, b) => paneNumber(a.paneId) - paneNumber(b.paneId) || a.paneId.localeCompare(b.paneId));
    const words = new Map<string, string>();
    for (const a of inPaneOrder) {
      const w = word(a);
      const n = (seen.get(w) ?? 0) + 1;
      seen.set(w, n);
      words.set(a.paneId, n === 1 ? w : `${w} ${n}`);
    }
    for (const a of group) out.set(a.paneId, words.get(a.paneId) ?? "");
  }
  return out;
}

export function keyLines(agent: DeckAgent, word: string): KeyLines {
  const { top, rest } = splitProject(agent.workspace);
  if (rest && word) return { top, line1: rest, line2: word };
  return { top, line1: rest || word, line2: "" };
}
```

- [ ] **Step 4: Run the test and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/labels.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 10 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/herdr-deck/labels.ts src/herdr-deck/labels.test.ts
git commit -m "Put the project name on a key's top line and a second word only where two agents share a project"
```

---
### Task 6: Which animal an agent has

**Files:**
- Create: `src/herdr-deck/mascot-pool.ts`
- Test: `src/herdr-deck/mascot-pool.test.ts`

**Interfaces:**
- Consumes: `DeckAgent`.
- Produces:
  - `MascotEntry { index: number; sessionId: string }`, `type MascotMemory = Record<string, MascotEntry>` (keyed by pane id; `index` is 0-based into `MASCOTS`)
  - `assignMascots(memory: MascotMemory, ranked: readonly DeckAgent[], shownCount: number, poolSize: number): MascotMemory`
  - `sameMemory(a: MascotMemory, b: MascotMemory): boolean`
  - `loadMemory(path: string): MascotMemory`, `saveMemory(path: string, memory: MascotMemory): void`

Rules: an agent keeps its animal for as long as its pane lives. A new agent that has a key takes the lowest free animal. When every animal is taken, a newcomer with a key takes the animal of the lowest-ranked agent that has no key. With at least as many animals as keys, no two keys ever show the same animal.

- [ ] **Step 1: Write the failing test**

`src/herdr-deck/mascot-pool.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { assignMascots, loadMemory, sameMemory, saveMemory, type MascotMemory } from "./mascot-pool.js";

const agents = (...ids: string[]) => ids.map((paneId) => deckAgent({ paneId }));
const indexOf = (m: MascotMemory, paneId: string): number | undefined => m[paneId]?.index;

test("the first agents take the first animals, in rank order", () => {
  const m = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  assert.deepEqual([indexOf(m, "wA:p1"), indexOf(m, "wB:p1"), indexOf(m, "wC:p1")], [0, 1, 2]);
});

test("an agent keeps its animal when the ranking changes", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  const second = assignMascots(first, agents("wC:p1", "wA:p1", "wB:p1"), 28, 28);
  assert.ok(sameMemory(first, second));
});

test("a closed agent frees its animal and the next newcomer takes the lowest free one", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 28, 28);
  const second = assignMascots(first, agents("wA:p1", "wC:p1", "wD:p1"), 28, 28);
  assert.equal(indexOf(second, "wB:p1"), undefined);
  assert.equal(indexOf(second, "wD:p1"), 1);
  assert.equal(indexOf(second, "wC:p1"), 2);
});

test("an agent without a key gets no animal until it has one", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 2, 28);
  assert.equal(indexOf(first, "wC:p1"), undefined);
  const second = assignMascots(first, agents("wC:p1", "wA:p1", "wB:p1"), 2, 28);
  assert.equal(indexOf(second, "wC:p1"), 2);
  assert.equal(indexOf(second, "wB:p1"), 1, "an agent that lost its key keeps its animal while there are spares");
});

test("with every animal taken, a newcomer with a key takes one from the lowest agent without a key", () => {
  const first = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1"), 3, 3);
  const second = assignMascots(first, agents("wD:p1", "wA:p1", "wB:p1", "wC:p1"), 3, 3);
  assert.equal(indexOf(second, "wD:p1"), 2, "takes wC's animal");
  assert.equal(indexOf(second, "wC:p1"), undefined);
});

test("28 keys over 40 agents and 28 animals never show an animal twice", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `w${i}:p1`);
  let memory = assignMascots({}, agents(...ids), 28, 28);
  for (let round = 0; round < 20; round++) {
    ids.push(ids.shift()!, ids.shift()!, ids.shift()!);
    memory = assignMascots(memory, agents(...ids), 28, 28);
    const shown = ids.slice(0, 28).map((id) => indexOf(memory, id));
    assert.ok(shown.every((i) => i !== undefined && i >= 0 && i < 28), `round ${round}: every key has an animal`);
    assert.equal(new Set(shown).size, 28, `round ${round}: no animal twice`);
  }
});

test("more keys than animals repeats animals rather than leaving a key bare", () => {
  const m = assignMascots({}, agents("wA:p1", "wB:p1", "wC:p1", "wD:p1", "wE:p1"), 5, 2);
  assert.deepEqual(["wA:p1", "wB:p1", "wC:p1", "wD:p1", "wE:p1"].map((id) => indexOf(m, id)), [0, 1, 0, 1, 0]);
});

test("a pane id that changed is recognised by its session id", () => {
  const before: MascotMemory = { "w3:p1": { index: 5, sessionId: "s-abc" } };
  const after = assignMascots(before, [deckAgent({ paneId: "w9:p4", sessionId: "s-abc" }), deckAgent({ paneId: "w9:p5", sessionId: "s-new" })], 28, 28);
  assert.equal(indexOf(after, "w9:p4"), 5);
  assert.equal(indexOf(after, "w9:p5"), 0);
  assert.equal(indexOf(after, "w3:p1"), undefined);
});

test("a remembered animal that no longer exists is dropped", () => {
  const m = assignMascots({ "wA:p1": { index: 27, sessionId: "s" } }, agents("wA:p1"), 28, 8);
  assert.equal(indexOf(m, "wA:p1"), 0);
});

test("memory survives a save and a load, and a broken file reads as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "hd-"));
  const path = join(dir, "nested", "state.json");
  const memory: MascotMemory = { "wA:p1": { index: 3, sessionId: "s1" }, "wB:p1": { index: 0, sessionId: "" } };
  saveMemory(path, memory);
  assert.ok(sameMemory(loadMemory(path), memory));
  writeFileSync(path, "{ not json");
  assert.deepEqual(loadMemory(path), {});
  assert.deepEqual(loadMemory(join(dir, "missing.json")), {});
  writeFileSync(path, JSON.stringify({ version: 1, mascots: { a: { index: 1, sessionId: "x" }, b: { index: 1, sessionId: "y" }, c: { index: -2, sessionId: "z" }, d: "junk" } }));
  assert.deepEqual(loadMemory(path), { a: { index: 1, sessionId: "x" } }, "a repeated animal, a negative index and junk are dropped");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/mascot-pool.test.ts`
Expected: FAIL, cannot find module `./mascot-pool.js`.

- [ ] **Step 3: Write the pool**

`src/herdr-deck/mascot-pool.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DeckAgent } from "./model.js";

export interface MascotEntry {
  /** 0-based position in the MASCOTS roster. */
  index: number;
  /** The agent's session when the animal was given; finds the agent again if herdr renumbers its pane. */
  sessionId: string;
}
/** Which pane has which animal. */
export type MascotMemory = Record<string, MascotEntry>;

/** Give every agent that has a key an animal no other key shows. `ranked` is
 *  every live agent in deck order; the first `shownCount` have keys. */
export function assignMascots(
  memory: MascotMemory,
  ranked: readonly DeckAgent[],
  shownCount: number,
  poolSize: number,
): MascotMemory {
  const next: MascotMemory = {};
  const used = new Set<number>();
  const give = (a: DeckAgent, index: number): void => {
    next[a.paneId] = { index, sessionId: a.sessionId };
    used.add(index);
  };
  const usable = (e: MascotEntry | undefined): e is MascotEntry =>
    e !== undefined && Number.isInteger(e.index) && e.index >= 0 && e.index < poolSize && !used.has(e.index);

  // The same pane keeps its animal.
  for (const a of ranked) {
    const e = memory[a.paneId];
    if (usable(e)) give(a, e.index);
  }
  // A pane herdr renumbered (it restarted) is the same agent if its session is.
  const live = new Set(ranked.map((a) => a.paneId));
  const orphans = Object.entries(memory).filter(([paneId]) => !live.has(paneId));
  for (const a of ranked) {
    if (next[a.paneId] || !a.sessionId) continue;
    const hit = orphans.find(([, e]) => e.sessionId === a.sessionId && usable(e));
    if (hit) give(a, hit[1].index);
  }
  // Every agent with a key and no animal takes a free one, or the animal of
  // the lowest agent without a key.
  for (const a of ranked.slice(0, shownCount)) {
    if (next[a.paneId]) continue;
    let index = -1;
    for (let i = 0; i < poolSize; i++) {
      if (!used.has(i)) {
        index = i;
        break;
      }
    }
    for (let r = ranked.length - 1; index < 0 && r >= shownCount; r--) {
      const donor = next[ranked[r].paneId];
      if (donor) {
        index = donor.index;
        delete next[ranked[r].paneId];
      }
    }
    // More keys than animals: repeat the least used rather than draw nothing.
    if (index < 0) index = leastUsed(next, poolSize);
    give(a, index);
  }
  return next;
}

function leastUsed(memory: MascotMemory, poolSize: number): number {
  const counts = new Array<number>(Math.max(1, poolSize)).fill(0);
  for (const e of Object.values(memory)) counts[e.index] = (counts[e.index] ?? 0) + 1;
  return counts.indexOf(Math.min(...counts));
}

export function sameMemory(a: MascotMemory, b: MascotMemory): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => b[k] !== undefined && b[k].index === a[k].index && b[k].sessionId === a[k].sessionId)
  );
}

/** Read the state file. A missing or damaged file is an empty memory: the
 *  worst case is that agents draw new animals once. */
export function loadMemory(path: string): MascotMemory {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  const mascots = (raw as { mascots?: unknown } | null)?.mascots;
  if (typeof mascots !== "object" || mascots === null) return {};
  const out: MascotMemory = {};
  const used = new Set<number>();
  for (const [paneId, value] of Object.entries(mascots as Record<string, unknown>)) {
    const e = value as Partial<MascotEntry> | null;
    if (typeof e !== "object" || e === null) continue;
    if (!Number.isInteger(e.index) || (e.index as number) < 0 || used.has(e.index as number)) continue;
    used.add(e.index as number);
    out[paneId] = { index: e.index as number, sessionId: typeof e.sessionId === "string" ? e.sessionId : "" };
  }
  return out;
}

/** Write through a temporary file, so a crash mid-write cannot leave half a file. */
export function saveMemory(path: string, memory: MascotMemory): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, mascots: memory }, null, 2)}\n`);
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run the test and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/mascot-pool.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 10 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/herdr-deck/mascot-pool.ts src/herdr-deck/mascot-pool.test.ts
git commit -m "Gave each agent its own animal for the life of its pane"
```

---

### Task 7: Pages, key views and the tracker

**Files:**
- Create: `src/herdr-deck/deck-view.ts`, `src/herdr-deck/tracker.ts`
- Test: `src/herdr-deck/deck-view.test.ts`, `src/herdr-deck/tracker.test.ts`

**Interfaces:**
- Consumes: Tasks 3 to 6; `SessionState` from `src/icons/index.ts` (its members used here: `"working"`, `"awaiting"`, `"idle"`).
- Produces:
  - `MAX_PAGES = 2`, `FLASH_MS = 60_000`
  - `AgentKeyView { kind: "agent"; paneId: string; state: SessionState; slot: number; lines: KeyLines; attention: boolean; awaitingReply: boolean }`, `type KeyView = AgentKeyView | { kind: "empty" }`
  - `PagerView { page: number; pages: number; more: number; alert: boolean; offline: boolean }`, `DeckView { keys: KeyView[]; pager: PagerView }`
  - `composeDeck(input: { ranked; page; perPage; mascots; words; doneSince; now; offline }): DeckView`
  - `OFFLINE_GRACE_MS = 3000`, `TrackerDeps { read; now; poolSize; memory; saveMemory; log }`, `DeckTracker { poll(perPage): Promise<DeckView>; flipPage(perPage): DeckView; pressed(keyIndex): string | undefined; view(): DeckView }`, `createDeckTracker(deps: TrackerDeps): DeckTracker`

`perPage` is the number of agent keys on the deck (14 with the planned layout); the functions take it as a number so a different layout needs no code change.

- [ ] **Step 1: Write the failing deck-view test**

`src/herdr-deck/deck-view.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDeck, FLASH_MS, type AgentKeyView } from "./deck-view.js";
import { deckAgent } from "./fixtures.js";
import type { DeckAgent } from "./model.js";

const many = (n: number, over: Partial<DeckAgent> = {}): DeckAgent[] =>
  Array.from({ length: n }, (_, i) => deckAgent({ paneId: `w${i + 1}:p1`, workspace: `proj${i + 1}`, ...over }));

const compose = (ranked: DeckAgent[], page = 1, extra: Partial<Parameters<typeof composeDeck>[0]> = {}) =>
  composeDeck({ ranked, page, perPage: 14, mascots: {}, words: new Map(), doneSince: new Map(), now: 100_000, offline: false, ...extra });

const agentKeys = (keys: ReturnType<typeof compose>["keys"]): AgentKeyView[] => keys.filter((k): k is AgentKeyView => k.kind === "agent");

test("three agents fill three keys and leave eleven empty", () => {
  const v = compose(many(3));
  assert.equal(v.keys.length, 14);
  assert.deepEqual(agentKeys(v.keys).map((k) => k.paneId), ["w1:p1", "w2:p1", "w3:p1"]);
  assert.deepEqual(v.pager, { page: 1, pages: 1, more: 0, alert: false, offline: false });
});

test("nineteen agents: fourteen on page 1, five on page 2", () => {
  const ranked = many(19);
  const p1 = compose(ranked, 1);
  assert.equal(agentKeys(p1.keys).length, 14);
  assert.deepEqual(p1.pager, { page: 1, pages: 2, more: 5, alert: false, offline: false });
  const p2 = compose(ranked, 2);
  assert.deepEqual(agentKeys(p2.keys).map((k) => k.paneId), ["w15:p1", "w16:p1", "w17:p1", "w18:p1", "w19:p1"]);
  assert.equal(p2.keys.length, 14);
  assert.deepEqual(p2.pager, { page: 2, pages: 2, more: 0, alert: false, offline: false });
});

test("beyond 28 agents the second page says how many have no key", () => {
  assert.equal(compose(many(40), 1).pager.more, 26);
  assert.equal(compose(many(40), 2).pager.more, 12);
});

test("page 2 falls back to page 1 when the agents fit on one page", () => {
  assert.equal(compose(many(14), 2).pager.page, 1);
  assert.equal(compose(many(3), 7).pager.page, 1);
  assert.equal(compose(many(19), 0).pager.page, 1);
});

test("each status maps to the old deck's look, the same for every kind of agent", () => {
  for (const kind of ["claude", "codex"]) {
    const ranked = [
      deckAgent({ paneId: "wA:p1", status: "blocked", kind }),
      deckAgent({ paneId: "wB:p1", status: "working", kind }),
      deckAgent({ paneId: "wC:p1", status: "done", kind }),
      deckAgent({ paneId: "wD:p1", status: "idle", kind }),
      deckAgent({ paneId: "wE:p1", status: "unknown", kind }),
    ];
    const keys = agentKeys(compose(ranked).keys);
    assert.deepEqual(keys.map((k) => [k.state, k.attention, k.awaitingReply]), [
      ["awaiting", false, false],
      ["working", false, false],
      ["idle", false, true],
      ["idle", false, false],
      ["idle", false, false],
    ], kind);
  }
});

test("a finished agent flashes for FLASH_MS after the deck saw it finish, then keeps the dot", () => {
  const ranked = [deckAgent({ paneId: "wA:p1", status: "done" })];
  const at = (now: number) => agentKeys(compose(ranked, 1, { doneSince: new Map([["wA:p1", 100_000]]), now }).keys)[0];
  assert.deepEqual([at(100_000).attention, at(100_000).awaitingReply], [true, true]);
  assert.equal(at(100_000 + FLASH_MS - 1).attention, true);
  assert.deepEqual([at(100_000 + FLASH_MS).attention, at(100_000 + FLASH_MS).awaitingReply], [false, true]);
});

test("the arrow key warns when an agent that needs him is on the other page", () => {
  const ranked = [deckAgent({ paneId: "wB:p1", status: "blocked" }), ...many(18)];
  assert.equal(compose(ranked, 1).pager.alert, false);
  assert.equal(compose(ranked, 2).pager.alert, true);
});

test("a key carries its agent's animal and words", () => {
  const ranked = [deckAgent({ paneId: "wA:p1", workspace: "hive-2.0" }), deckAgent({ paneId: "wB:p1", workspace: "git" })];
  const keys = agentKeys(compose(ranked, 1, { mascots: { "wA:p1": { index: 12, sessionId: "" } }, words: new Map([["wA:p1", "codex"]]) }).keys);
  assert.equal(keys[0].slot, 13);
  assert.deepEqual(keys[0].lines, { top: "hive-2.0", line1: "codex", line2: "" });
  assert.equal(keys[1].slot, 1, "an agent with no animal yet draws the first one rather than nothing");
});

test("no agent keys on the deck means nothing to draw", () => {
  const v = composeDeck({ ranked: many(5), page: 1, perPage: 0, mascots: {}, words: new Map(), doneSince: new Map(), now: 0, offline: false });
  assert.deepEqual(v.keys, []);
  assert.equal(v.pager.pages, 1);
});

test("offline is passed through to the arrow key", () => {
  assert.equal(compose([], 1, { offline: true }).pager.offline, true);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/deck-view.test.ts`
Expected: FAIL, cannot find module `./deck-view.js`.

- [ ] **Step 3: Write deck-view**

`src/herdr-deck/deck-view.ts`:

```ts
import type { SessionState } from "../icons/index.js";
import { keyLines, type KeyLines } from "./labels.js";
import type { MascotMemory } from "./mascot-pool.js";
import type { DeckAgent } from "./model.js";

export const MAX_PAGES = 2;
/** How long a finished agent flashes before it settles to the white dot. */
export const FLASH_MS = 60_000;

export interface AgentKeyView {
  kind: "agent";
  paneId: string;
  /** The old deck's look: the mascot walks ("working"), rests ("idle"), or the key pulses ("awaiting"). */
  state: SessionState;
  /** 1-based animal, as `renderIcon` counts. */
  slot: number;
  lines: KeyLines;
  /** Flash: finished within the last FLASH_MS. */
  attention: boolean;
  /** White corner dot: finished and not yet looked at. */
  awaitingReply: boolean;
}
export type KeyView = AgentKeyView | { kind: "empty" };

export interface PagerView {
  page: number;
  pages: number;
  /** Agents that have no key on this page: on page 1 those further down, on page 2 those beyond both pages. */
  more: number;
  /** An agent that needs him is not on the page showing. */
  alert: boolean;
  /** herdr cannot be reached. */
  offline: boolean;
}

export interface DeckView {
  /** One entry per agent key, in key order. */
  keys: KeyView[];
  pager: PagerView;
}

export function composeDeck(input: {
  ranked: readonly DeckAgent[];
  page: number;
  /** Agent keys on the deck. */
  perPage: number;
  mascots: MascotMemory;
  words: ReadonlyMap<string, string>;
  /** When the deck saw each finished agent finish. */
  doneSince: ReadonlyMap<string, number>;
  now: number;
  offline: boolean;
}): DeckView {
  const { ranked, perPage, mascots, words, doneSince, now, offline } = input;
  const shown = ranked.slice(0, perPage * MAX_PAGES);
  const pages = perPage > 0 && shown.length > perPage ? MAX_PAGES : 1;
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), pages);
  const start = (page - 1) * perPage;
  const onPage = shown.slice(start, start + perPage);

  const keys: KeyView[] = onPage.map((a) => {
    const done = a.status === "done";
    const since = doneSince.get(a.paneId);
    return {
      kind: "agent",
      paneId: a.paneId,
      state: a.status === "working" ? "working" : a.status === "blocked" ? "awaiting" : "idle",
      slot: (mascots[a.paneId]?.index ?? 0) + 1,
      lines: keyLines(a, words.get(a.paneId) ?? ""),
      attention: done && since !== undefined && now - since < FLASH_MS,
      awaitingReply: done,
    };
  });
  while (keys.length < perPage) keys.push({ kind: "empty" });

  const visible = new Set(onPage.map((a) => a.paneId));
  return {
    keys,
    pager: {
      page,
      pages,
      more: Math.max(0, ranked.length - page * perPage),
      alert: ranked.some((a) => a.status === "blocked" && !visible.has(a.paneId)),
      offline,
    },
  };
}
```

- [ ] **Step 4: Run the deck-view test**

Run: `node_modules/.bin/tsx --test src/herdr-deck/deck-view.test.ts`
Expected: 10 tests pass.

- [ ] **Step 5: Write the failing tracker test**

`src/herdr-deck/tracker.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { FLASH_MS, type AgentKeyView, type DeckView } from "./deck-view.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import type { RawAgent, RawSnapshot } from "./herdr-client.js";
import type { MascotMemory } from "./mascot-pool.js";
import { PRESS_GRACE_MS } from "./press.js";
import { HOLD_MS } from "./settle.js";
import { createDeckTracker, OFFLINE_GRACE_MS } from "./tracker.js";

/** A tracker fed by a script: `set` what herdr holds (or an error), move the clock, poll. */
function harness(memory: MascotMemory = {}) {
  let current: RawSnapshot | Error = rawSnapshot([]);
  let clock = 1_000_000;
  const saves: MascotMemory[] = [];
  const logs: string[] = [];
  const tracker = createDeckTracker({
    read: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
    now: () => clock,
    poolSize: 28,
    memory,
    saveMemory: (m) => saves.push(m),
    log: (line) => logs.push(line),
  });
  return {
    tracker,
    saves,
    logs,
    set: (agents: RawAgent[] | Error) => {
      current = agents instanceof Error ? agents : rawSnapshot(agents);
    },
    advance: (ms: number) => {
      clock += ms;
    },
    poll: () => tracker.poll(14),
  };
}

const key = (v: DeckView, i: number): AgentKeyView => {
  const k = v.keys[i];
  assert.equal(k.kind, "agent", `key ${i} holds an agent`);
  return k as AgentKeyView;
};
const panes = (v: DeckView): string[] => v.keys.filter((k): k is AgentKeyView => k.kind === "agent").map((k) => k.paneId);

test("agents appear ranked, the working one first", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "idle", state_change_seq: 5 }), rawAgent({ pane_id: "wB:p1", agent_status: "working", state_change_seq: 3 })]);
  assert.deepEqual(panes(await h.poll()), ["wB:p1", "wA:p1"]);
});

test("a 2 s finished blip moves no key and changes no key's look", async () => {
  const h = harness();
  const other = rawAgent({ pane_id: "wB:p1", agent_status: "working", state_change_seq: 160 });
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 170 }), other]);
  const before = await h.poll();
  h.advance(1000);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 177 }), other]);
  const during = await h.poll();
  h.advance(2000);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 178 }), other]);
  const after = await h.poll();
  for (const v of [during, after]) {
    assert.deepEqual(panes(v), panes(before));
    assert.equal(key(v, 0).state, "working");
    assert.equal(key(v, 0).attention, false);
  }
});

test("a finished agent flashes from the moment the deck believes it, then keeps the dot until seen", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 10 })]);
  await h.poll();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 20 })]);
  await h.poll();
  h.advance(HOLD_MS);
  const believed = await h.poll();
  assert.deepEqual([key(believed, 0).state, key(believed, 0).attention, key(believed, 0).awaitingReply], ["idle", true, true]);
  h.advance(FLASH_MS);
  const settled = await h.poll();
  assert.deepEqual([key(settled, 0).attention, key(settled, 0).awaitingReply], [false, true]);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "idle", state_change_seq: 20 })]);
  const seen = await h.poll();
  assert.deepEqual([key(seen, 0).attention, key(seen, 0).awaitingReply], [false, false]);
});

test("an agent already finished when the deck starts shows the dot without a flash", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "done", state_change_seq: 20 })]);
  const v = await h.poll();
  assert.deepEqual([key(v, 0).attention, key(v, 0).awaitingReply], [false, true]);
});

test("an agent keeps its animal when it moves to another key", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "idle", state_change_seq: 5 })]);
  const first = await h.poll();
  const animalOfB = key(first, 1).slot;
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "blocked", state_change_seq: 12 })]);
  const second = await h.poll();
  assert.equal(key(second, 0).paneId, "wB:p1");
  assert.equal(key(second, 0).slot, animalOfB);
});

test("the animal memory is saved when it changes and not otherwise", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  await h.poll();
  assert.equal(h.saves.length, 1);
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  await h.poll();
  assert.equal(h.saves.length, 2);
});

test("a remembered animal is used again after a restart", async () => {
  const h = harness({ "wA:p1": { index: 20, sessionId: "session-wA:p1" } });
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  assert.equal(key(await h.poll(), 0).slot, 21);
});

test("the arrow key flips to page 2 and a press there means the agent on that page", async () => {
  const h = harness();
  h.set(Array.from({ length: 19 }, (_, i) => rawAgent({ pane_id: `w${i + 1}:p1`, state_change_seq: 100 - i })));
  await h.poll();
  assert.equal(h.tracker.pressed(0), "w1:p1");
  const p2 = h.tracker.flipPage(14);
  assert.equal(p2.pager.page, 2);
  assert.equal(h.tracker.pressed(0), "w15:p1", "no stale agent from page 1, even at once after the flip");
  assert.equal(h.tracker.pressed(5), undefined, "an empty key means nothing");
  assert.equal(h.tracker.flipPage(14).pager.page, 1);
});

test("with one page the arrow key does nothing", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  assert.equal(h.tracker.flipPage(14).pager.page, 1);
});

test("a press just after a re-sort means the agent the key showed before", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "idle", state_change_seq: 5 })]);
  await h.poll();
  h.advance(10_000);
  h.set([rawAgent({ pane_id: "wA:p1", agent_status: "working", state_change_seq: 9 }), rawAgent({ pane_id: "wB:p1", agent_status: "blocked", state_change_seq: 12 })]);
  await h.poll();
  h.advance(PRESS_GRACE_MS - 1);
  assert.equal(h.tracker.pressed(0), "wA:p1");
  h.advance(1);
  assert.equal(h.tracker.pressed(0), "wB:p1");
});

test("one failed read keeps the deck as it was; a herdr that stays away blanks it and says so", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  await h.poll();
  h.set(new Error("timeout"));
  h.advance(500);
  assert.deepEqual(panes(await h.poll()), ["wA:p1"]);
  h.advance(OFFLINE_GRACE_MS);
  const gone = await h.poll();
  assert.deepEqual(panes(gone), []);
  assert.equal(gone.pager.offline, true);
  assert.equal(h.logs.filter((l) => l.startsWith("herdr unreachable")).length, 1);
  await h.poll();
  assert.equal(h.logs.filter((l) => l.startsWith("herdr unreachable")).length, 1, "said once, not every tick");
  h.set([rawAgent({ pane_id: "wA:p1" })]);
  const back = await h.poll();
  assert.deepEqual(panes(back), ["wA:p1"]);
  assert.equal(back.pager.offline, false);
  assert.ok(h.logs.includes("herdr reachable"));
});

test("a herdr that is not running when the deck starts is offline at once", async () => {
  const h = harness();
  h.set(new Error("ENOENT"));
  assert.equal((await h.poll()).pager.offline, true);
});

test("the animal memory is not wiped while herdr is away", async () => {
  const h = harness();
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  const before = key(await h.poll(), 1).slot;
  h.set(new Error("ECONNREFUSED"));
  h.advance(OFFLINE_GRACE_MS + 1);
  await h.poll();
  h.set([rawAgent({ pane_id: "wA:p1" }), rawAgent({ pane_id: "wB:p1" })]);
  assert.equal(key(await h.poll(), 1).slot, before);
  assert.equal(h.saves.length, 1);
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/tracker.test.ts`
Expected: FAIL, cannot find module `./tracker.js`.

- [ ] **Step 7: Write the tracker**

`src/herdr-deck/tracker.ts`:

```ts
import { composeDeck, MAX_PAGES, type DeckView } from "./deck-view.js";
import type { RawSnapshot } from "./herdr-client.js";
import { secondWords } from "./labels.js";
import { assignMascots, sameMemory, type MascotMemory } from "./mascot-pool.js";
import { toDeckAgents, type DeckAgent } from "./model.js";
import { rebind, resolvePress, type Binding } from "./press.js";
import { rankAgents } from "./rank.js";
import { settle, type SettleState } from "./settle.js";

/** A single slow or failed read must not blank the deck; herdr away for
 *  longer than this does. */
export const OFFLINE_GRACE_MS = 3000;

export interface TrackerDeps {
  read: () => Promise<RawSnapshot>;
  now: () => number;
  /** How many animals exist. */
  poolSize: number;
  /** The animal memory loaded at start. */
  memory: MascotMemory;
  saveMemory: (memory: MascotMemory) => void;
  log: (line: string) => void;
}

export interface DeckTracker {
  /** Read herdr and return what the keys should show. `perPage` = agent keys on the deck. */
  poll(perPage: number): Promise<DeckView>;
  /** The arrow key: switch between the two pages (a no-op with one page). */
  flipPage(perPage: number): DeckView;
  /** The agent a press on agent key `keyIndex` (0-based, in key order) means. */
  pressed(keyIndex: number): string | undefined;
  /** The last view, for redrawing animation frames between polls. */
  view(): DeckView;
}

/** The state that outlives one poll: the settle hold, when agents finished,
 *  which animal each has, the page showing, and what each key shows. */
export function createDeckTracker(deps: TrackerDeps): DeckTracker {
  let settleState: SettleState = new Map();
  const doneSince = new Map<string, number>();
  let memory = deps.memory;
  let ranked: DeckAgent[] = [];
  let page = 1;
  let offline = false;
  let lastGoodAt = 0;
  let bindings: Array<Binding | undefined> = [];
  let current: DeckView = { keys: [], pager: { page: 1, pages: 1, more: 0, alert: false, offline: false } };

  function compose(perPage: number, now: number): DeckView {
    current = composeDeck({ ranked, page, perPage, mascots: memory, words: secondWords(ranked), doneSince, now, offline });
    page = current.pager.page;
    bindings = current.keys.map((k, i) => rebind(bindings[i], k.kind === "agent" ? k.paneId : undefined, now));
    return current;
  }

  async function poll(perPage: number): Promise<DeckView> {
    const now = deps.now();
    let raw: RawSnapshot;
    try {
      raw = await deps.read();
    } catch (err) {
      if (!offline && now - lastGoodAt < OFFLINE_GRACE_MS) return current;
      if (!offline) deps.log(`herdr unreachable: ${err instanceof Error ? err.message : String(err)}`);
      offline = true;
      ranked = [];
      settleState = new Map();
      doneSince.clear();
      return compose(perPage, now);
    }
    if (offline) deps.log("herdr reachable");
    offline = false;
    lastGoodAt = now;

    const settled = settle(settleState, toDeckAgents(raw), now);
    for (const a of settled.agents) {
      const before = settleState.get(a.paneId)?.shown;
      if (a.status !== "done") doneSince.delete(a.paneId);
      // Only a finish the deck watched happen flashes; one it found already finished shows the dot alone.
      else if (before !== undefined && before !== "done") doneSince.set(a.paneId, now);
    }
    for (const paneId of [...doneSince.keys()]) if (!settled.state.has(paneId)) doneSince.delete(paneId);
    settleState = settled.state;
    ranked = rankAgents(settled.agents);

    const next = assignMascots(memory, ranked, perPage * MAX_PAGES, deps.poolSize);
    if (!sameMemory(next, memory)) {
      memory = next;
      deps.saveMemory(next);
    }
    return compose(perPage, now);
  }

  function flipPage(perPage: number): DeckView {
    page = page === 1 ? 2 : 1;
    // A new page is a new set of keys: no key has a "what it showed before".
    bindings = [];
    return compose(perPage, deps.now());
  }

  return {
    poll,
    flipPage,
    pressed: (keyIndex) => resolvePress(bindings[keyIndex], deps.now()),
    view: () => current,
  };
}
```

- [ ] **Step 8: Run both tests and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/deck-view.test.ts src/herdr-deck/tracker.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 23 tests pass; `tsc` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add src/herdr-deck/deck-view.ts src/herdr-deck/tracker.ts src/herdr-deck/deck-view.test.ts src/herdr-deck/tracker.test.ts
git commit -m "Composed two pages of agent keys and tracked what outlives one poll"
```

---

### Task 8: The jump

A press does two things: tells herdr to show the agent, and brings the Ghostty terminal that shows herdr to the front.

**Files:**
- Create: `src/herdr-deck/jump.ts`
- Test: `src/herdr-deck/jump.test.ts`

**Interfaces:**
- Consumes: `focusAgent`, `HerdrError` (Task 3); `spawnCapture` from `src/spawn-capture.ts` (imports only `node:child_process`).
- Produces:
  - `clientTtys(psOutput: string): string[]` (device paths of every tty that runs a process named `herdr`)
  - `raiseScript(ttys: readonly string[]): string` (AppleScript source)
  - `type JumpResult = "jumped" | "gone" | "failed"`
  - `jumpTo(socketPath: string, paneId: string, log: (line: string) => void): Promise<JumpResult>`

How the right terminal is found: Ghostty's terminal title follows the focused workspace's name, so it cannot be matched. Ghostty 1.4 reports each terminal's tty, and the herdr view is the process named `herdr` on a tty. An agent that runs `herdr pane list` inside a pane is also a `herdr` process on a tty, but that tty belongs to herdr's own pane, which Ghostty does not list, so it never matches.

- [ ] **Step 1: Write the failing test**

`src/herdr-deck/jump.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFakeHerdr } from "./fake-herdr.js";
import { rawAgent, rawSnapshot } from "./fixtures.js";
import { clientTtys, jumpTo, raiseScript } from "./jump.js";

const PS = [
  "ttys000  herdr",
  "??       herdr",
  "ttys014  herdr",
  "ttys003  zsh",
  "??       Google Chrome He",
  "ttys021  herdr-helper",
  "",
].join("\n");

test("every tty that runs herdr is a candidate, the server's missing tty is not", () => {
  assert.deepEqual(clientTtys(PS), ["/dev/ttys000", "/dev/ttys014"]);
});

test("no herdr on a tty means no candidates", () => {
  assert.deepEqual(clientTtys("??       herdr\nttys003  zsh\n"), []);
});

test("the script focuses the Ghostty terminal on one of the candidate ttys", () => {
  const script = raiseScript(["/dev/ttys000", "/dev/ttys014"]);
  assert.match(script, /application id "com\.mitchellh\.ghostty"/);
  assert.match(script, /\{"\/dev\/ttys000", "\/dev\/ttys014"\}/);
  assert.match(script, /focus t/);
  assert.match(script, /activate/);
});

test("an agent that is gone is reported as gone and nothing is raised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hd-"));
  const fake = await startFakeHerdr(join(dir, "j.sock"), rawSnapshot([rawAgent({ pane_id: "wA:p1" })]));
  const logs: string[] = [];
  try {
    assert.equal(await jumpTo(fake.socketPath, "wZ:p9", (l) => logs.push(l)), "gone");
    assert.deepEqual(fake.focusCalls, []);
  } finally {
    await fake.close();
  }
});

test("a herdr that cannot be reached is a failed jump, with the reason logged", async () => {
  const logs: string[] = [];
  assert.equal(await jumpTo(join(mkdtempSync(join(tmpdir(), "hd-")), "none.sock"), "wA:p1", (l) => logs.push(l)), "failed");
  assert.equal(logs.length, 1);
});
```

The successful path (herdr focused, Ghostty raised) is not unit-tested: it would raise the owner's Ghostty window during every test run. It is checked on the hardware in Task 11, against the fake herdr.

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/jump.test.ts`
Expected: FAIL, cannot find module `./jump.js`.

- [ ] **Step 3: Write the jump**

`src/herdr-deck/jump.ts`:

```ts
import { spawnCapture } from "../spawn-capture.js";
import { focusAgent, HerdrError } from "./herdr-client.js";

export type JumpResult = "jumped" | "gone" | "failed";

/** Device paths of every tty that runs a process named `herdr`, from
 *  `ps -axo tty=,ucomm=`. The herdr view is one of them; the server has no
 *  tty. A `herdr` command run inside a pane is listed too, on a tty Ghostty
 *  does not know, so it can never be the one that matches. */
export function clientTtys(psOutput: string): string[] {
  const out: string[] = [];
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(ttys\d+)\s+herdr\s*$/.exec(line);
    if (m && !out.includes(`/dev/${m[1]}`)) out.push(`/dev/${m[1]}`);
  }
  return out;
}

/** AppleScript that selects the tab of the Ghostty terminal on one of `ttys`
 *  and brings Ghostty forward. Matched by tty: the terminal's title follows
 *  the focused workspace's name and so identifies nothing. */
export function raiseScript(ttys: readonly string[]): string {
  const wanted = `{${ttys.map((t) => `"${t}"`).join(", ")}}`;
  return `
if not (application id "com.mitchellh.ghostty" is running) then return "ERR:not-running"
tell application id "com.mitchellh.ghostty"
  set wanted to ${wanted}
  repeat with t in terminals
    try
      if wanted contains ((tty of t) as text) then
        focus t
        activate
        return "OK"
      end if
    end try
  end repeat
  return "ERR:no-match"
end tell`;
}

/** Show the agent in herdr, then bring herdr's terminal to the front. The
 *  only caller is a key press: the focus command moves the owner's view. */
export async function jumpTo(socketPath: string, paneId: string, log: (line: string) => void): Promise<JumpResult> {
  try {
    await focusAgent(socketPath, paneId);
  } catch (err) {
    if (err instanceof HerdrError && err.code === "agent_not_found") return "gone";
    log(`jump to ${paneId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
  const ps = await spawnCapture("/bin/ps", ["-axo", "tty=,ucomm="], { timeoutMs: 2000 });
  const ttys = clientTtys(ps.stdout);
  if (ttys.length > 0) {
    const r = await spawnCapture("/usr/bin/osascript", ["-e", raiseScript(ttys)], { timeoutMs: 3000 });
    if (r.stdout.trim() === "OK") return "jumped";
    log(`could not select herdr's terminal (${r.err ?? (r.stdout.trim() || r.stderr.trim() || `exit ${r.code}`)}); bringing Ghostty forward instead`);
  } else {
    log("no herdr view found on a terminal; bringing Ghostty forward instead");
  }
  // herdr already shows the agent. Without the exact terminal, the app in front is the best left to do.
  await spawnCapture("/usr/bin/open", ["-a", "Ghostty"], { timeoutMs: 3000 });
  return "jumped";
}
```

- [ ] **Step 4: Check the `ps` columns on this machine (read-only)**

Run: `/bin/ps -axo tty=,ucomm= | grep -E '\sherdr\s*$'`
Expected: one line `ttys000  herdr` (the tty number may differ) for the view and one `??       herdr` for the server. If `ucomm` prints something else here, fix `clientTtys` and its test to the real format before going on.

- [ ] **Step 5: Run the test and the type check**

Run: `node_modules/.bin/tsx --test src/herdr-deck/jump.test.ts && node_modules/.bin/tsc --noEmit -p .`
Expected: 5 tests pass; `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/herdr-deck/jump.ts src/herdr-deck/jump.test.ts
git commit -m "Made a press show the agent in herdr and raise herdr's Ghostty terminal by its tty"
```

---

### Task 9: The plugin

**Files:**
- Create: `src/herdr-deck/key-svg.ts`, `src/herdr-deck/agent-key.ts`, `src/herdr-deck/pager-key.ts`, `src/herdr-deck/plugin.ts`
- Create: `com.eordouie.herdrdeck.sdPlugin/manifest.json`, `rollup.herdr-deck.config.mjs`, `tsconfig.herdr-deck.json`
- Create: `scripts/render-herdr-deck-pngs.mjs`, `scripts/link-herdr-deck.sh`
- Modify: `package.json` (scripts), `.gitignore`
- Test: `src/herdr-deck/key-svg.test.ts`

**Interfaces:**
- Consumes: everything above; `renderIcon`, `ANIMATION_FRAMES` from `src/icons/`; `MASCOTS` from `src/icons/motifs.ts`; `@elgato/streamdeck`.
- Produces:
  - `agentKeySvg(view: AgentKeyView, frame: number, now: number): string`, `emptyKeySvg(): string`, `pagerKeySvg(view: PagerView, frame: number): string`, `keySvg(view: KeyView, frame: number, now: number): string`, `toDataUrl(svg: string): string`
  - Actions `com.eordouie.herdrdeck.agent` (class `AgentKey`) and `com.eordouie.herdrdeck.pager` (class `PagerKey`)
  - The bundle `com.eordouie.herdrdeck.sdPlugin/bin/plugin.js`
  - Runtime files under `~/.config/herdr-deck/`: `state.json`, optional `config.json` (`{"socketPath": "..."}`), `reload`

- [ ] **Step 1: Write the failing key-svg test**

`src/herdr-deck/key-svg.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentKeyView, PagerView } from "./deck-view.js";
import { agentKeySvg, emptyKeySvg, keySvg, pagerKeySvg, toDataUrl } from "./key-svg.js";

const view = (over: Partial<AgentKeyView> = {}): AgentKeyView => ({
  kind: "agent", paneId: "wA:p1", state: "idle", slot: 1, lines: { top: "hive-2.0", line1: "codex", line2: "" }, attention: false, awaitingReply: false, ...over,
});
const pager = (over: Partial<PagerView> = {}): PagerView => ({ page: 1, pages: 2, more: 5, alert: false, offline: false, ...over });
const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test("an agent key carries its whole project name and its second word", () => {
  assert.deepEqual(texts(agentKeySvg(view(), 0, 0)), ["hive-2.0", "codex"]);
});

test("a Claude key and a Codex key with the same view are the same picture", () => {
  // The view has no kind at all: there is nothing the drawing could branch on.
  assert.equal(agentKeySvg(view({ paneId: "wA:p1" }), 3, 5000), agentKeySvg(view({ paneId: "wB:p9" }), 3, 5000));
});

test("different animals draw different pictures", () => {
  assert.notEqual(agentKeySvg(view({ slot: 1 }), 0, 0), agentKeySvg(view({ slot: 2 }), 0, 0));
});

test("an empty key has a frame and nothing to read", () => {
  assert.deepEqual(texts(emptyKeySvg()), []);
  assert.equal(keySvg({ kind: "empty" }, 0, 0), emptyKeySvg());
});

test("the arrow key says what is on the other page", () => {
  assert.deepEqual(texts(pagerKeySvg(pager(), 0)), ["+5", "1/2"]);
  assert.deepEqual(texts(pagerKeySvg(pager({ page: 2, more: 0 }), 0)), ["back", "2/2"]);
  assert.deepEqual(texts(pagerKeySvg(pager({ pages: 1, more: 0 }), 0)), []);
  assert.deepEqual(texts(pagerKeySvg(pager({ offline: true }), 0)), ["herdr", "off"]);
});

test("the arrow key pulses when an agent on the other page needs him", () => {
  assert.notEqual(pagerKeySvg(pager({ page: 2, alert: true }), 2), pagerKeySvg(pager({ page: 2, alert: true }), 5));
  assert.equal(pagerKeySvg(pager({ page: 2 }), 2), pagerKeySvg(pager({ page: 2 }), 5));
});

test("a picture travels to the deck as a base64 data URL", () => {
  const url = toDataUrl("<svg/>");
  assert.equal(url, "data:image/svg+xml;base64,PHN2Zy8+");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node_modules/.bin/tsx --test src/herdr-deck/key-svg.test.ts`
Expected: FAIL, cannot find module `./key-svg.js`.

- [ ] **Step 3: Write key-svg**

`src/herdr-deck/key-svg.ts`:

```ts
import { renderIcon } from "../icons/index.js";
import { ANIMATION_FRAMES } from "../icons/mascot-kit.js";
import { BORDER_INSET, BORDER_RADIUS, BORDER_SIZE, BORDER_STROKE } from "../icons/theme.js";
import type { AgentKeyView, KeyView, PagerView } from "./deck-view.js";

/** The old deck's empty-key colours (STATES.empty) and its needs-you accent (STATES.awaiting). */
const BG = "#0a0b0e";
const DIM = "#374151";
const INK = "#cbd5e1";
const ALERT = "#f97316";
const FONT = "-apple-system,Segoe UI,Roboto,sans-serif";

function framed(inner: string, stroke: string, opacity: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="${BG}"/>
${inner}
<rect x="${BORDER_INSET}" y="${BORDER_INSET}" width="${BORDER_SIZE}" height="${BORDER_SIZE}" rx="${BORDER_RADIUS}" fill="none" stroke="${stroke}" stroke-width="${BORDER_STROKE}" stroke-linejoin="round" opacity="${opacity}"/>
</svg>`;
}

const word = (y: number, text: string, size: number, fill: string): string =>
  `<text x="72" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="middle">${text}</text>`;

/** An agent key, drawn by the old deck's renderer. The view carries no agent
 *  kind, so a Claude key and a Codex key cannot be drawn differently. */
export function agentKeySvg(view: AgentKeyView, frame: number, now: number): string {
  return renderIcon({
    state: view.state,
    slot: view.slot,
    label: view.lines.top,
    lines: view.lines,
    frame,
    now,
    attention: view.attention,
    awaitingReply: view.awaitingReply,
  });
}

/** A key with no agent: a dim frame. It opens nothing, so it says nothing. */
export const emptyKeySvg = (): string => framed("", DIM, 0.35);

/** The arrow key. Page 1: an arrow forward, how many agents are further
 *  down, "1/2". Page 2: an arrow back. One page: a dim arrow. No herdr: "herdr off". */
export function pagerKeySvg(view: PagerView, frame: number): string {
  if (view.offline) return framed(word(68, "herdr", 19, "#6b7280") + word(92, "off", 19, "#6b7280"), DIM, 0.35);
  if (view.pages < 2) return framed(`<path d="M54 46 L100 76 L54 106 Z" fill="${DIM}" opacity="0.6"/>`, DIM, 0.35);
  const forward = view.page === 1;
  const arrow = forward ? "M54 46 L100 76 L54 106 Z" : "M90 46 L44 76 L90 106 Z";
  const top = forward ? (view.more > 0 ? `+${view.more}` : "") : "back";
  let pulse = "";
  if (view.alert) {
    const phase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    pulse = `<rect width="144" height="144" fill="${ALERT}" opacity="${(tri * 0.75).toFixed(3)}"/>`;
  }
  const inner = `${pulse}<path d="${arrow}" fill="${INK}"/>${top ? word(30, top, 19, INK) : ""}${word(132, `${view.page}/${view.pages}`, 17, INK)}`;
  return framed(inner, view.alert ? ALERT : "#64748b", 0.95);
}

export function keySvg(view: KeyView, frame: number, now: number): string {
  return view.kind === "agent" ? agentKeySvg(view, frame, now) : emptyKeySvg();
}

export const toDataUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
```

- [ ] **Step 4: Run the key-svg test**

Run: `node_modules/.bin/tsx --test src/herdr-deck/key-svg.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Write the two actions**

`src/herdr-deck/agent-key.ts`:

```ts
import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";

/** One key that shows one herdr agent. Which agent is decided by the key's
 *  place among all agent keys, top to bottom, left to right. */
@action({ UUID: "com.eordouie.herdrdeck.agent" })
export class AgentKey extends SingletonAction {
  private readonly instances = new Map<string, KeyAction>();

  constructor(
    private readonly onPress: (key: KeyAction, index: number) => void,
    private readonly onKeysChanged: () => void,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (!ev.action.isKey()) return;
    this.instances.set(ev.action.id, ev.action);
    this.onKeysChanged();
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.instances.delete(ev.action.id);
    this.onKeysChanged();
  }

  override onKeyDown(ev: KeyDownEvent): void {
    const ordered = this.ordered();
    const index = ordered.findIndex((a) => a.id === ev.action.id);
    if (index >= 0) this.onPress(ordered[index], index);
  }

  /** The agent keys on the deck in reading order. Its length is the page size. */
  ordered(): KeyAction[] {
    return [...this.instances.values()]
      .filter((a) => a.coordinates)
      .sort((a, b) => {
        const A = a.coordinates!;
        const B = b.coordinates!;
        return A.row !== B.row ? A.row - B.row : A.column - B.column;
      });
  }
}
```

`src/herdr-deck/pager-key.ts`:

```ts
import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";

/** The arrow key: flips the plugin's two pages of agents. */
@action({ UUID: "com.eordouie.herdrdeck.pager" })
export class PagerKey extends SingletonAction {
  private readonly instances = new Map<string, KeyAction>();

  constructor(
    private readonly onPress: () => void,
    private readonly onKeysChanged: () => void,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (!ev.action.isKey()) return;
    this.instances.set(ev.action.id, ev.action);
    this.onKeysChanged();
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.instances.delete(ev.action.id);
    this.onKeysChanged();
  }

  override onKeyDown(_ev: KeyDownEvent): void {
    this.onPress();
  }

  keys(): KeyAction[] {
    return [...this.instances.values()];
  }
}
```

- [ ] **Step 6: Write the entry**

`src/herdr-deck/plugin.ts`:

```ts
import streamDeck, { LogLevel, type KeyAction } from "@elgato/streamdeck";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANIMATION_FRAMES } from "../icons/mascot-kit.js";
import { MASCOTS } from "../icons/motifs.js";
import { AgentKey } from "./agent-key.js";
import type { DeckView } from "./deck-view.js";
import { DEFAULT_SOCKET, herdrCall, readSnapshot } from "./herdr-client.js";
import { jumpTo } from "./jump.js";
import { keySvg, pagerKeySvg, toDataUrl } from "./key-svg.js";
import { loadMemory, saveMemory } from "./mascot-pool.js";
import { PagerKey } from "./pager-key.js";
import { createDeckTracker } from "./tracker.js";

streamDeck.logger.setLevel(LogLevel.INFO);

/** herdr answers a snapshot in under a millisecond; twice a second keeps a key within half a second of its agent. */
const POLL_MS = 500;
/** The old deck's animation tick. */
const ANIMATION_MS = 120;
/** The herdr protocol this was built and measured against. */
const BUILT_FOR_PROTOCOL = 22;

const HOME = join(homedir(), ".config", "herdr-deck");
const STATE_FILE = join(HOME, "state.json");
const CONFIG_FILE = join(HOME, "config.json");
const RELOAD_FILE = join(HOME, "reload");

/** herdr's socket, unless `config.json` names another (a named herdr session, or the demo's stand-in). Read once at start. */
function socketPath(): string {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as { socketPath?: unknown };
    if (typeof config.socketPath === "string" && config.socketPath) return config.socketPath;
  } catch {
    // no config file, or not JSON: the default socket
  }
  return DEFAULT_SOCKET;
}
const SOCKET = socketPath();

const log = (line: string): void => {
  streamDeck.logger.info(line);
};

const tracker = createDeckTracker({
  read: () => readSnapshot(SOCKET),
  now: () => Date.now(),
  poolSize: MASCOTS.length,
  memory: loadMemory(STATE_FILE),
  saveMemory: (memory) => {
    try {
      saveMemory(STATE_FILE, memory);
    } catch (err) {
      streamDeck.logger.warn(`could not save ${STATE_FILE}: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  log,
});

/** What each key last received, by action id, so an unchanged picture is not sent again. */
const sent = new Map<string, string>();
let frame = 0;
let polling = false;
let lastPlan = "";

function push(key: KeyAction, svg: string, pending: Promise<void>[]): void {
  const url = toDataUrl(svg);
  if (sent.get(key.id) === url) return;
  pending.push(
    key.setImage(url).then(
      () => {
        sent.set(key.id, url);
      },
      (err) => {
        streamDeck.logger.error(`setImage failed for ${key.id}`, err);
      },
    ),
  );
}

async function draw(view: DeckView): Promise<void> {
  const now = Date.now();
  const pending: Promise<void>[] = [];
  agentKey.ordered().forEach((key, i) => push(key, keySvg(view.keys[i] ?? { kind: "empty" }, frame, now), pending));
  for (const key of pagerKey.keys()) push(key, pagerKeySvg(view.pager, frame), pending);
  await Promise.all(pending);
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const view = await tracker.poll(agentKey.ordered().length);
    const plan = `page ${view.pager.page}/${view.pager.pages}: ${view.keys.map((k) => (k.kind === "agent" ? `${k.paneId}=${k.state}` : "-")).join(" ")}`;
    if (plan !== lastPlan) {
      log(`keys: ${plan}`);
      lastPlan = plan;
    }
    await draw(view);
  } catch (err) {
    streamDeck.logger.error("poll failed", err);
  } finally {
    polling = false;
  }
}

/** A key that appears shows the manifest's picture until it is sent one, so every key is sent afresh. */
const keysChanged = (): void => {
  sent.clear();
  void poll();
};

const agentKey = new AgentKey((key, index) => {
  const paneId = tracker.pressed(index);
  if (!paneId) return;
  void jumpTo(SOCKET, paneId, log).then(async (result) => {
    if (result !== "jumped") await key.showAlert();
    void poll();
  });
}, keysChanged);

const pagerKey = new PagerKey(() => {
  void draw(tracker.flipPage(agentKey.ordered().length));
}, keysChanged);

streamDeck.actions.registerAction(agentKey);
streamDeck.actions.registerAction(pagerKey);
await streamDeck.connect();

setInterval(() => void poll(), POLL_MS);
setInterval(() => {
  frame = (frame + 1) % ANIMATION_FRAMES;
  // Resting mascots breathe and blink, so every agent key changes most frames.
  if (!polling) void draw(tracker.view()).catch((err) => streamDeck.logger.error("animation draw failed", err));
}, ANIMATION_MS);

// `pnpm deck:reload` touches this file; the app respawns a plugin that exits.
const reloadAtStart = ((): number => {
  try {
    return statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return 0;
  }
})();
setInterval(() => {
  let mtime = 0;
  try {
    mtime = statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return;
  }
  if (mtime !== reloadAtStart) {
    log("reload requested; exiting so the app respawns the plugin");
    process.exit(0);
  }
}, 1000);

log(`herdr deck started: socket ${SOCKET}, ${MASCOTS.length} animals, poll ${POLL_MS} ms`);
herdrCall<{ protocol?: number; version?: string }>(SOCKET, "ping").then(
  (pong) => {
    if (pong.protocol !== BUILT_FOR_PROTOCOL) {
      streamDeck.logger.warn(`herdr ${pong.version} speaks protocol ${pong.protocol}; this deck was built against ${BUILT_FOR_PROTOCOL}`);
    }
  },
  () => {
    // herdr is not running; the poll says so on the arrow key
  },
);
```

- [ ] **Step 7: Write the manifest**

`com.eordouie.herdrdeck.sdPlugin/manifest.json`:

```json
{
  "Name": "Herdr Agents",
  "Version": "1.0.0.0",
  "Author": "Ehsan Ordouie",
  "Description": "One key per herdr agent, the most active first.",
  "Category": "Herdr Agents",
  "CategoryIcon": "imgs/plugin/category-icon",
  "Icon": "imgs/plugin/marketplace",
  "SDKVersion": 2,
  "Software": {
    "MinimumVersion": "6.5"
  },
  "OS": [
    {
      "Platform": "mac",
      "MinimumVersion": "12"
    }
  ],
  "Nodejs": {
    "Version": "20",
    "Debug": "enabled"
  },
  "CodePath": "bin/plugin.js",
  "UUID": "com.eordouie.herdrdeck",
  "Actions": [
    {
      "Name": "Herdr Agent",
      "UUID": "com.eordouie.herdrdeck.agent",
      "Icon": "imgs/actions/agent/icon",
      "Tooltip": "One herdr agent. Press to jump to it.",
      "Controllers": [
        "Keypad"
      ],
      "DisableAutomaticStates": true,
      "States": [
        {
          "Image": "imgs/actions/agent/key",
          "TitleAlignment": "middle",
          "ShowTitle": false
        }
      ]
    },
    {
      "Name": "Herdr Agents Page",
      "UUID": "com.eordouie.herdrdeck.pager",
      "Icon": "imgs/actions/pager/icon",
      "Tooltip": "Switch between the two pages of agents.",
      "Controllers": [
        "Keypad"
      ],
      "DisableAutomaticStates": true,
      "States": [
        {
          "Image": "imgs/actions/pager/key",
          "TitleAlignment": "middle",
          "ShowTitle": false
        }
      ]
    }
  ]
}
```

- [ ] **Step 8: Write the build files**

`tsconfig.herdr-deck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "com.eordouie.herdrdeck.sdPlugin/bin"
  },
  "include": ["src/herdr-deck/**/*.ts", "src/icons/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/herdr-deck/fixtures.ts"]
}
```

`rollup.herdr-deck.config.mjs`:

```js
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.eordouie.herdrdeck.sdPlugin";

// The herdr deck is its own plugin with its own bundle. It shares src/icons/
// with the old plugin and nothing else, so it has its own config and tsconfig
// rather than a second entry in rollup.config.mjs.
/** @type {import('rollup').RollupOptions} */
export default {
  input: "src/herdr-deck/plugin.ts",
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    inlineDynamicImports: true,
    sourcemap: isWatching,
  },
  plugins: [
    typescript({ tsconfig: "tsconfig.herdr-deck.json" }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
      extensions: [".ts", ".js", ".mjs", ".json"],
    }),
    commonjs(),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
      },
    },
  ],
};
```

Append to `.gitignore`:

```
com.eordouie.herdrdeck.sdPlugin/bin/
com.eordouie.herdrdeck.sdPlugin/logs/
```

- [ ] **Step 9: Write the PNG script and the link script**

`scripts/render-herdr-deck-pngs.mjs` (the Stream Deck validator wants PNGs for the manifest's icon fields):

```js
#!/usr/bin/env node
// Rasterize the herdr deck's manifest PNGs. Run: pnpm deck:pngs
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "com.eordouie.herdrdeck.sdPlugin/imgs");
const { renderIcon } = await import(pathToFileURL(resolve(root, "src/icons/index.ts")).href);
const { emptyKeySvg, pagerKeySvg } = await import(pathToFileURL(resolve(root, "src/herdr-deck/key-svg.ts")).href);

// A fixed clock: the stegosaurus stands centred with its eyes open, and the files are reproducible.
const realNow = Date.now;
Date.now = () => 5200;
const hero = renderIcon({ state: "idle", slot: 6, label: "herdr", lines: { top: "herdr" }, frame: 0, now: 0 });
Date.now = realNow;

// White on transparent, as the app's action list expects: a key outline holding three agents.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" rx="7" fill="none" stroke="#fff" stroke-width="3"/><rect x="11" y="12" width="18" height="4" rx="2" fill="#fff"/><rect x="11" y="19" width="12" height="4" rx="2" fill="#fff"/><rect x="11" y="26" width="15" height="4" rx="2" fill="#fff"/></svg>`;
const arrow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" rx="7" fill="none" stroke="#fff" stroke-width="3"/><path d="M16 12 L28 20 L16 28 Z" fill="#fff"/></svg>`;

const targets = [
  [hero, "plugin/marketplace.png", 144],
  [hero, "plugin/marketplace@2x.png", 288],
  [glyph, "plugin/category-icon.png", 28],
  [glyph, "plugin/category-icon@2x.png", 56],
  [glyph, "actions/agent/icon.png", 40],
  [glyph, "actions/agent/icon@2x.png", 80],
  [emptyKeySvg(), "actions/agent/key.png", 144],
  [emptyKeySvg(), "actions/agent/key@2x.png", 288],
  [arrow, "actions/pager/icon.png", 40],
  [arrow, "actions/pager/icon@2x.png", 80],
  [pagerKeySvg({ page: 1, pages: 1, more: 0, alert: false, offline: false }, 0), "actions/pager/key.png", 144],
  [pagerKeySvg({ page: 1, pages: 1, more: 0, alert: false, offline: false }, 0), "actions/pager/key@2x.png", 288],
];
for (const [svg, file, size] of targets) {
  const path = resolve(out, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true } }).render().asPng());
  console.log(`  ${relative(root, path)} (${size}x${size})`);
}
```

`scripts/link-herdr-deck.sh`:

```bash
#!/usr/bin/env bash
# Symlink the herdr deck's plugin folder into the Stream Deck app's Plugins
# folder. macOS only. The app loads a newly linked plugin at its next start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="com.eordouie.herdrdeck.sdPlugin"
DEST="${HOME}/Library/Application Support/com.elgato.StreamDeck/Plugins/${NAME}"

if [ ! -f "${ROOT}/${NAME}/bin/plugin.js" ]; then
  echo "error: ${NAME}/bin/plugin.js is missing: run 'pnpm build:deck' first" >&2
  exit 1
fi
if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -e "$DEST" ]; then
  echo "error: $DEST exists and is not a symlink; not touching it" >&2
  exit 1
fi
ln -s "${ROOT}/${NAME}" "$DEST"
echo "linked: $DEST -> ${ROOT}/${NAME}"
```

Make it executable: `chmod +x scripts/link-herdr-deck.sh`

- [ ] **Step 10: Add the package scripts**

In `package.json` `scripts`, add after `"sd:reload"`:

```json
    "build:deck": "rollup -c rollup.herdr-deck.config.mjs",
    "deck:pngs": "tsx scripts/render-herdr-deck-pngs.mjs",
    "deck:validate": "bash scripts/sd-cli.sh validate com.eordouie.herdrdeck.sdPlugin",
    "deck:link": "bash scripts/link-herdr-deck.sh",
    "deck:reload": "mkdir -p ~/.config/herdr-deck && date +%s > ~/.config/herdr-deck/reload",
    "deck:demo": "tsx scripts/herdr-deck-demo.mjs",
    "mascots:sheet": "tsx scripts/mascot-sheet.mjs",
    "mascots:gallery": "node scripts/mascot-gallery.mjs",
```

- [ ] **Step 11: Build, rasterize, validate**

```bash
pnpm deck:pngs
pnpm build:deck
pnpm deck:validate
node_modules/.bin/tsx --test src/herdr-deck/*.test.ts
node_modules/.bin/tsc --noEmit -p .
```

Expected: 12 PNG paths printed; rollup writes `com.eordouie.herdrdeck.sdPlugin/bin/plugin.js` with no error; the validator reports the manifest valid; all herdr-deck tests pass; `tsc` prints nothing. If rollup rejects the `outDir` (the TypeScript plugin requires it inside the output folder), the message names the path to use; `tsconfig.herdr-deck.json` already sets it to the bundle's folder.

- [ ] **Step 12: Commit**

```bash
git add src/herdr-deck/key-svg.ts src/herdr-deck/key-svg.test.ts src/herdr-deck/agent-key.ts src/herdr-deck/pager-key.ts src/herdr-deck/plugin.ts com.eordouie.herdrdeck.sdPlugin/manifest.json com.eordouie.herdrdeck.sdPlugin/imgs rollup.herdr-deck.config.mjs tsconfig.herdr-deck.json scripts/render-herdr-deck-pngs.mjs scripts/link-herdr-deck.sh package.json .gitignore
git commit -m "Added the herdr deck plugin: agent keys, the arrow key, and its own build"
```

---

### Task 10: The layout tool (dotfiles)

The layout tool in `~/Projects/dotfiles/streamdeck/` writes the Stream Deck profile page. It learns two key kinds and stops demanding a launch spec from a deck that opens no tabs.

Work in a dotfiles worktree: `git -C /Users/ehsan/Projects/dotfiles worktree add .claude/worktrees/herdr-deck -b feat/herdr-agent-deck origin/main` and run every command of this task from `/Users/ehsan/Projects/dotfiles/.claude/worktrees/herdr-deck`.

**Files:**
- Modify: `streamdeck/build_claude_page.py`, `streamdeck/layout.toml`, `streamdeck/SETUP.md`
- Test: `tests/test_streamdeck_layout.py`

**Interfaces:**
- Consumes: the action ids `com.eordouie.herdrdeck.agent` and `com.eordouie.herdrdeck.pager` (Task 9).
- Produces: layout kinds `agent` and `pager`; a `layout.toml` with 14 agent keys and the arrow key at `4,2`.

- [ ] **Step 1: Write the failing test**

`tests/test_streamdeck_layout.py`:

```python
"""Unit tests for streamdeck/build_claude_page.py: the herdr deck's key kinds and the optional launch table."""

import importlib.util
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_claude_page", ROOT / "streamdeck" / "build_claude_page.py")
page = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(page)

AGENT = "com.eordouie.herdrdeck.agent"
PAGER = "com.eordouie.herdrdeck.pager"


def keys(*pairs):
    return [{"pos": pos, "kind": kind} for pos, kind in pairs]


def test_agent_and_pager_keys_build_without_a_launch_table():
    actions, errors = page.build_actions({"key": keys(("0,0", "agent"), ("1,0", "agent"), ("4,2", "pager"))})
    assert errors == []
    assert [actions[p]["UUID"] for p in ("0,0", "1,0", "4,2")] == [AGENT, AGENT, PAGER]
    assert actions["0,0"]["Plugin"]["UUID"] == "com.eordouie.herdrdeck"
    assert actions["0,0"]["Settings"] == {}


def test_a_slot_key_still_needs_the_launch_table():
    _, errors = page.build_actions({"key": keys(("0,0", "slot"))})
    assert any("[launch]" in e for e in errors)


def test_only_one_pager_key_is_allowed():
    _, errors = page.build_actions({"key": keys(("3,2", "pager"), ("4,2", "pager"))})
    assert any("only one pager" in e for e in errors)


def test_an_unknown_kind_names_the_new_kinds():
    _, errors = page.build_actions({"key": keys(("0,0", "widget"))})
    assert any("agent" in e and "pager" in e for e in errors)


def test_the_guard_knows_the_new_actions():
    assert {AGENT, PAGER} <= page.KNOWN_UUIDS


def test_the_committed_layout_is_fourteen_agents_and_the_arrow_bottom_right():
    layout = tomllib.loads((ROOT / "streamdeck" / "layout.toml").read_text())
    actions, errors = page.build_actions(layout)
    assert errors == []
    assert len(actions) == 15
    assert actions["4,2"]["UUID"] == PAGER
    assert sum(1 for a in actions.values() if a["UUID"] == AGENT) == 14
```

- [ ] **Step 2: Run it and see it fail**

Run: `python3 -m pytest tests/test_streamdeck_layout.py -q`
Expected: 6 failures (`kind must be slot|command|signal|page`, missing `[launch]`, `KNOWN_UUIDS` without the new ids).

- [ ] **Step 3: Teach the builder the new kinds**

In `streamdeck/build_claude_page.py`, after the `PAGE_UUIDS = {...}` block, add:

```python
# The herdr deck (~/Projects/streamdeck-claude, plugin folder
# com.eordouie.herdrdeck.sdPlugin): one `agent` key per herdr agent, ranked by
# the plugin, and one `pager` key that flips the plugin's own two pages. The
# plugin counts its agent keys itself, so a key carries no settings.
HERDR_PLUGIN = {
    "Name": "Herdr Agents",
    "UUID": "com.eordouie.herdrdeck",
    "Version": plugin_version("com.eordouie.herdrdeck", "1.0.0.0"),
}
AGENT_UUID = "com.eordouie.herdrdeck.agent"
PAGER_UUID = "com.eordouie.herdrdeck.pager"
```

Replace the `KNOWN_UUIDS = ...` line with:

```python
KNOWN_UUIDS = {
    SLOT_UUID, CMD_UUID, AGENT_UUID, PAGER_UUID,
    *SIGNAL_UUIDS.values(), *PAGE_UUIDS.values(), *RETIRED_UUIDS,
}
```

In `build_actions`, replace these lines:

```python
    launch_spec = None
    launch = layout.get("launch")
    where = "[launch]"
    if not isinstance(launch, dict) or not launch:
        errors.append("layout needs a [launch] table (script + env for a new agent tab)")
    else:
```

with:

```python
    launch_spec = None
    launch = layout.get("launch")
    where = "[launch]"
    # Only a slot key opens a tab. A deck of herdr agent keys opens none and
    # needs no launch table; one that is present is still validated.
    wants_launch = any(isinstance(k, dict) and k.get("kind") == "slot" for k in layout.get("key", []))
    if launch is None and not wants_launch:
        pass
    elif not isinstance(launch, dict) or not launch:
        errors.append("layout needs a [launch] table (script + env for a new agent tab)")
    else:
```

and replace the final `else:` branch of the `kind` chain:

```python
        else:
            errors.append(f"{where}: kind must be slot|command|signal|page, got {kind!r}")
```

with:

```python
        elif kind == "agent":
            actions[pos] = key_entry(AGENT_UUID, "Herdr Agent", {}, plugin=HERDR_PLUGIN)
        elif kind == "pager":
            if any(a["UUID"] == PAGER_UUID for a in actions.values()):
                errors.append(f"{where}: only one pager key is allowed")
                continue
            actions[pos] = key_entry(PAGER_UUID, "Herdr Agents Page", {}, plugin=HERDR_PLUGIN)
        else:
            errors.append(f"{where}: kind must be slot|command|signal|page|agent|pager, got {kind!r}")
```

- [ ] **Step 4: Write the new layout**

Replace the whole of `streamdeck/layout.toml` with:

```toml
# Stream Deck MK.2 layout: the herdr agent deck.
# Edit this file, then run apply-layout.sh to push it to the deck.
#
# Grid: pos = "col,row" — col 0-4 left to right, row 0-2 top to bottom.
# Kinds on this deck:
#   agent — one herdr agent, drawn by the herdr deck plugin
#           (~/Projects/streamdeck-claude, com.eordouie.herdrdeck). The plugin
#           ranks the agents (needs-you, working, finished, idle) and fills its
#           agent keys in reading order; a press jumps to that agent in herdr.
#           A key carries no settings: fourteen keys make a page of fourteen.
#   pager — the plugin's arrow key: flips between its two pages of agents
#           (28 agents in all). One per deck.
# Kinds the builder still accepts and this deck no longer places (the layout of
# 2026-08-18, in git history, shows them in use):
#   slot    — an old Claude-session tile; needs a [launch] table.
#   command — runs a script on press.
#   signal  — a deck-signals key (meeting, slack, github, repos, mic, dictate, input).
#   page    — the Stream Deck app's own page-switch key.
# Ehsan's decision of 2026-11-23: fourteen agents and one arrow per page, two
# pages, no mic or other key.

# Which page to rewrite. Addressed by the profile's display name (as shown in
# the Stream Deck app) and the page's position, both of which are the same on
# any machine — the UUIDs in the real path are generated per install.
[target]
profile = "Exowatt"
page = 1

# --- Row 0 -----------------------------------------------------------------

[[key]]
pos = "0,0"
kind = "agent"

[[key]]
pos = "1,0"
kind = "agent"

[[key]]
pos = "2,0"
kind = "agent"

[[key]]
pos = "3,0"
kind = "agent"

[[key]]
pos = "4,0"
kind = "agent"

# --- Row 1 -----------------------------------------------------------------

[[key]]
pos = "0,1"
kind = "agent"

[[key]]
pos = "1,1"
kind = "agent"

[[key]]
pos = "2,1"
kind = "agent"

[[key]]
pos = "3,1"
kind = "agent"

[[key]]
pos = "4,1"
kind = "agent"

# --- Row 2: four agents and the arrow -----------------------------------------

[[key]]
pos = "0,2"
kind = "agent"

[[key]]
pos = "1,2"
kind = "agent"

[[key]]
pos = "2,2"
kind = "agent"

[[key]]
pos = "3,2"
kind = "agent"

[[key]]
pos = "4,2"
kind = "pager"
```

- [ ] **Step 5: Run the tests and a dry run**

```bash
python3 -m pytest tests/test_streamdeck_layout.py -q
python3 streamdeck/build_claude_page.py --dry-run
```

Expected: 6 passed. The dry run prints 15 lines, fourteen ending `agent    Herdr Agent` and `4,2  pager    Herdr Agents Page`, and writes nothing (it only reads the live profile to check the page holds nothing foreign: the old slot, signal and next-page keys are all in `KNOWN_UUIDS`).

- [ ] **Step 6: Update the setup notes**

In `streamdeck/SETUP.md`, section "## 2. Build and link each plugin", replace the build-and-link instructions for `streamdeck-claude` and `deck-signals` with:

```markdown
The deck runs one plugin, the herdr deck, built from `~/Projects/streamdeck-claude`:

    cd ~/Projects/streamdeck-claude
    pnpm install
    pnpm build:deck
    pnpm deck:link

The older `com.julien.claudesessions` plugin (Ghostty tabs, one key per Claude
session) and `deck-signals` (mic, dictate, meeting, Slack keys) are not linked
any more (2026-11-23). To bring one back: `pnpm sd:link` in its repo, a layout
that places its keys, and `apply-layout.sh`.
```

and in section "## 6. Verify" replace the checks with:

```markdown
- The plugin's log (`~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.eordouie.herdrdeck.sdPlugin/logs/`) shows `herdr deck started` and a `keys:` line.
- The keys show your herdr agents, the working ones first; the bottom-right key is the arrow.
- A press brings Ghostty forward on that agent.
- With herdr not running, the keys are dark frames and the arrow key reads "herdr off".
```

- [ ] **Step 7: Run the repo's own checks and commit**

```bash
python3 -m pytest tests/ -q
python3 agent-core/agentctl.py check
git add streamdeck/build_claude_page.py streamdeck/layout.toml streamdeck/SETUP.md tests/test_streamdeck_layout.py
git commit -m "Laid the deck out as fourteen herdr agent keys and one arrow key"
```

Expected: every test passes; `agentctl.py check` reports no drift.

---

### Task 11: First light on the hardware, on demo data

This is the first step that changes what the owner's deck shows, and it quits and relaunches the Stream Deck app, which he opened by hand. **It starts only with the owner present and on his go.** Everything runs against a stand-in herdr, so no key press can move his real herdr view.

**Files:**
- Create: `scripts/herdr-deck-demo.mjs`

**Interfaces:**
- Consumes: `startFakeHerdr` (Task 3), the plugin's `config.json` and `reload` files (Task 9).

- [ ] **Step 1: Write the demo**

`scripts/herdr-deck-demo.mjs`:

```js
#!/usr/bin/env node
// Drive the deck from a stand-in herdr: 30 agents whose states change every few
// seconds. Run: pnpm deck:demo   Stop: Ctrl+C (the deck returns to the real herdr).
// The stand-in receives the focus command of every key press and prints it, so
// a press can be tested without moving the real herdr view.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { startFakeHerdr } = await import(pathToFileURL(resolve(root, "src/herdr-deck/fake-herdr.ts")).href);

const home = join(homedir(), ".config", "herdr-deck");
const socket = join(home, "demo.sock");
const config = join(home, "config.json");
const reload = join(home, "reload");
mkdirSync(home, { recursive: true });
const touchReload = () => writeFileSync(reload, `${Date.now()}\n`);

// Start from the real agents (read-only), so the names on the keys are the owner's own, and pad to 30.
let snapshot = { focused_pane_id: null, workspaces: [], tabs: [], agents: [] };
try {
  snapshot = JSON.parse(execFileSync("herdr", ["api", "snapshot"], { encoding: "utf8" })).result.snapshot;
} catch {
  console.log("herdr is not running: the demo uses invented agents only");
}
for (let i = snapshot.agents.length + 1; i <= 30; i++) {
  const ws = `wD${i}`;
  snapshot.workspaces.push({ workspace_id: ws, label: `demo-${i}`, number: 100 + i });
  snapshot.tabs.push({ tab_id: `${ws}:t1`, workspace_id: ws, label: "1", number: 1 });
  snapshot.agents.push({ pane_id: `${ws}:p1`, workspace_id: ws, tab_id: `${ws}:t1`, agent: i % 2 ? "claude" : "codex", agent_status: "idle", focused: false, state_change_seq: i, agent_session: { value: `demo-${i}` } });
}

const fake = await startFakeHerdr(socket, snapshot);
writeFileSync(config, `${JSON.stringify({ socketPath: socket })}\n`);
touchReload();
console.log(`demo herdr on ${socket} with ${snapshot.agents.length} agents; the deck now shows it. Ctrl+C to stop.`);

// Every 5 s one agent changes state, cycling working, blocked, working, done, idle, so every look and every move is seen.
const CYCLE = ["working", "blocked", "working", "done", "idle"];
let seq = 10_000;
let step = 0;
let printed = 0;
const timer = setInterval(() => {
  const agent = fake.snapshot.agents[step % fake.snapshot.agents.length];
  const phase = Math.floor(step / fake.snapshot.agents.length) % CYCLE.length;
  agent.agent_status = CYCLE[phase];
  agent.state_change_seq = ++seq;
  step += 7;
  for (; printed < fake.focusCalls.length; printed++) console.log(`key press -> agent.focus ${fake.focusCalls[printed]}`);
}, 5000);
const pressWatch = setInterval(() => {
  for (; printed < fake.focusCalls.length; printed++) console.log(`key press -> agent.focus ${fake.focusCalls[printed]}`);
}, 250);

async function stop() {
  clearInterval(timer);
  clearInterval(pressWatch);
  rmSync(config, { force: true });
  touchReload();
  await fake.close();
  console.log("demo stopped; the deck reads the real herdr again");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
```

`herdr api snapshot` is read-only. Commit the script:

```bash
git add scripts/herdr-deck-demo.mjs
git commit -m "Added a demo that drives the deck from a stand-in herdr"
```

- [ ] **Step 2: Ask the owner for the go**

Say exactly what happens next: the Stream Deck app is quit and relaunched once; the old Claude-sessions plugin and deck-signals are unlinked (two symlinks, relinked by one command each); page 1 of the "Exowatt" profile is rewritten to 14 agent keys and the arrow. Wait for his go.

- [ ] **Step 3: Start the demo, swap the plugins, apply the layout**

```bash
cd /Users/ehsan/Projects/streamdeck-claude/.claude/worktrees/herdr-deck
pnpm build:deck
```

In a second terminal pane, leave running: `pnpm deck:demo`

Then:

```bash
rm "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.julien.claudesessions.sdPlugin"
rm "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.eordouie.decksignals.sdPlugin"
pnpm deck:link
/Users/ehsan/Projects/dotfiles/.claude/worktrees/herdr-deck/streamdeck/apply-layout.sh
```

Both `rm` targets are symlinks (verified 2026-11-23); `rm` without `-r` cannot remove a real folder. `apply-layout.sh` quits the app, rewrites the page, and relaunches it.

- [ ] **Step 4: Verify the artifacts, not the exit codes**

```bash
python3 - <<'EOF'
import glob, json, os
base = os.path.expanduser("~/Library/Application Support/com.elgato.StreamDeck/ProfilesV3")
for m in glob.glob(base + "/*.sdProfile/Profiles/*/manifest.json"):
    for c in json.load(open(m)).get("Controllers", []):
        kinds = sorted(a["UUID"].rsplit(".", 1)[-1] for a in (c.get("Actions") or {}).values())
        print(os.path.basename(os.path.dirname(m))[:8], len(kinds), kinds)
EOF
tail -5 "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.eordouie.herdrdeck.sdPlugin/logs/com.eordouie.herdrdeck.0.log"
```

Expected: one page with 15 actions, fourteen `agent` and one `pager`; the log shows `herdr deck started: socket .../demo.sock, 28 animals, poll 500 ms` and a `keys: page 1/2: ...` line.

- [ ] **Step 5: The owner looks at the deck**

With the demo running, he checks, and each is a yes or a named change:

1. Fourteen keys each show an animal under a project name; the bottom-right key is the arrow with `+16` and `1/2`.
2. No animal appears twice on a page, and after the arrow, none on page 2 repeats one from page 1.
3. An agent that starts working moves up and its animal walks on amber; one that needs him pulses and takes the first key; a finished one flashes, then keeps the white dot.
4. On page 2, when a page-1 agent needs him, the arrow key pulses.
5. Every animal is recognisable on the real key. Any that is not goes back to Task 1 Step 3.

- [ ] **Step 6: Test a press against the stand-in**

He puts another app in front, then presses any agent key. Expected: the demo's terminal prints `key press -> agent.focus <pane>` and Ghostty comes forward on the tab that shows herdr. His real herdr view does not move, because the stand-in took the command.

If Ghostty does not come forward on the right tab, the plugin log names why (`could not select herdr's terminal (...)`). Two known alternatives for the `focus t` line in `raiseScript`, to try in this order, rebuilding (`pnpm build:deck`) and reloading (`pnpm deck:reload`) after each: `focus (contents of t)`; then `select tab (tab of t)` followed by `activate window (window of t)`. Update the test in `jump.test.ts` to the form that works.

- [ ] **Step 7: Measure the load**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do ps -axo %cpu=,command= | grep -E "Elgato Stream Deck.app/Contents/MacOS/Stream Deck$|herdrdeck.sdPlugin" | grep -v grep | cut -c1-80; sleep 2; done
```

Expected: the app and the plugin's Node process each stay under about a quarter of one core. If the app sits above that with all keys animating, raise `ANIMATION_MS` in `src/herdr-deck/plugin.ts` from 120 to 160, rebuild, reload, and measure again; record both readings in the effort log.

- [ ] **Step 8: Stop the demo**

Ctrl+C in the demo's pane. Expected: `demo stopped; the deck reads the real herdr again`, and within two seconds the keys show his real agents.

---

### Task 12: The live deck

The owner is present. No command in this task sends a focus command; every jump is his own key press.

- [ ] **Step 1: The keys match herdr**

Print what the deck should show, from the same pure functions, read-only:

```bash
node_modules/.bin/tsx -e '
import { readSnapshot, DEFAULT_SOCKET } from "./src/herdr-deck/herdr-client.ts";
import { toDeckAgents } from "./src/herdr-deck/model.ts";
import { rankAgents } from "./src/herdr-deck/rank.ts";
const ranked = rankAgents(toDeckAgents(await readSnapshot(DEFAULT_SOCKET)));
ranked.slice(0, 28).forEach((a, i) => console.log(String(i + 1).padStart(2), a.status.padEnd(8), a.kind.padEnd(7), a.workspace, a.tab));
'
```

Expected: the first fourteen lines are the fourteen keys in reading order, the next the keys of page 2. (An agent whose turn ended in the last 4 s may still sit one group higher on the deck than in this list.)

- [ ] **Step 2: Three presses of his choice**

After each press, read which pane herdr has in front (read-only) and compare it with the key he pressed:

```bash
herdr api snapshot | python3 -c 'import json,sys; s=json.load(sys.stdin)["result"]["snapshot"]; print(s["focused_pane_id"])'
```

Expected: the pane of the pressed key each time, and Ghostty in front.

- [ ] **Step 3: One agent through its states**

He sends a prompt to an idle agent. Expected, on the deck: within a second its key joins the working group and its animal walks; about 4 s after the turn ends the key flashes and moves to the finished group; when he looks at that agent in herdr, the dot goes and the key joins the idle group. When an agent next asks him for permission, its key pulses and takes the first place; note the time in the effort log when that has been seen.

- [ ] **Step 4: The deck after a restart of the app (his yes)**

The Stream Deck app's login item was removed on 2026-11-02. If he wants the deck back after every login:

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Elgato Stream Deck.app", hidden:true}'
```

- [ ] **Step 5: Record**

Update the effort log `docs/log/2026-11-23-herdr-agent-deck.md`: status, what he changed in Steps 1 to 3, the load readings, the form of the AppleScript that worked.

---

### Task 13: Documentation and landing

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `LESSONS.md`, `docs/log/2026-11-23-herdr-agent-deck.md`
- Draft for the owner's yes: `agent-workflow.md` (an agent instruction file)

- [ ] **Step 1: README**

Add a section "Herdr agent deck" after the introduction: what the keys show (project name, animal, second word), the order, what a press does, the arrow key, the three runtime files under `~/.config/herdr-deck/`, and the commands `pnpm build:deck`, `pnpm deck:link`, `pnpm deck:reload`, `pnpm deck:demo`, `pnpm mascots:gallery`. State that the older plugin in this repo is no longer linked and what relinks it.

- [ ] **Step 2: Architecture**

Add to `docs/architecture.md` a section "Herdr agent deck (`src/herdr-deck/`)": the data path snapshot, settle, rank, mascot pool, compose, draw; the file table from this plan; the three herdr methods used; why polling; why the tty and not the title.

- [ ] **Step 3: Lessons**

Add to `LESSONS.md`:

- A herdr focus command moves the owner's live view. On 2026-11-23 a "harmless" test of `agent.focus` on the pane believed to be in front pulled his view across workspaces, because the belief was 25 minutes old. Focus is never a probe; test it against `fake-herdr.ts`.
- herdr reports a Codex agent as `done` for about 2 s between two steps. Anything that reacts to "finished" must wait (`HOLD_MS`).
- Ghostty's terminal title follows herdr's focused workspace. Find herdr's terminal by tty.

- [ ] **Step 4: The instruction file, as a draft**

Show the owner this change to `agent-workflow.md` and apply it only on his yes: a row for `src/herdr-deck/` and `com.eordouie.herdrdeck.sdPlugin/` in "Project Data"; a section "Herdr deck invariants" with the Global Constraints of this plan that outlive it (focus only from a key press; three herdr methods; no branch on the agent kind; the plugin writes to no terminal; layout config in dotfiles); and the note that the SD app now loads `com.eordouie.herdrdeck.sdPlugin` from the main checkout.

- [ ] **Step 5: Tests, commits, pull requests**

```bash
pnpm test
git add README.md docs/architecture.md LESSONS.md docs/log/2026-11-23-herdr-agent-deck.md
git commit -m "Documented the herdr deck"
git push -u origin feat/herdr-agent-deck
gh pr create --repo eordouie/streamdeck-claude --base ghostty-focus --title "Herdr agent deck: 28 agents on two pages, ranked by activity" --body-file .cache/pr-body.md
```

Expected: only the two worktree-path failures named in Global Constraints. The PR body names the test result, the hardware checks of Tasks 11 and 12, and the owner's look. `eordouie/streamdeck-claude` is not in the self-merge grant: hand the owner the merge command and wait.

For dotfiles, from its worktree: push, open the PR against `main`, and merge it under the standing grant once `python3 -m pytest tests/` and `python3 agent-core/agentctl.py check` pass in the session (name both in the PR body).

- [ ] **Step 6: Move the deck onto the main checkouts**

After both merges:

```bash
git -C /Users/ehsan/Projects/streamdeck-claude pull
cd /Users/ehsan/Projects/streamdeck-claude && pnpm install && pnpm build:deck && pnpm deck:link && pnpm deck:reload
git -C /Users/ehsan/Projects/dotfiles pull
```

Then check the plugin runs from the main checkout and remove the two worktrees:

```bash
ps -axo command= | grep "herdrdeck.sdPlugin" | grep -v grep | cut -c1-200
git -C /Users/ehsan/Projects/streamdeck-claude worktree remove .claude/worktrees/herdr-deck
git -C /Users/ehsan/Projects/dotfiles worktree remove .claude/worktrees/herdr-deck
```

Expected: the Node process's path contains `/Users/ehsan/Projects/streamdeck-claude/com.eordouie.herdrdeck.sdPlugin`, with no `.claude/worktrees` in it. If it still shows the worktree path, quit and relaunch the Stream Deck app (the owner's go) before removing the worktree.

---

## Rollback

At any point after Task 11, the old deck comes back with:

```bash
rm "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.eordouie.herdrdeck.sdPlugin"
cd /Users/ehsan/Projects/streamdeck-claude && pnpm sd:link
cd /Users/ehsan/Projects/deck-signals && pnpm sd:link
git -C /Users/ehsan/Projects/dotfiles show origin/main~1:streamdeck/layout.toml > /tmp/layout-before.toml
python3 /Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py --layout /tmp/layout-before.toml --dry-run
```

then, with the Stream Deck app quit, the same command without `--dry-run`, and relaunch the app. (Before the dotfiles PR merges, the old layout is simply `streamdeck/layout.toml` in the dotfiles main checkout, and `apply-layout.sh` there restores it.) Nothing else was changed: no hook, no setting, no file outside the two repos and `~/.config/herdr-deck/`.

## Out of scope

- The old plugin's hook bridges (`streamdeck_claude_bridge.py` in the Claude settings, the Codex bridge in `~/.codex/hooks.json`) keep firing for a plugin that is no longer linked. Retiring them is harness configuration and the owner's separate decision.
- Deleting the old plugin's source, the `deck-signals` repo, or page 2 of the Stream Deck profile (it holds one previous-page key and is unreachable once page 1 has no next-page key).
- Windows and WSL. The herdr deck is macOS only.
- More than two pages, a kill gesture, opening a new agent from an empty key.
- Reordering herdr's own sidebar to match the deck.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-11-23-herdr-agent-deck/plan.md`. Two execution options:

1. **Delegated**: a fresh delegate per task, review between tasks. Tasks 2 to 10 are independent of the hardware and suit this. Tasks 11 and 12 need the owner at the deck and run inline.
2. **Inline**: the tasks in this session, with checkpoints.

Execution starts only on the owner's go. Task 1 is the exception he ordered ahead: the twenty animals are drawn now and he judges them from the gallery.
