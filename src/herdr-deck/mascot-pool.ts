import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DeckAgent } from "./model.js";

export interface MascotEntry {
  /** 0-based position in the MASCOTS roster. */
  index: number;
  /** The agent's session when the animal was given; finds the agent again if herdr renumbers its pane. */
  sessionId: string;
}
/** Which pane has which animal. */
export type MascotMemory = Record<string, MascotEntry>;

/** Give every agent that has a key an animal no other key shows. `ranked` is
 *  every live agent in deck order; the first `shownCount` have keys. */
export function assignMascots(
  memory: MascotMemory,
  ranked: readonly DeckAgent[],
  shownCount: number,
  poolSize: number,
): MascotMemory {
  if (Math.min(shownCount, ranked.length) > poolSize) {
    throw new RangeError("each agent key needs a distinct animal");
  }
  const next: MascotMemory = {};
  const used = new Set<number>();
  const give = (a: DeckAgent, index: number, priorSession = ""): void => {
    next[a.paneId] = { index, sessionId: a.sessionId || priorSession };
    used.add(index);
  };
  const usable = (e: MascotEntry | undefined): e is MascotEntry =>
    e !== undefined && Number.isInteger(e.index) && e.index >= 0 && e.index < poolSize && !used.has(e.index);

  // Reserve exact identities first, then match a unique session across a pane
  // move or restart. A new occupant cannot steal a returning session's animal.
  for (const a of ranked) {
    const e = memory[a.paneId];
    if (a.sessionId && e?.sessionId === a.sessionId && usable(e)) give(a, e.index);
  }
  for (const a of ranked) {
    if (!a.sessionId || next[a.paneId]) continue;
    const hits = Object.values(memory).filter(e => e.sessionId === a.sessionId && usable(e));
    if (hits.length === 1 && ranked.filter(b => b.sessionId === a.sessionId).length === 1) give(a, hits[0].index);
  }
  for (const a of ranked) {
    const e = memory[a.paneId];
    if (!next[a.paneId] && usable(e) && (!a.sessionId || !e.sessionId)) give(a, e.index, e.sessionId);
  }
  // Every agent with a key and no animal takes a free one, or the animal of
  // the lowest agent without a key.
  for (const a of ranked.slice(0, shownCount)) {
    if (next[a.paneId]) continue;
    let index = -1;
    for (let i = 0; i < poolSize; i++) {
      if (!used.has(i)) {
        index = i;
        break;
      }
    }
    for (let r = ranked.length - 1; index < 0 && r >= shownCount; r--) {
      const donor = next[ranked[r].paneId];
      if (donor) {
        index = donor.index;
        delete next[ranked[r].paneId];
      }
    }
    if (index < 0) throw new Error("no free or off-deck animal");
    give(a, index);
  }
  return next;
}

export function sameMemory(a: MascotMemory, b: MascotMemory): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => b[k] !== undefined && b[k].index === a[k].index && b[k].sessionId === a[k].sessionId)
  );
}

/** Read the state file. A missing or damaged file is an empty memory: the
 *  worst case is that agents draw new animals once. */
export function loadMemory(path: string): MascotMemory {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  const mascots = (raw as { mascots?: unknown } | null)?.mascots;
  if (typeof mascots !== "object" || mascots === null) return {};
  const out: MascotMemory = {};
  const used = new Set<number>();
  for (const [paneId, value] of Object.entries(mascots as Record<string, unknown>)) {
    const e = value as Partial<MascotEntry> | null;
    if (typeof e !== "object" || e === null) continue;
    if (!Number.isInteger(e.index) || (e.index as number) < 0 || used.has(e.index as number)) continue;
    used.add(e.index as number);
    out[paneId] = { index: e.index as number, sessionId: typeof e.sessionId === "string" ? e.sessionId : "" };
  }
  return out;
}

/** Write through a temporary file, so a crash mid-write cannot leave half a file. */
export function saveMemory(path: string, memory: MascotMemory): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, mascots: memory }, null, 2)}\n`);
  renameSync(tmp, path);
}
