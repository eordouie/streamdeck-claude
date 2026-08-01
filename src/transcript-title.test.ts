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
