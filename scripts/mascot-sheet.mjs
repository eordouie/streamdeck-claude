#!/usr/bin/env node
// Contact sheet for mascot sprites, rasterized through the real renderIcon().
//
//   node_modules/.bin/tsx scripts/mascot-sheet.mjs <name> [<name> ...] [--out file.png]
//   node_modules/.bin/tsx scripts/mascot-sheet.mjs --all [--out file.png]
//
// <name> is one of the original eight (clawd trex sauropod goose elephant
// stego llama panda) or a file src/icons/mascots/<name>.ts exporting a Mascot
// under that name. A candidate that is not in the roster yet is appended to it
// for this run only, so it can be judged before it is registered.
//
// One row per animal: resting (both leg poses), walking (both leg poses),
// eyes closed, needs-you pulse, then the same resting and walking tiles at the
// deck's true 72 px. Pixel art is never judged from coordinates
// (docs/lessons/icon-rendering.md): look at this sheet.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { renderIcon } = await import(pathToFileURL(resolve(root, "src/icons/index.ts")).href);
const { MASCOTS, WALK_PERIOD_MS } = await import(pathToFileURL(resolve(root, "src/icons/motifs.ts")).href);
const { BLINK_PERIOD_MS, BLINK_CLOSED_MS } = await import(pathToFileURL(resolve(root, "src/icons/mascot-kit.ts")).href);
const { NEW_MASCOTS } = await import(pathToFileURL(resolve(root, "src/icons/mascots/index.ts")).href);

const ORIGINALS = ["clawd", "trex", "sauropod", "goose", "elephant", "stego", "llama", "panda"];

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag >= 0 ? resolve(args[outFlag + 1]) : resolve(root, ".cache/mascot-sheets/sheet.png");
const names = args.filter((a, i) => !a.startsWith("--") && !(outFlag >= 0 && i === outFlag + 1));
const all = args.includes("--all");

/** [label, slot] per row. */
const rows = [];
if (all) {
  ORIGINALS.forEach((n, i) => rows.push([n, i + 1]));
  NEW_MASCOTS.forEach((m, i) => rows.push([m.name ?? `new-${i + 1}`, ORIGINALS.length + i + 1]));
}
for (const name of names) {
  const original = ORIGINALS.indexOf(name);
  if (original >= 0) {
    rows.push([name, original + 1]);
    continue;
  }
  const file = resolve(root, `src/icons/mascots/${name}.ts`);
  if (!existsSync(file)) {
    console.error(`no such mascot: ${name} (expected ${file})`);
    process.exit(2);
  }
  const mod = await import(pathToFileURL(file).href);
  const mascot = mod[name] ?? mod.default;
  if (!mascot || typeof mascot.draw !== "function") {
    console.error(`${file} must export a Mascot named "${name}"`);
    process.exit(2);
  }
  let slot = MASCOTS.indexOf(mascot) + 1;
  if (slot === 0) slot = MASCOTS.push(mascot);
  rows.push([name, slot]);
}
if (rows.length === 0) {
  console.error("usage: mascot-sheet.mjs <name> [...] | --all  [--out file.png]");
  process.exit(2);
}

const blinkPhase = (slot) => (slot - 1) * 700;
/** A clock reading at which the walker is centred on the key and its eyes are open. */
function openCentred(slot) {
  for (let k = 1; k < 200; k++) {
    const now = WALK_PERIOD_MS * k;
    if ((now + blinkPhase(slot)) % BLINK_PERIOD_MS >= BLINK_CLOSED_MS + 50) return now;
  }
  return WALK_PERIOD_MS;
}
/** A clock reading inside the blink window. */
const closed = (slot) => BLINK_PERIOD_MS * 40 - blinkPhase(slot) + 20;

const realNow = Date.now;
function tile(opts, now) {
  Date.now = () => now;
  try {
    return renderIcon({ ...opts, now });
  } finally {
    Date.now = realNow;
  }
}
/** Re-root a rendered key as a nested <svg> at (x, y) with the given size. */
const place = (svg, x, y, size) =>
  svg.replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 144 144">`);

const BIG = 288;
const SMALL = 72;
const GAP = 16;
const LABEL_W = 150;
const COLS_BIG = 6;
const width = LABEL_W + COLS_BIG * (BIG + GAP) + 2 * (SMALL + GAP) + GAP;
const rowH = BIG + GAP;
const height = rows.length * rowH + GAP + 30;

const HEAD = ["resting, pose A", "resting, pose B", "walking, pose A", "walking, pose B", "eyes closed", "needs you", "72 px", "72 px"];
let body = `<rect width="${width}" height="${height}" fill="#000"/>`;
HEAD.forEach((h, i) => {
  const x = i < COLS_BIG ? LABEL_W + i * (BIG + GAP) + BIG / 2 : LABEL_W + COLS_BIG * (BIG + GAP) + (i - COLS_BIG) * (SMALL + GAP) + SMALL / 2;
  body += `<text x="${x}" y="20" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#9ca3af" text-anchor="middle">${h}</text>`;
});

rows.forEach(([name, slot], r) => {
  const y = 30 + r * rowH;
  const open = openCentred(slot);
  const base = { slot, label: name };
  const cells = [
    tile({ ...base, state: "idle", frame: 0 }, open),
    tile({ ...base, state: "idle", frame: 3 }, open),
    tile({ ...base, state: "working", frame: 0 }, open),
    tile({ ...base, state: "working", frame: 3 }, open),
    tile({ ...base, state: "idle", frame: 0 }, closed(slot)),
    tile({ ...base, state: "awaiting", frame: 3 }, open),
  ];
  body += `<text x="10" y="${y + BIG / 2}" font-family="Helvetica,Arial,sans-serif" font-size="18" font-weight="700" fill="#e5e7eb">${name}</text>`;
  body += `<text x="10" y="${y + BIG / 2 + 22}" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#9ca3af">slot ${slot}</text>`;
  cells.forEach((svg, i) => {
    body += place(svg, LABEL_W + i * (BIG + GAP), y, BIG);
  });
  const sx = LABEL_W + COLS_BIG * (BIG + GAP);
  body += place(cells[0], sx, y + (BIG - SMALL) / 2, SMALL);
  body += place(cells[2], sx + SMALL + GAP, y + (BIG - SMALL) / 2, SMALL);
});

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

function rasterize(svg) {
  // The pinned resvg occasionally panics on a first call; one retry clears it.
  for (let attempt = 1; ; attempt++) {
    try {
      return new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, rasterize(sheet));
console.log(`wrote ${outPath} (${width}x${height}, ${rows.length} animal${rows.length === 1 ? "" : "s"})`);
