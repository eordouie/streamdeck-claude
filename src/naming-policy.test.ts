import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bgJobLabel,
  canonicalTabTitle,
  selfReferentialWords,
  DECKNAME_MAX_AGE_MS,
  PRUNE_GRACE_MS,
  sidecarMaxAgeMs,
  takenWordsFromDisk,
} from "./naming-policy.js";

test("canonicalTabTitle appends the deck word to the pid placeholder", () => {
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 84213, deckName: "mirrors" }), "claude-84213-mirrors");
});

test("canonicalTabTitle without a word is the bare pid placeholder", () => {
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 84213, deckName: "" }), "claude-84213");
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 84213, deckName: "   " }), "claude-84213");
});

test("canonicalTabTitle rejects words the title grammar can't hold", () => {
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 1, deckName: "two words" }), "claude-1");
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 1, deckName: "x".repeat(25) }), "claude-1");
});

test("canonicalTabTitle keeps hyphenated words", () => {
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 7, deckName: "pizza-fan" }), "claude-7-pizza-fan");
});

test("canonicalTabTitle treats the provider as nothing but a prefix", () => {
  // Full parity is the contract: swap the provider and the title must be
  // identical apart from that one word. Codex previously used a truncated
  // session id here, which left it without a deck word.
  assert.equal(canonicalTabTitle({ provider: "codex", pid: 7, deckName: "pizza-fan" }), "codex-7-pizza-fan");
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 7, deckName: "pizza-fan" }), "claude-7-pizza-fan");
  assert.equal(canonicalTabTitle({ provider: "codex", pid: 7, deckName: "" }), "codex-7");
  assert.equal(canonicalTabTitle({ provider: "claude", pid: 7, deckName: "" }), "claude-7");
});

test("canonicalTabTitle falls back per provider when the pid is unknown", () => {
  assert.equal(canonicalTabTitle({ provider: "codex", deckName: "" }), "codex-session");
  assert.equal(canonicalTabTitle({ provider: "claude", deckName: "" }), "claude-session");
  // An agent this repo has never heard of gets the identical shape — the
  // provider is an opaque string here, and there is no default to fall into.
  assert.equal(canonicalTabTitle({ provider: "gemini", deckName: "" }), "gemini-session");
  assert.equal(canonicalTabTitle({ provider: "gemini", pid: 7, deckName: "pizza-fan" }), "gemini-7-pizza-fan");
});

test("sidecarMaxAgeMs: deck names persist, event logs do not", () => {
  assert.equal(sidecarMaxAgeMs("abc.deckname"), DECKNAME_MAX_AGE_MS);
  assert.equal(sidecarMaxAgeMs("abc.events.ndjson"), PRUNE_GRACE_MS);
  assert.ok(DECKNAME_MAX_AGE_MS > PRUNE_GRACE_MS);
});

