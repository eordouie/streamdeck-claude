import streamDeck, { LogLevel, type KeyAction } from "@elgato/streamdeck";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANIMATION_FRAMES } from "../icons/mascot-kit.js";
import { MASCOTS } from "../icons/motifs.js";
import { AgentKey } from "./agent-key.js";
import type { DeckView } from "./deck-view.js";
import { herdrCall, readSnapshot } from "./herdr-client.js";
import { jumpTo, type Route } from "./jump.js";
import { keySvg, pagerKeySvg, toDataUrl } from "./key-svg.js";
import { loadMemory, saveMemory } from "./mascot-pool.js";
import { PagerKey } from "./pager-key.js";
import { AGENTS_PER_PAGE, keyIndex, PaintedKey, type Target } from "./press.js";
import { readRoute, sameRoute, statePath } from "./route.js";
import { createDeckTracker } from "./tracker.js";

streamDeck.logger.setLevel(LogLevel.INFO);

/** herdr answers a snapshot in under a millisecond; twice a second keeps a key within half a second of its agent. */
const POLL_MS = 500;
/** The old deck's animation tick. */
const ANIMATION_MS = 120;
/** The herdr protocol this was built and measured against. */
const BUILT_FOR_PROTOCOL = 22;

const CONFIG_DIR = join(homedir(), ".config", "herdr-deck");
const RELOAD_FILE = join(CONFIG_DIR, "reload");
const log = (line: string): void => { streamDeck.logger.info(line); };

function initialRoute(): Route | undefined {
  try { return readRoute(CONFIG_DIR); }
  catch (err) { streamDeck.logger.error("invalid deck route", err); return undefined; }
}
const route = initialRoute();
const memoryFile = route && statePath(CONFIG_DIR, route);
if (MASCOTS.length !== AGENTS_PER_PAGE * 2) throw new Error("the deck requires the full 28-animal roster");

const tracker = createDeckTracker({
  read: async () => {
    if (!route) throw new Error("fix config.json and reload");
    return readSnapshot(route.socketPath);
  },
  now: Date.now,
  poolSize: MASCOTS.length,
  memory: memoryFile ? loadMemory(memoryFile) : {},
  saveMemory: memory => { if (memoryFile) saveMemory(memoryFile, memory); },
  log,
});

const painted = new Map<string, PaintedKey>();
let frame = 0;
let polling = false;
let jumping = false;
let lastPlan = "";

function send(key: KeyAction, page: number, svg: string, target?: Target): void {
  let display = painted.get(key.id);
  if (!display) {
    display = new PaintedKey(Date.now);
    painted.set(key.id, display);
  }
  void display.paint(page, toDataUrl(svg), target, url => key.setImage(url))
    .catch(err => streamDeck.logger.error(`setImage failed for ${key.id}`, err));
}

function draw(view: DeckView = tracker.view()): void {
  const now = Date.now();
  const page = view.pager.offline ? 0 : view.pager.page;
  for (const key of agentKey.keys()) {
    const i = keyIndex(key.coordinates);
    const k = i === undefined ? undefined : view.keys[i];
    send(key, page, keySvg(k ?? { kind: "empty" }, frame, now), k?.kind === "agent" ? k : undefined);
  }
  for (const key of pagerKey.keys()) send(key, page, pagerKeySvg(view.pager, frame));
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const view = await tracker.poll(AGENTS_PER_PAGE);
    const plan = `page ${view.pager.page}/${view.pager.pages}: ${view.keys.map(k => k.kind === "agent" ? `${k.paneId}=${k.state}` : "-").join(" ")}`;
    if (plan !== lastPlan) { log(`keys: ${plan}`); lastPlan = plan; }
    draw(view);
  } catch (err) {
    streamDeck.logger.error("poll failed", err);
  } finally {
    polling = false;
  }
}

const keysChanged = (id: string): void => {
  painted.delete(id); // willAppear starts with the manifest image, even if the ID was seen before.
  draw();
};

async function press(key: KeyAction): Promise<void> {
  const target = painted.get(key.id)?.pressed();
  if (!target || tracker.view().pager.offline) return;
  if (jumping || !route) {
    await key.showAlert();
    return;
  }
  jumping = true;
  try {
    if (await jumpTo(route, target, log, { isSelected: () => sameRoute(route, readRoute(CONFIG_DIR)) }) !== "jumped") await key.showAlert();
  } finally {
    jumping = false;
    void poll();
  }
}

const agentKey = new AgentKey(key => {
  void press(key).catch(err => { streamDeck.logger.error("agent press failed", err); });
}, keysChanged);
const pagerKey = new PagerKey(() => { draw(tracker.flipPage(AGENTS_PER_PAGE)); }, keysChanged);

streamDeck.actions.registerAction(agentKey);
streamDeck.actions.registerAction(pagerKey);
await streamDeck.connect();

void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(() => {
  frame = (frame + 1) % ANIMATION_FRAMES;
  // Resting mascots breathe and blink, so every agent key changes most frames.
  draw();
}, ANIMATION_MS);

// `pnpm deck:reload` touches this file; the app respawns a plugin that exits.
const reloadAtStart = ((): number => {
  try {
    return statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return 0;
  }
})();
setInterval(() => {
  let mtime = 0;
  try {
    mtime = statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return;
  }
  if (mtime !== reloadAtStart) {
    log("reload requested; exiting so the app respawns the plugin");
    process.exit(0);
  }
}, 1000);

log(`herdr deck started: ${route?.demo ? "demo" : route ? "live" : "invalid"} socket ${route?.socketPath ?? "none"}, ${MASCOTS.length} animals, poll ${POLL_MS} ms; bundle ${import.meta.url}`);
if (route) herdrCall<{ protocol?: number; version?: string }>(route.socketPath, "ping").then(
  (pong) => {
    if (pong.protocol !== BUILT_FOR_PROTOCOL) {
      streamDeck.logger.warn(`herdr ${pong.version} speaks protocol ${pong.protocol}; this deck was built against ${BUILT_FOR_PROTOCOL}`);
    }
  },
  () => {
    // herdr is not running; the poll says so on the arrow key
  },
);
