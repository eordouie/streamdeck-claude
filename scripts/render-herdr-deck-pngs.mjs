#!/usr/bin/env node
// Rasterize the herdr deck's manifest PNGs. Run: pnpm deck:pngs
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "com.eordouie.herdrdeck.sdPlugin/imgs");
const { renderIcon } = await import(pathToFileURL(resolve(root, "src/icons/index.ts")).href);
const { emptyKeySvg, pagerKeySvg } = await import(pathToFileURL(resolve(root, "src/herdr-deck/key-svg.ts")).href);

// A fixed clock: the stegosaurus stands centred with its eyes open, and the files are reproducible.
const realNow = Date.now;
Date.now = () => 5200;
const hero = renderIcon({ state: "idle", slot: 6, label: "herdr", lines: { top: "herdr" }, frame: 0, now: 0 });
Date.now = realNow;

// White on transparent, as the app's action list expects: a key outline holding three agents.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" rx="7" fill="none" stroke="#fff" stroke-width="3"/><rect x="11" y="12" width="18" height="4" rx="2" fill="#fff"/><rect x="11" y="19" width="12" height="4" rx="2" fill="#fff"/><rect x="11" y="26" width="15" height="4" rx="2" fill="#fff"/></svg>`;
const arrow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" rx="7" fill="none" stroke="#fff" stroke-width="3"/><path d="M16 12 L28 20 L16 28 Z" fill="#fff"/></svg>`;

const targets = [
  [hero, "plugin/marketplace.png", 144],
  [hero, "plugin/marketplace@2x.png", 288],
  [glyph, "plugin/category-icon.png", 28],
  [glyph, "plugin/category-icon@2x.png", 56],
  [glyph, "actions/agent/icon.png", 40],
  [glyph, "actions/agent/icon@2x.png", 80],
  [emptyKeySvg(), "actions/agent/key.png", 144],
  [emptyKeySvg(), "actions/agent/key@2x.png", 288],
  [arrow, "actions/pager/icon.png", 40],
  [arrow, "actions/pager/icon@2x.png", 80],
  [pagerKeySvg({ page: 1, pages: 1, more: 0, alert: false, offline: false }, 0), "actions/pager/key.png", 144],
  [pagerKeySvg({ page: 1, pages: 1, more: 0, alert: false, offline: false }, 0), "actions/pager/key@2x.png", 288],
];
for (const [svg, file, size] of targets) {
  const path = resolve(out, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true } }).render().asPng());
  console.log(`  ${relative(root, path)} (${size}x${size})`);
}
