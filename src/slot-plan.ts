/**
 * Pure key planning: which session goes on which deck key.
 *
 * Key N mirrors Ghostty tab N (Cmd+N). The tab strip is read from Ghostty's
 * own AppleScript (tab-order.ts), and a session is joined to its tab by the
 * pid in the terminal title the plugin stamps there (`<provider>-<pid>[-word]`,
 * tab-title.ts). Nothing here guesses a position: a session whose tab cannot
 * be identified goes AFTER the strip, never into it.
 *
 * SDK-free on purpose (see naming-policy.ts for why): unit-tested from bare
 * node.
 */

/** One Ghostty tab, in deck order (front window first, then by index). */
export interface TabEntry {
  windowId: string;
  tabId: string;
  /** 1-based index within its window — what Cmd+N selects there. */
  index: number;
  /** The front window's tabs come first; only they answer to Cmd+N. */
  front: boolean;
  selected: boolean;
  /** The tab's name — a hand-set name when the user renamed it. */
  tab: string;
  /** The focused terminal's title — where the plugin's OSC 2 stamp lands. */
  terminal: string;
}

export interface PlannedSession {
  pid?: number;
  kind: string;
  startedAt: number;
}

export interface SlotPlan<E> {
  /** Per key, top-left to bottom-right: the session shown there, if any. */
  assigned: Array<E | undefined>;
  /** Per key: the Ghostty tab that key mirrors, when the key lies inside
   *  the strip — set whether or not a session sits on it, so an empty key
   *  can still select its tab. */
  tabs: Array<TabEntry | undefined>;
  /** Sessions with no key left to appear on. */
  hidden: number;
}

/** The pid encoded in a title the plugin stamped (`claude-61166-labeling`,
 *  `codex-4021`), or undefined for any other title. The provider prefix is
 *  not checked against the agent list — the shape is the plugin's own. */
export function pidFromStampedTitle(title: string): number | undefined {
  const m = /^[a-z][a-z0-9]*-(\d{1,9})(?:-|$)/i.exec(title.trim());
  return m ? Number(m[1]) : undefined;
}

/** Deck order of a window list: the front window's tabs first (by index),
 *  then the other windows in the order given, each by index. */
export function orderTabs(tabs: readonly TabEntry[]): TabEntry[] {
  const byWindow = new Map<string, TabEntry[]>();
  for (const t of tabs) {
    const list = byWindow.get(t.windowId) ?? [];
    list.push(t);
    byWindow.set(t.windowId, list);
  }
  const windows = [...byWindow.values()].map((list) => list.sort((a, b) => a.index - b.index));
  windows.sort((a, b) => Number(b[0]?.front === true) - Number(a[0]?.front === true));
  return windows.flat();
}

/**
 * Place sessions on keys.
 *
 * - A session whose pid is stamped on tab N takes key N (keys beyond the
 *   deck count as hidden).
 * - Every other session — bg jobs (tab-less by design), sessions in other
 *   terminals, a tab whose stamp has not landed yet — fills the keys after
 *   the strip, in the order given (callers pass start order).
 * - Keys inside the strip that no session claims stay empty: they mirror a
 *   tab without an agent and must not be filled, or key N stops meaning
 *   Cmd+N.
 *
 * `tabs` is the strip in deck order (orderTabs). Two sessions stamped on the
 * same tab (a resumed twin that somehow escaped liveness) keep the first;
 * the other goes after the strip.
 */
export function planSlots<E extends { session: PlannedSession }>(
  entries: readonly E[],
  tabs: readonly TabEntry[],
  slotCount: number,
): SlotPlan<E> {
  const assigned: Array<E | undefined> = Array.from({ length: slotCount });
  const tabForSlot: Array<TabEntry | undefined> = Array.from({ length: slotCount }, (_, i) => tabs[i]);
  const position = new Map<number, number>();
  tabs.forEach((t, i) => {
    const pid = pidFromStampedTitle(t.terminal) ?? pidFromStampedTitle(t.tab);
    if (pid !== undefined && !position.has(pid)) position.set(pid, i);
  });

  const rest: E[] = [];
  let hidden = 0;
  for (const e of entries) {
    const pid = e.session.pid;
    const pos = pid === undefined || e.session.kind === "bg" ? undefined : position.get(pid);
    if (pos === undefined) {
      rest.push(e);
      continue;
    }
    if (pos >= slotCount) {
      hidden++;
      continue;
    }
    if (assigned[pos] !== undefined) {
      rest.push(e);
      continue;
    }
    assigned[pos] = e;
  }

  let next = Math.min(tabs.length, slotCount);
  for (const e of rest) {
    while (next < slotCount && assigned[next] !== undefined) next++;
    if (next >= slotCount) {
      hidden++;
      continue;
    }
    assigned[next] = e;
    next++;
  }
  return { assigned, tabs: tabForSlot, hidden };
}
