import { approxWidth } from "../icons/text.js";
import { TOP_FONT, VIEWPORT_W } from "../icons/theme.js";
import type { DeckAgent } from "./model.js";

export interface KeyLines {
  top: string;
  line1: string;
  line2: string;
}

/** Tab names herdr or the owner's standard layout gave, not words he typed
 *  for this tab. The same list the sidebar config hides. */
const DEFAULT_TABS = new Set(["agents", "claude", "codex", "shell"]);

export const typedTab = (tab: string): string => (tab === "" || /^\d+$/.test(tab) || DEFAULT_TABS.has(tab.toLowerCase()) ? "" : tab);

const fitsTop = (text: string): boolean => approxWidth(text, TOP_FONT) <= VIEWPORT_W;

/** The project name on the top line: whole when it fits, otherwise cut at the
 *  last hyphen or space that still fits, the remainder going below. This is
 *  the long-name treatment shown to the owner. A
 *  name with no usable break stays whole and the renderer scrolls it. */
export function splitProject(name: string): { top: string; rest: string } {
  if (fitsTop(name)) return { top: name, rest: "" };
  let cut = -1;
  for (let i = 1; i < name.length - 1; i++) {
    if ((name[i] === "-" || name[i] === " ") && fitsTop(name.slice(0, i))) cut = i;
  }
  return cut < 0 ? { top: name, rest: "" } : { top: name.slice(0, cut), rest: name.slice(cut + 1) };
}

const paneNumber = (paneId: string): number => Number(paneId.split(":p")[1]) || 0;

/** The second word, for agents that share a project name and for no others:
 *  the tab name when every one of them sits in a tab he named and the names
 *  differ; else the agent kind when the kinds differ; else the typed tab or
 *  the kind per agent, numbered in pane order where that still repeats. */
export function secondWords(agents: readonly DeckAgent[]): Map<string, string> {
  const groups = new Map<string, DeckAgent[]>();
  for (const a of agents) groups.set(a.workspace, [...(groups.get(a.workspace) ?? []), a]);
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const tellsApart = (word: (a: DeckAgent) => string): boolean =>
      group.every((a) => word(a) !== "") && new Set(group.map(word)).size === group.length;
    const byTab = (a: DeckAgent): string => typedTab(a.tab);
    const byKind = (a: DeckAgent): string => a.kind;
    const word = tellsApart(byTab) ? byTab : tellsApart(byKind) ? byKind : (a: DeckAgent): string => byTab(a) || byKind(a);
    const reserved = new Set(group.map(word));
    const assigned = new Set<string>();
    const inPaneOrder = [...group].sort((a, b) => paneNumber(a.paneId) - paneNumber(b.paneId) || a.paneId.localeCompare(b.paneId));
    const words = new Map<string, string>();
    for (const a of inPaneOrder) {
      const w = word(a);
      let label = w;
      if (assigned.has(label)) {
        let n = 2;
        do { label = `${w} ${n++}`; } while (reserved.has(label) || assigned.has(label));
      }
      words.set(a.paneId, label);
      assigned.add(label);
    }
    for (const a of group) out.set(a.paneId, words.get(a.paneId) ?? "");
  }
  return out;
}

export function keyLines(agent: DeckAgent, word: string): KeyLines {
  const { top, rest } = splitProject(agent.workspace);
  if (rest && word) return { top, line1: rest, line2: word };
  return { top, line1: rest || word, line2: "" };
}
