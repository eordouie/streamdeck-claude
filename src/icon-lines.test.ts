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

test("every text line is painted before the frame, so the frame's rounded corners cover a long or scrolling line", () => {
  const svg = renderIcon({
    state: "idle", slot: 1, label: "", frame: 0, now: 0,
    lines: { top: "herdr", line1: "customization", line2: "codex" },
  });
  const frame = svg.indexOf('stroke-linejoin="round"');
  assert.ok(frame > 0, "the key has a frame");
  for (const word of ["herdr", "customization", "codex"]) {
    const at = svg.indexOf(`>${word}<`);
    assert.ok(at > 0 && at < frame, `"${word}" comes before the frame in paint order`);
  }
});
