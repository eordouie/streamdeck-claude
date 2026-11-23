import assert from "node:assert/strict";
import { test } from "node:test";
import { deckAgent } from "./fixtures.js";
import { keyLines, secondWords, splitProject, typedTab } from "./labels.js";

test("a project name that fits the top line stays whole, hyphen included", () => {
  for (const name of ["hive-2.0", "solar-sim", "ssh-issues", "interviews", "TEA", "git"]) {
    assert.deepEqual(splitProject(name), { top: name, rest: "" }, name);
  }
});

test("a longer name breaks at the last hyphen or space that still fits", () => {
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
  assert.deepEqual([...words], [["wT:p2", ["health"]], ["wT:p3", ["amazon"]]]);
});

test("two agents side by side in one tab are told apart by their kind", () => {
  const words = secondWords([
    deckAgent({ paneId: "w2:p1", workspace: "hive-2.0", tab: "simulation", kind: "claude" }),
    deckAgent({ paneId: "w2:p2", workspace: "hive-2.0", tab: "simulation", kind: "codex" }),
  ]);
  assert.deepEqual([...words], [["w2:p1", ["claude"]], ["w2:p2", ["codex"]]]);
});

test("a mix falls back to the typed tab, else the kind, numbered when still equal", () => {
  const words = secondWords([
    deckAgent({ paneId: "w7:p1", workspace: "raytracer-engine", tab: "agents", kind: "claude" }),
    deckAgent({ paneId: "w7:p2", workspace: "raytracer-engine", tab: "agents", kind: "codex" }),
    deckAgent({ paneId: "w7:p5", workspace: "raytracer-engine", tab: "bakeoff", kind: "claude" }),
    deckAgent({ paneId: "w7:p9", workspace: "raytracer-engine", tab: "2", kind: "claude" }),
  ]);
  assert.deepEqual([...words], [["w7:p1", ["claude"]], ["w7:p2", ["codex"]], ["w7:p5", ["bakeoff"]], ["w7:p9", ["claude 2"]]]);
});

test("the numbering follows pane order, whatever order the agents arrive in", () => {
  const words = secondWords([
    deckAgent({ paneId: "wA:p10", workspace: "x", tab: "1" }),
    deckAgent({ paneId: "wA:p2", workspace: "x", tab: "1" }),
  ]);
  assert.deepEqual(words.get("wA:p2"), ["claude"]);
  assert.deepEqual(words.get("wA:p10"), ["claude 2"]);
});

test("lines: the project on top; below it the rest of a long name, then the words that tell agents apart", () => {
  const lines = (workspace: string, words: string[]) => keyLines(deckAgent({ paneId: "wA:p1", workspace }), words);
  assert.deepEqual(lines("git", []), { top: "git", line1: "", line2: "" });
  assert.deepEqual(lines("hive-2.0", ["codex"]), { top: "hive-2.0", line1: "codex", line2: "" });
  assert.deepEqual(lines("herdr", ["streamdeck", "codex"]), { top: "herdr", line1: "streamdeck", line2: "codex" });
  assert.deepEqual(lines("raytracer-engine", []), { top: "raytracer", line1: "engine", line2: "" });
  assert.deepEqual(lines("raytracer-engine", ["codex"]), { top: "raytracer", line1: "engine", line2: "codex" });
  assert.deepEqual(lines("raytracer-engine", ["bakeoff", "codex"]), { top: "raytracer", line1: "engine", line2: "bakeoff codex" });
});

test("two tabs, each with a claude and a codex: the tab on one line, the kind on the next", () => {
  // The owner's herdr workspace on 2026-11-23. A number ("streamdeck 2") said nothing about which agent it was.
  const words = secondWords([
    deckAgent({ paneId: "w9:p1", workspace: "herdr", tab: "customization", kind: "claude" }),
    deckAgent({ paneId: "w9:p6", workspace: "herdr", tab: "customization", kind: "codex" }),
    deckAgent({ paneId: "w9:p4", workspace: "herdr", tab: "streamdeck", kind: "claude" }),
    deckAgent({ paneId: "w9:p5", workspace: "herdr", tab: "streamdeck", kind: "codex" }),
  ]);
  assert.deepEqual([...words], [
    ["w9:p1", ["customization", "claude"]], ["w9:p6", ["customization", "codex"]],
    ["w9:p4", ["streamdeck", "claude"]], ["w9:p5", ["streamdeck", "codex"]],
  ]);
});

test("a tab of its own beside a shared tab keeps one word", () => {
  const words = secondWords([
    deckAgent({ paneId: "wA:p1", workspace: "x", tab: "sim", kind: "claude" }),
    deckAgent({ paneId: "wA:p2", workspace: "x", tab: "sim", kind: "codex" }),
    deckAgent({ paneId: "wA:p3", workspace: "x", tab: "notes", kind: "claude" }),
  ]);
  assert.deepEqual([...words.values()], [["sim", "claude"], ["sim", "codex"], ["notes"]]);
});

test("a numbered label never collides with a literal tab name", () => {
  const agents = ["review", "review", "review 2"].map((tab, i) =>
    deckAgent({ paneId: `wA:p${i + 1}`, workspace: "one", tab }));
  // Two agents of one kind in the tab "review", beside a tab literally named "review 2":
  // the number goes on the kind, never on the tab name, so it cannot collide.
  assert.deepEqual([...secondWords(agents).values()], [["review", "claude"], ["review", "claude 2"], ["review 2"]]);
});
