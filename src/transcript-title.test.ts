import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFromTitle, lastJsonString } from "./transcript-title.js";

test("labelFromTitle drops stopwords and fits 1-2 words", () => {
  assert.equal(labelFromTitle("Set up Stream Deck for Claude work in Ghostty"), "Stream Deck");
  assert.equal(labelFromTitle("Fix the mirror optimizer energy pane"), "mirror");
  assert.equal(labelFromTitle("Tolerance budget review"), "Tolerance");
});

test("labelFromTitle falls back to raw words when all are stopwords", () => {
  assert.equal(labelFromTitle("Set up"), "Set up");
});

test("labelFromTitle handles empty titles", () => {
  assert.equal(labelFromTitle(""), "");
  assert.equal(labelFromTitle("   "), "");
});

test("lastJsonString unescapes and takes the last occurrence", () => {
  const text = '{"aiTitle":"First topic"}\n{"aiTitle":"Second \\"quoted\\" topic"}';
  assert.equal(lastJsonString(text, "aiTitle"), 'Second "quoted" topic');
});
