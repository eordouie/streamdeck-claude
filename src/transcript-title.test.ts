import { test } from "node:test";
import assert from "node:assert/strict";
import { lastJsonString } from "./transcript-title.js";

test("lastJsonString unescapes and takes the last occurrence", () => {
  const text = '{"aiTitle":"First topic"}\n{"aiTitle":"Second \\"quoted\\" topic"}';
  assert.equal(lastJsonString(text, "aiTitle"), 'Second "quoted" topic');
});

test("lastJsonString returns empty when the key is absent", () => {
  assert.equal(lastJsonString('{"other":"x"}', "aiTitle"), "");
});

// --- readUserPrompts / extractUserPrompts ---

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractUserPrompts, readUserPrompts } from "./transcript-title.js";

const j = (o: unknown) => JSON.stringify(o);

test("extractUserPrompts finds the first plain-string user prompt among metadata", () => {
  const text = [
    j({ type: "last-prompt" }),
    j({ type: "mode" }),
    j({ type: "attachment" }),
    j({ type: "user", message: { role: "user", content: "I want to start working on the mirror optimizer" } }),
    j({ type: "assistant", message: { role: "assistant", content: "ok" } }),
  ].join("\n");
  assert.deepEqual(extractUserPrompts(text), ["I want to start working on the mirror optimizer"]);
});

test("extractUserPrompts skips isMeta, tool_result arrays, command wrappers, and trivial prompts", () => {
  const text = [
    j({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /x/y/z" }] } }),
    j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "stuff" }] } }),
    j({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
    j({ type: "user", message: { content: "go ahead" } }),
    j({ type: "user", message: { content: [{ type: "text", text: "please fix the flux map units" }] } }),
  ].join("\n");
  assert.deepEqual(extractUserPrompts(text), ["please fix the flux map units"]);
});

test("extractUserPrompts clips to 200 chars and survives a partial trailing line", () => {
  const long = "investigate the " + "x".repeat(300);
  const text = j({ type: "user", message: { content: long } }) + "\n" + '{"type":"user","mess';
  assert.deepEqual(extractUserPrompts(text), [long.slice(0, 200)]);
});

test("extractUserPrompts is empty when nothing qualifies", () => {
  assert.deepEqual(extractUserPrompts(j({ type: "summary", summary: "old topic" })), []);
});

test("readUserPrompts reads a real file and caches; missing file is empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-prompt-"));
  try {
    const p = join(dir, "s.jsonl");
    await writeFile(p, j({ type: "user", message: { content: "tune the receiver aperture model" } }) + "\n");
    assert.deepEqual(await readUserPrompts(p), ["tune the receiver aperture model"]);
    assert.deepEqual(await readUserPrompts(p), ["tune the receiver aperture model"]);
    assert.deepEqual(await readUserPrompts(join(dir, "missing.jsonl")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