test("takenWordsFromDisk reports only live sessions' words", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naming-policy-"));
  try {
    await writeFile(join(dir, "live-sid.deckname"), "mirrors\n");
    await writeFile(join(dir, "dead-sid.deckname"), "pizza\n");
    await writeFile(join(dir, "live-sid.events.ndjson"), "{}\n");
    const words = await takenWordsFromDisk(new Set(["live-sid"]), dir);
    assert.deepEqual(words, ["mirrors"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("takenWordsFromDisk on a missing dir is empty", async () => {
  assert.deepEqual(await takenWordsFromDisk(new Set(["x"]), "/nonexistent-naming-policy-test"), []);
});

test("the namer's own sentinel directory can never become a session's name", () => {
  // The concrete leak (2026-08-17): four sessions were named "deck" because
  // `claude -p` reports its working directory to the model, and a thin session
  // gave it nothing better to latch onto.
  const words = selfReferentialWords("/Users/ehsan/.claude/deck-namer");
  for (const leaked of ["claude", "deck", "namer", "decknamer", "deck-namer"]) {
    assert.equal(words.has(leaked), true, `${leaked} must be rejected`);
  }
  // A real subject word is untouched — the guard is scoped to the tool's own
  // path, not a general blocklist.
  for (const legit of ["news", "briefing", "mascots", "raymap", "streamdeck"]) {
    assert.equal(words.has(legit), false, `${legit} must stay usable`);
  }
});

test("renaming the sentinel moves the guard with it, and Windows paths work", () => {
  const renamed = selfReferentialWords("/Users/ehsan/.claude/label-sandbox");
  assert.equal(renamed.has("label"), true);
  assert.equal(renamed.has("sandbox"), true);
  assert.equal(renamed.has("labelsandbox"), true);
  // The old name stops being blocked once nothing runs there — a hardcoded
  // list would have kept rejecting it forever.
  assert.equal(renamed.has("deck"), false);
  assert.equal(selfReferentialWords("C:\\Users\\ehsan\\.claude\\deck-namer").has("deck"), true);
  assert.equal(selfReferentialWords("").size, 0);
});

// ---------------------------------------------------------------------------
// bgJobLabel — a bg tile never earns a deck word, so this IS its permanent name.
//
// Regression suite for 2026-08-19: a parked job whose record said
// `name: "lever-ats-auth-issue"` rendered as "projects", because the label was
// documented as "name field if set, else basename(cwd)" and the name was never
// read. Every job launched from ~/Projects looked identical.
// ---------------------------------------------------------------------------

test("bgJobLabel prefers the job's own name over the cwd basename", () => {
  assert.equal(bgJobLabel("lever-ats-auth-issue", "projects"), "lever-ats-auth-issue");
});

test("bgJobLabel falls back to the cwd basename when the job has no name", () => {
  // A real state right after a park, before Claude Code names the job.
  assert.equal(bgJobLabel(undefined, "projects"), "projects");
  assert.equal(bgJobLabel("", "projects"), "projects");
  assert.equal(bgJobLabel("   ", "projects"), "projects", "whitespace-only is absent, not a label");
});

test("bgJobLabel trims but does not truncate — the renderer wraps and escapes", () => {
  assert.equal(bgJobLabel("  lever-ats-auth-issue  ", "projects"), "lever-ats-auth-issue");
  const long = "a-very-long-background-job-name-that-will-wrap";
  assert.equal(bgJobLabel(long, "projects"), long);
});

// --- naming readiness, broad words, hand-renamed tabs ---

import { broadWords, handRenamedWord, isNamingPrompt, namingReady } from "./naming-policy.js";

test("isNamingPrompt drops slash commands, wrappers, notifications and short openers", () => {
  assert.equal(isNamingPrompt("/pull-all and then go"), false);
  assert.equal(isNamingPrompt("<command-name>/clear</command-name>"), false);
  assert.equal(isNamingPrompt("[SYSTEM NOTIFICATION - NOT USER INPUT] done"), false);
  assert.equal(isNamingPrompt("go ahead"), false);
  assert.equal(isNamingPrompt("tune the calorimeter aperture"), true);
});

test("namingReady waits for three prompts or one long enough to carry the topic", () => {
  assert.equal(namingReady([]), false);
  assert.equal(namingReady(["continue the session please"]), false);
  assert.equal(namingReady(["continue the session please", "pull all repos now"]), false);
  assert.equal(namingReady(["a b c", "d e f", "g h i"]), true);
  assert.equal(namingReady([Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")]), true);
});

test("broadWords bans shared product words and every folder on the session's path", () => {
  const w = broadWords("/Users/ehsan/Projects/active/optical-system-app");
  for (const x of ["hive", "nebula", "lighttools", "projects", "active", "optical-system-app", "system"]) {
    assert.ok(w.includes(x), x);
  }
  assert.ok(!w.includes("users"));
  assert.ok(!w.includes("app")); // too short to matter, and a real subject word elsewhere
});

test("handRenamedWord reads the word the user typed on the tab", () => {
  assert.deepEqual(handRenamedWord("claude-33832-Humain", "claude-33832-nebula"), { pid: 33832, word: "Humain" });
  assert.deepEqual(handRenamedWord("claude-27945-workflow-improvement", "claude-27945-simaudit"), {
    pid: 27945,
    word: "workflow-improvement",
  });
  // A stale pid in the tab name (resumed in the same tab): the terminal's pid wins.
  assert.deepEqual(handRenamedWord("claude-11111-shading", "claude-48116-whitesim"), { pid: 48116, word: "shading" });
  // A bare name, spaces turned into dashes.
  assert.deepEqual(handRenamedWord("humain layout", "claude-5-nebula"), { pid: 5, word: "humain-layout" });
});

test("handRenamedWord ignores untouched tabs, non-agent terminals and unusable names", () => {
  assert.equal(handRenamedWord("claude-47143-labeling", "claude-47143-labeling"), null);
  assert.equal(handRenamedWord("my notes", "zsh"), null);
  assert.equal(handRenamedWord("claude-47143", "claude-47143-labeling"), null);
  assert.equal(handRenamedWord("a name that is far too long for a tab word", "claude-1-x"), null);
  assert.equal(handRenamedWord("bad/name", "claude-1-x"), null);
});
