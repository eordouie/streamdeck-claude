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
