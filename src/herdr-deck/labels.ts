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

/** The words under the animal, for agents that share a project name and for
 *  no others. One word when one word tells them apart: the tab name when every
 *  one of them sits in a tab he named and the names differ, else the agent
 *  kind when the kinds differ. Otherwise each agent gets the word that is its
 *  own (its typed tab, else its kind), and where a typed tab is shared the
 *  kind follows as a second word: two tabs that each hold a claude and a codex
 *  read "streamdeck" / "codex", not "streamdeck 2". What is still equal after
 *  that is numbered on its last word, in pane order. */
export function secondWords(agents: readonly DeckAgent[]): Map<string, string[]> {
  const groups = new Map<string, DeckAgent[]>();
  for (const a of agents) groups.set(a.workspace, [...(groups.get(a.workspace) ?? []), a]);
  const out = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byTab = (a: DeckAgent): string => typedTab(a.tab);
    const byKind = (a: DeckAgent): string => a.kind;
    const tellsApart = (word: (a: DeckAgent) => string): boolean =>
      group.every((a) => word(a) !== "") && new Set(group.map(word)).size === group.length;
    const own = (a: DeckAgent): string => byTab(a) || byKind(a);
    const shared = (a: DeckAgent): boolean => group.filter((b) => own(b) === own(a)).length > 1;
    const plain = tellsApart(byTab)
      ? (a: DeckAgent): string[] => [byTab(a)]
      : tellsApart(byKind)
        ? (a: DeckAgent): string[] => [byKind(a)]
        : (a: DeckAgent): string[] => (shared(a) && byTab(a) ? [byTab(a), byKind(a)] : [own(a)]);
    const joined = (words: readonly string[]): string => words.join("\n");
    // A number is never allowed to produce a label another agent already has in plain form.
    const reserved = new Set(group.map((a) => joined(plain(a))));
    const taken = new Set<string>();
    const labels = new Map<string, string[]>();
    const inPaneOrder = [...group].sort((a, b) => paneNumber(a.paneId) - paneNumber(b.paneId) || a.paneId.localeCompare(b.paneId));
    for (const a of inPaneOrder) {
      let words = plain(a);
      if (taken.has(joined(words))) {
        const head = words.slice(0, -1);
        const last = words[words.length - 1];
        let n = 2;
        do {
          words = [...head, `${last} ${n++}`];
        } while (reserved.has(joined(words)) || taken.has(joined(words)));
      }
      labels.set(a.paneId, words);
      taken.add(joined(words));
    }
    for (const a of group) out.set(a.paneId, labels.get(a.paneId) ?? []);
  }
  return out;
}

/** The three text lines of a key. A long project name keeps the first line
 *  below the animal for its remainder, so the telling words share the last. */
export function keyLines(agent: DeckAgent, words: readonly string[]): KeyLines {
  const { top, rest } = splitProject(agent.workspace);
  if (rest) return { top, line1: rest, line2: words.join(" ") };
  return { top, line1: words[0] ?? "", line2: words[1] ?? "" };
}
