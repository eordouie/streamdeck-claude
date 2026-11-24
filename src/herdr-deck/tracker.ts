import { composeDeck, MAX_PAGES, type DeckView } from "./deck-view.js";
import type { RawSnapshot } from "./herdr-client.js";
import { secondWords } from "./labels.js";
import { assignMascots, sameMemory, type MascotMemory } from "./mascot-pool.js";
import { toDeckAgents, type DeckAgent } from "./model.js";
import { rankAgents } from "./rank.js";
import { continues, settle, type SettleState } from "./settle.js";

/** A single slow or failed read must not blank the deck; herdr away for
 *  longer than this does. */
export const OFFLINE_GRACE_MS = 3000;

export interface TrackerDeps {
  read: () => Promise<RawSnapshot>;
  now: () => number;
  /** How many animals exist. */
  poolSize: number;
  /** The animal memory loaded at start. */
  memory: MascotMemory;
  saveMemory: (memory: MascotMemory) => void;
  log: (line: string) => void;
}

export interface DeckTracker {
  /** Read herdr and return what the keys should show. `perPage` = agent keys on the deck. */
  poll(perPage: number): Promise<DeckView>;
  /** The arrow key: switch between the two pages (a no-op with one page). */
  flipPage(perPage: number): DeckView;
  /** The last view, for redrawing animation frames between polls. */
  view(): DeckView;
}

/** The state that outlives one poll: the settle hold, when agents finished,
 *  which animal each has, the page showing, and what each key shows. */
export function createDeckTracker(deps: TrackerDeps): DeckTracker {
  let settleState: SettleState = new Map();
  const doneSince = new Map<string, number>();
  let memory = deps.memory;
  let ranked: DeckAgent[] = [];
  let page = 1;
  let offline = false;
  let lastGoodAt: number | undefined;
  let saved = deps.memory;
  let saveError = false;
  let current: DeckView = { keys: [], pager: { page: 1, pages: 1, more: 0, alert: false, offline: false } };

  function compose(perPage: number, now: number): DeckView {
    current = composeDeck({ ranked, page, perPage, mascots: memory, words: secondWords(ranked), doneSince, now, offline });
    page = current.pager.page;
    return current;
  }

  async function poll(perPage: number): Promise<DeckView> {
    let raw: RawSnapshot;
    try {
      raw = await deps.read();
    } catch (err) {
      const now = deps.now();
      if (!offline && lastGoodAt !== undefined && now - lastGoodAt < OFFLINE_GRACE_MS) return current;
      if (!offline) deps.log(`herdr unreachable: ${err instanceof Error ? err.message : String(err)}`);
      offline = true;
      ranked = [];
      settleState = new Map();
      doneSince.clear();
      return compose(perPage, now);
    }
    if (offline) deps.log("herdr reachable");
    offline = false;
    const now = deps.now();
    lastGoodAt = now;

    const agents = toDeckAgents(raw);
    const settled = settle(settleState, agents, now);
    for (const a of agents) {
      const before = settleState.get(a.paneId);
      const after = settled.state.get(a.paneId)!;
      if (!before || !continues(before, a) || after.shown !== "done") doneSince.delete(a.paneId);
      else if (before.shown !== "done") doneSince.set(a.paneId, now);
    }
    for (const paneId of [...doneSince.keys()]) if (!settled.state.has(paneId)) doneSince.delete(paneId);
    settleState = settled.state;
    ranked = rankAgents(settled.agents);

    memory = assignMascots(memory, ranked, perPage * MAX_PAGES, deps.poolSize);
    if (!sameMemory(memory, saved)) {
      try {
        deps.saveMemory(memory);
        saved = memory;
        saveError = false;
      } catch (err) {
        if (!saveError) deps.log(`animal memory save failed: ${String(err)}`);
        saveError = true;
      }
    }
    return compose(perPage, now);
  }

  function flipPage(perPage: number): DeckView {
    page = page === 1 ? 2 : 1;
    return compose(perPage, deps.now());
  }

  return {
    poll,
    flipPage,
    view: () => current,
  };
}
