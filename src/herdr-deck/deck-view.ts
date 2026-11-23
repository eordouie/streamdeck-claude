import type { SessionState } from "../icons/index.js";
import { keyLines, type KeyLines } from "./labels.js";
import type { MascotMemory } from "./mascot-pool.js";
import type { DeckAgent } from "./model.js";

export const MAX_PAGES = 2;
/** How long a finished agent flashes before it settles to the white dot. */
export const FLASH_MS = 60_000;

export interface AgentKeyView {
  kind: "agent";
  paneId: string;
  terminalId: string;
  sessionId: string;
  /** The old deck's look: the mascot walks ("working"), rests ("idle"), or its resting animal pulses orange ("blocked"). */
  state: SessionState;
  /** 1-based animal, as `renderIcon` counts. */
  slot: number;
  lines: KeyLines;
  /** Flash: finished within the last FLASH_MS. */
  attention: boolean;
  /** White corner dot: finished and not yet looked at. */
  awaitingReply: boolean;
}
export type KeyView = AgentKeyView | { kind: "empty" };

export interface PagerView {
  page: number;
  pages: number;
  /** Agents that have no key on either page. The same on both pages: the old
   *  deck's "+N" badge meant exactly this, and a count that mixed "on the next
   *  page" with "nowhere on the deck" was the one thing the owner could not
   *  read on the hardware (2026-11-23). */
  more: number;
  /** An agent that needs him is not on the page showing. */
  alert: boolean;
  /** herdr cannot be reached. */
  offline: boolean;
}

export interface DeckView {
  /** One entry per agent key, in key order. */
  keys: KeyView[];
  pager: PagerView;
}

export function composeDeck(input: {
  ranked: readonly DeckAgent[];
  page: number;
  /** Agent keys on the deck. */
  perPage: number;
  mascots: MascotMemory;
  words: ReadonlyMap<string, string>;
  /** When the deck saw each finished agent finish. */
  doneSince: ReadonlyMap<string, number>;
  now: number;
  offline: boolean;
}): DeckView {
  const { ranked, perPage, mascots, words, doneSince, now, offline } = input;
  const shown = ranked.slice(0, perPage * MAX_PAGES);
  const pages = perPage > 0 && shown.length > perPage ? MAX_PAGES : 1;
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), pages);
  const start = (page - 1) * perPage;
  const onPage = shown.slice(start, start + perPage);

  const keys: KeyView[] = onPage.map((a): KeyView => {
    const animal = mascots[a.paneId];
    if (!animal) return { kind: "empty" };
    const done = a.status === "done";
    const since = doneSince.get(a.paneId);
    return {
      kind: "agent",
      paneId: a.paneId,
      terminalId: a.terminalId,
      sessionId: a.sessionId,
      state: a.status === "working" ? "working" : a.status === "blocked" ? "blocked" : "idle",
      slot: animal.index + 1,
      lines: keyLines(a, words.get(a.paneId) ?? ""),
      attention: done && since !== undefined && now - since < FLASH_MS,
      awaitingReply: done,
    };
  });
  while (keys.length < perPage) keys.push({ kind: "empty" });

  const visible = new Set(onPage.map((a) => a.paneId));
  return {
    keys,
    pager: {
      page,
      pages,
      more: Math.max(0, ranked.length - perPage * MAX_PAGES),
      alert: ranked.some((a) => a.status === "blocked" && !visible.has(a.paneId)),
      offline,
    },
  };
}
