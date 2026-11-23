import assert from "node:assert/strict";
import { test } from "node:test";
import { ANIMATION_FRAMES } from "./icons/mascot-kit.js";
import { MASCOTS } from "./icons/motifs.js";

const NEW = [
  "lion", "pterodactyl", "giraffe", "flamingo", "penguin", "snail", "turtle", "crocodile", "frog", "hedgehog",
  "rabbit", "pig", "octopus", "bee", "ladybug", "duckling", "parrot", "kangaroo", "moose", "sheep",
];

test("the roster holds 28 distinct animals, the original eight first", () => {
  assert.equal(MASCOTS.length, 28);
  assert.deepEqual(MASCOTS.slice(0, 8).map(m => m.draw.name), [
    "clawdIdleLook", "dinoIdleLook", "sauropodIdleLook", "gooseIdleLook",
    "elephantIdleLook", "stegoIdleLook", "llamaIdleLook", "pandaIdleLook",
  ]);
  assert.equal(new Set(MASCOTS.map((m) => m.draw)).size, 28);
  assert.deepEqual(MASCOTS.slice(8).map((m) => m.name), NEW);
});

test("every animal draws a well-formed sprite on every frame", () => {
  for (const [i, m] of MASCOTS.entries()) {
    for (let frame = 0; frame < ANIMATION_FRAMES; frame++) {
      const svg = m.draw(frame, i * 700);
      assert.match(svg, /^<g transform="translate\(/, `animal ${i + 1}, frame ${frame}`);
      assert.doesNotMatch(svg, /NaN|undefined|null/, `animal ${i + 1}, frame ${frame}`);
      const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((t) => t[1]));
      assert.deepEqual([...tags].sort(), ["g", "rect"], `animal ${i + 1} uses only <g> and <rect>`);
    }
  }
});

test("every animal faces a direction and stands on the ground line", () => {
  for (const [i, m] of MASCOTS.entries()) {
    assert.ok(m.dir === 1 || m.dir === -1, `animal ${i + 1} dir`);
    assert.ok(m.foot >= 80 && m.foot <= 100, `animal ${i + 1} foot ${m.foot}`);
  }
});
