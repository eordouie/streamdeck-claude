#!/usr/bin/env node
// Animated gallery of every mascot, drawn in the browser by the plugin's own
// renderer. Run: node scripts/mascot-gallery.mjs   then open the printed file.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esbuildDir = readdirSync(resolve(root, "node_modules/.pnpm")).find((d) => d.startsWith("esbuild@"));
const esbuild = resolve(root, "node_modules/.pnpm", esbuildDir, "node_modules/esbuild/bin/esbuild");
const bundle = (entry, name) =>
  execFileSync(esbuild, [resolve(root, entry), "--bundle", "--format=iife", `--global-name=${name}`, "--log-level=warning"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

const ORIGINALS = ["clawd", "trex", "sauropod", "goose", "elephant", "stego", "llama", "panda"];
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Deck mascots</title>
<style>
body{background:#181825;color:#cdd6f4;font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;margin:0;padding:24px 28px 60px}
h1{font-size:22px;margin:0 0 6px} p{color:#a6adc8;margin:0 0 18px;max-width:72ch}
.grid{display:grid;grid-template-columns:repeat(7,max-content);gap:18px 22px}
figure{margin:0;display:grid;grid-template-columns:72px 72px 144px 144px;gap:8px;align-items:end;background:#000;padding:12px;border-radius:14px}
figcaption{grid-column:1/-1;color:#a6adc8;font-size:13px}
.key{border-radius:14%;overflow:hidden} .key svg{display:block;width:100%;height:100%}
.s{width:72px;height:72px} .b{width:144px;height:144px}
</style></head><body>
<h1>The 28 deck animals</h1>
<p>Each animal resting (blue) and walking (amber), at the key's true 72 px and enlarged twice. Drawn live by the plugin's own code.</p>
<div class="grid" id="grid"></div>
<script>${bundle("src/icons/index.ts", "Icons")}</script>
<script>${bundle("src/icons/motifs.ts", "Motifs")}</script>
<script>
const ORIGINALS = ${JSON.stringify(ORIGINALS)};
const names = Motifs.MASCOTS.map((m, i) => m.name || ORIGINALS[i] || "animal " + (i + 1));
const grid = document.getElementById("grid");
grid.innerHTML = names.map((n, i) => '<figure><div class="key s"></div><div class="key s"></div><div class="key b"></div><div class="key b"></div><figcaption>' + (i + 1) + ". " + n + "</figcaption></figure>").join("");
let frame = 0;
function tick() {
  frame = (frame + 1) % Icons.ANIMATION_FRAMES;
  names.forEach((n, i) => {
    const cells = grid.children[i].querySelectorAll(".key");
    const rest = Icons.renderIcon({ state: "idle", slot: i + 1, label: n, lines: { top: n }, frame, now: Date.now() });
    const walk = Icons.renderIcon({ state: "working", slot: i + 1, label: n, lines: { top: n }, frame, now: Date.now() });
    cells[0].innerHTML = rest; cells[1].innerHTML = walk; cells[2].innerHTML = rest; cells[3].innerHTML = walk;
  });
}
tick();
setInterval(tick, 120);
</script></body></html>`;

const out = resolve(root, ".cache/mascot-gallery.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(out);
