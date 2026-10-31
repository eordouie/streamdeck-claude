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

// --- readNamingContext / extractNamingContext ---

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractNamingContext, readNamingContext } from "./transcript-title.js";
import { NAMING_FIRST_PROMPT_CHARS, NAMING_LATER_PROMPT_CHARS, NAMING_REPLY_CHARS } from "./naming-policy.js";

const j = (o: unknown) => JSON.stringify(o);

test("extractNamingContext finds the first plain-string user prompt among metadata, with its time and reply", () => {
  const text = [
    j({ type: "last-prompt" }),
    j({ type: "mode" }),
    j({ type: "attachment" }),
    j({ type: "user", timestamp: "2026-10-31T16:22:47.752Z", message: { role: "user", content: "I want to start working on the mirror optimizer" } }),
    j({ type: "assistant", message: { role: "assistant", content: "ok" } }),
  ].join("\n");
  assert.deepEqual(extractNamingContext(text), {
    prompts: ["I want to start working on the mirror optimizer"],
    reply: "ok",
    firstPromptAt: Date.parse("2026-10-31T16:22:47.752Z"),
  });
});

test("extractNamingContext skips isMeta, tool_result arrays, command wrappers, and trivial prompts", () => {
  const text = [
    j({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /x/y/z" }] } }),
    j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "stuff" }] } }),
    j({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
    j({ type: "user", message: { content: "go ahead" } }),
    j({ type: "user", message: { content: [{ type: "text", text: "please fix the flux map units" }] } }),
  ].join("\n");
  assert.deepEqual(extractNamingContext(text), { prompts: ["please fix the flux map units"], reply: "", firstPromptAt: 0 });
});

test("extractNamingContext takes the assistant's first TEXT after the first prompt, not thinking or tool calls", () => {
  const text = [
    j({ type: "assistant", message: { content: [{ type: "text", text: "a greeting from before any prompt" }] } }),
    j({ type: "user", timestamp: "2026-10-31T16:22:47.752Z", message: { content: "the new version of heresder is came out, is it worth moving" } }),
    j({ type: "assistant", message: { content: [{ type: "thinking", thinking: "herdr is a multiplexer" }, { type: "tool_use", id: "t1", name: "Bash", input: {} }] } }),
    j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "log text" }] } }),
    j({ type: "assistant", message: { content: [{ type: "text", text: "  Reading the herdr evaluation log first.  " }] } }),
    j({ type: "assistant", message: { content: [{ type: "text", text: "a later reply that must not replace the first" }] } }),
    j({ type: "user", message: { content: "and also check the keyboard shortcuts" } }),
  ].join("\n");
  assert.deepEqual(extractNamingContext(text), {
    prompts: ["the new version of heresder is came out, is it worth moving", "and also check the keyboard shortcuts"],
    reply: "Reading the herdr evaluation log first.",
    firstPromptAt: Date.parse("2026-10-31T16:22:47.752Z"),
  });
});

test("extractNamingContext keeps the full first prompt, clips the rest, and survives a partial trailing line", () => {
  const long = "investigate the " + "x".repeat(2000);
  const reply = "r".repeat(1000);
  const text = [
    j({ type: "user", message: { content: long } }),
    j({ type: "assistant", message: { content: reply } }),
    j({ type: "user", message: { content: long } }),
    '{"type":"user","mess',
  ].join("\n");
  const ctx = extractNamingContext(text);
  assert.equal(ctx.prompts[0], long.slice(0, NAMING_FIRST_PROMPT_CHARS));
  assert.equal(ctx.prompts[1], long.slice(0, NAMING_LATER_PROMPT_CHARS));
  assert.equal(ctx.reply, reply.slice(0, NAMING_REPLY_CHARS));
});

test("extractNamingContext is empty when nothing qualifies", () => {
  assert.deepEqual(extractNamingContext(j({ type: "summary", summary: "old topic" })), { prompts: [], reply: "", firstPromptAt: 0 });
});

test("readNamingContext finds a reply 600 KB in, behind the attachment entries, and a line completed by a later append", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naming-scan-"));
  try {
    const p = join(dir, "s.jsonl");
    const filler = Array.from({ length: 30 }, () => j({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "x".repeat(20_000) }] } }));
    const replyLine = j({ type: "assistant", message: { content: [{ type: "text", text: "Reading the herdr evaluation log first." }] } });
    await writeFile(p, [j({ type: "user", timestamp: "2026-10-31T16:22:47.752Z", message: { content: "the new version of heresder is came out, worth moving?" } }), ...filler].join("\n") + "\n" + replyLine.slice(0, 40));
    const partial = await readNamingContext(p);
    assert.equal(partial.prompts.length, 1);
    assert.equal(partial.reply, ""); // the reply line is still being written
    await writeFile(p, [j({ type: "user", timestamp: "2026-10-31T16:22:47.752Z", message: { content: "the new version of heresder is came out, worth moving?" } }), ...filler].join("\n") + "\n" + replyLine + "\n");
    const full = await readNamingContext(p);
    assert.equal(full.reply, "Reading the herdr evaluation log first.");
    assert.equal(full.firstPromptAt, Date.parse("2026-10-31T16:22:47.752Z"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readNamingContext reads a real file, re-reads a partial context when the file grows, caches a full one; missing file is empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-prompt-"));
  try {
    const p = join(dir, "s.jsonl");
    await writeFile(p, j({ type: "user", message: { content: "tune the receiver aperture model" } }) + "\n");
    assert.deepEqual(await readNamingContext(p), { prompts: ["tune the receiver aperture model"], reply: "", firstPromptAt: 0 });
    await writeFile(p, j({ type: "user", message: { content: "tune the receiver aperture model" } }) + "\n" + j({ type: "assistant", message: { content: "Opening the aperture study." } }) + "\n");
    const grown = await readNamingContext(p);
    assert.equal(grown.reply, "Opening the aperture study.");
    assert.deepEqual(await readNamingContext(join(dir, "missing.jsonl")), { prompts: [], reply: "", firstPromptAt: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
