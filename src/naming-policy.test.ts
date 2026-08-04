import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalTabTitle,
  DECKNAME_MAX_AGE_MS,
  PRUNE_GRACE_MS,
  sidecarMaxAgeMs,
  takenWordsFromDisk,
} from "./naming-policy.js";

test("canonicalTabTitle appends the deck word to the pid placeholder", () => {
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "mirrors" }), "claude-84213-mirrors");
});

test("canonicalTabTitle without a word is the bare pid placeholder", () => {
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "" }), "claude-84213");
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "   " }), "claude-84213");
});

test("canonicalTabTitle rejects words the title grammar can't hold", () => {
  assert.equal(canonicalTabTitle({ pid: 1, deckName: "two words" }), "claude-1");
  assert.equal(canonicalTabTitle({ pid: 1, deckName: "x".repeat(25) }), "claude-1");
});

test("canonicalTabTitle keeps hyphenated words", () => {
  assert.equal(canonicalTabTitle({ pid: 7, deckName: "pizza-fan" }), "claude-7-pizza-fan");
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
