import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFromTitle, lastJsonString } from "./transcript-title.js";

test("labelFromTitle drops stopwords and takes two significant words", () => {
  assert.equal(labelFromTitle("Set up Stream Deck for Claude work in Ghostty"), "Stream Deck");
  assert.equal(labelFromTitle("Fix the mirror optimizer energy pane"), "mirror optimizer");
  assert.equal(labelFromTitle("Tolerance budget review"), "Tolerance budget");
});

test("labelFromTitle falls back to raw words when all are stopwords", () => {
  assert.equal(labelFromTitle("Set up"), "Set up");
});

test("labelFromTitle handles empty titles", () => {
  assert.equal(labelFromTitle(""), "");
  assert.equal(labelFromTitle("   "), "");
});

test("labelFromTitle distills chat prompts", () => {
  assert.equal(labelFromTitle("when the discussion topic changes update the name too"), "discussion topic");
  assert.equal(labelFromTitle("the ghost is not cute enough"), "ghost cute");
  assert.equal(labelFromTitle("the labels are not working yet"), "labels working");
});

test("lastJsonString unescapes and takes the last occurrence", () => {
  const text = '{"aiTitle":"First topic"}\n{"aiTitle":"Second \\"quoted\\" topic"}';
  assert.equal(lastJsonString(text, "aiTitle"), 'Second "quoted" topic');
});
