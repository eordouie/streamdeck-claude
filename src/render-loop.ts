import streamDeck from "@elgato/streamdeck";
import { isAnimated, renderIcon, renderKillArming } from "./icons/index.js";
import type { SlotAction } from "./slot-action.js";
import { KILL_PRESS_MS, LONG_PRESS_MS } from "./slot-action.js";
import type { DisplayEntry } from "./state-tracker.js";
import { liveBgAgents } from "./session-events.js";
import { canonicalTabTitle } from "./tab-title.js";
import { PendingLaunches } from "./pending-launch.js";
import { currentTabs } from "./tab-order.js";
import { planSlots, type TabEntry } from "./slot-plan.js";

/** Keys left empty by the last render — the animation loop blinks their
 *  mascots. Counted from the plan, not from `entries < keys`: with the strip
 *  mirrored, a key can be empty while sessions are hidden (a tab with no
 *  agent in it beside more sessions than keys). */
let lastEmptyKeys = 0;
/** The last key plan logged, so a change in who sits where is one log line
 *  (the deck itself is the only other record of it). */
let lastPlanLine = "";

export function emptyKeyCount(): number {
  return lastEmptyKeys;
}

/** Start-order fill, used only while no tab strip has ever been read (no
 *  Automation grant, Ghostty without the dictionary, another platform): a
 *  key reserved by a just-opened tab waits for the session that registers
 *  from it (launch id), the rest fill top-left to bottom-right. */
function legacyPlan(
  entries: DisplayEntry[],
  ordered: readonly { id: string }[],
  pendingLaunches: PendingLaunches,
): { assigned: Array<DisplayEntry | undefined>; hidden: number } {
  const assigned: Array<DisplayEntry | undefined> = Array.from({ length: ordered.length });
  const consumed = new Set<DisplayEntry>();
  for (const entry of entries) {
    const actionId = pendingLaunches.match(entry.session);
    if (!actionId) continue;
    const index = ordered.findIndex((action) => action.id === actionId);
    if (index >= 0 && assigned[index] === undefined) {
      assigned[index] = entry;
      consumed.add(entry);
    }
  }
  let nextEntry = 0;
  for (let i = 0; i < assigned.length; i++) {
    if (assigned[i] !== undefined || pendingLaunches.get(ordered[i].id)) continue;
    while (nextEntry < entries.length && consumed.has(entries[nextEntry])) nextEntry++;
    if (nextEntry < entries.length) {
      assigned[i] = entries[nextEntry];
      consumed.add(entries[nextEntry]);
      nextEntry++;
    }
  }
  // Sessions with no key left to appear on. Surfaced on the last slot so a
  // session beyond the deck's capacity is visibly hidden rather than simply
  // absent — absent and not-running look identical otherwise.
  const reserved = pendingLaunches.values().length;
  const hidden = Math.max(0, entries.length - (ordered.length - reserved));
  return { assigned, hidden };
}

/**
 * Walks the ordered action instances and pushes the right SVG onto each key.
 * Per-slot dedup lives in `slotAction.getState(id).lastSvg` — if the SVG is
 * unchanged we skip the setImage call but still refresh the clipboard payload
 * (cwd may have moved underneath us between ticks for the same sessionId).
 */
export async function renderAll(
  slotAction: SlotAction,
  entries: DisplayEntry[],
  frame: number,
  pendingLaunches: PendingLaunches,
): Promise<void> {
  const ordered = slotAction.orderedActions();
  pendingLaunches.expire();
  // Key N mirrors Ghostty tab N once the strip has been read (tab-order.ts).
  // The press-reservation is irrelevant then: a new tab opens at the end of
  // the strip, so its session shows on the first key past the strip whatever
  // key was pressed — the strip, not the gesture, decides.
  const strip = currentTabs();
  let assigned: Array<DisplayEntry | undefined>;
  let tabs: Array<TabEntry | undefined>;
  let hidden: number;
  if (strip !== null) {
    const plan = planSlots(entries, strip, ordered.length);
    assigned = plan.assigned;
    tabs = plan.tabs;
    hidden = plan.hidden;
  } else {
    ({ assigned, hidden } = legacyPlan(entries, ordered, pendingLaunches));
    tabs = Array.from({ length: ordered.length });
  }
  lastEmptyKeys = assigned.filter((e) => e === undefined).length;
  const planLine = assigned
    .map((e, i) => `${i + 1}=${e ? `${e.session.pid ?? "?"}:${e.session.label}` : tabs[i] ? `(tab ${tabs[i]!.index})` : "-"}`)
    .join(" ") + (hidden > 0 ? ` hidden=${hidden}` : "") + (strip === null ? " (start order: no strip read yet)" : "");
  if (planLine !== lastPlanLine) {
    streamDeck.logger.info(`keys: ${planLine}`);
    lastPlanLine = planLine;
  }
  const pending: Promise<void>[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const action = ordered[i];
    const entry = assigned[i];
    const slotIndex = i + 1;
    // A slot reserved by a just-opened tab renders exactly like a free one: the
    // tab is sitting at a bare prompt until the user types an agent, so a
    // walking mascot would be claiming a session that does not exist yet. The
    // reservation is invisible on purpose — the new tab is the feedback.
    const state = entry?.state ?? "empty";
    const label = entry?.session.label ?? "";
    const todos = entry?.session.todos;
    // Animate the frame when the motif itself animates, OR when an in-progress
    // todo square needs to pulse (renderTodoColumn reads `frame` for the wave).
    const animateFrame =
      isAnimated(state) || entry?.attention === true || (todos && todos.some((s) => s === "in_progress"));
    const useFrame = animateFrame ? frame : 0;

    const svg = entry
      ? renderIcon({
          state,
          slot: slotIndex,
          label,
          providerLabel: entry.session.providerLabel,
          frame: useFrame,
          todos,
          attention: entry.attention,
          awaitingReply: entry.awaitingReply,
          overflow: i === ordered.length - 1 ? hidden : 0,
          // Computed here, with a live clock, so TTL expiry takes effect on
          // the next tick even when the event log hasn't changed.
          bgAgents: state === "finished" ? 0 : liveBgAgents(entry.session.agentLastSeen, Date.now()),
        })
      : renderIcon({ state: "empty", slot: slotIndex, label: "", frame: 0 });
    const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");

    const slotState = slotAction.getState(action.id);
    if (!slotState) continue;
    slotState.clipboardPayload = entry?.session.cwd;
    slotState.sessionId = entry?.session.sessionId;
    slotState.origin = entry?.session.origin;
    slotState.provider = entry?.session.provider;
    slotState.terminal = entry?.session.terminal;
    slotState.canonicalTitle = entry ? canonicalTabTitle(entry.session) : undefined;
    slotState.pid = entry?.session.pid;
    // An empty key inside the strip mirrors a tab with no agent in it; a
    // press selects that tab instead of opening another one.
    slotState.tab = entry ? undefined : tabs[i];
    // entry undefined (slot vide) → killable=true, sans risque : onKeyDown sort tôt sur un slot vide avant de lire ce flag.
    // Killable for BOTH providers: the bridge now records the real codex pid
    // (walked up from the hook, verified to be the codex binary), so a kill-hold
    // signals the actual agent rather than a wrapper shell. Excluding Codex here
    // was one of the gratuitous provider differences.
    // Killable for bg jobs too: the pid on a claimed job's json is its own
    // dedicated process, not the shared --bg-spare daemon the old exclusion was
    // written to protect. A bg job you cannot kill from the deck is a tile you
    // cannot clear — this one outlived its session by a day.
    slotState.killable = entry?.session.pid !== undefined;
    // Where a short press lands. A bg job has no tab of its own, so it borrows
    // the tab of the session that parked it; undefined when that session is
    // gone, which the press reports rather than hunting for a tab that cannot
    // exist.
    slotState.focusTarget = !entry
      ? undefined
      : entry.session.kind === "bg"
        ? entry.session.owner
        : {
            cwd: entry.session.cwd,
            terminal: entry.session.terminal,
            origin: entry.session.origin,
            pid: entry.session.pid,
            canonicalTitle: canonicalTabTitle(entry.session),
          };

    // Hold passé LONG_PRESS_MS : on masque l'état normal par l'anneau "KILL"
    // tant que la touche reste enfoncée (killArmingSince posé par SlotAction).
    if (slotState.killArmingSince !== undefined) {
      const elapsed = Date.now() - slotState.killArmingSince;
      const progress = Math.max(0, Math.min(1, elapsed / (KILL_PRESS_MS - LONG_PRESS_MS)));
      const killSvg = renderKillArming({ slot: slotIndex, label, progress });
      const killUrl = "data:image/svg+xml;base64," + Buffer.from(killSvg, "utf8").toString("base64");
      if (slotState.lastSvg !== killUrl) {
        // lastSvg only records DELIVERED frames: recording before the send
        // resolves let a failed setImage poison the dedup — the key kept the
        // old image while every subsequent identical frame was skipped.
        pending.push(
          action.setImage(killUrl).then(
            () => {
              slotState.lastSvg = killUrl;
            },
            (err) => {
              streamDeck.logger.error(`setImage(kill) failed for slot ${slotIndex}`, err);
            },
          ),
        );
      }
      continue;
    }

    if (slotState.lastSvg === dataUrl) continue;
    pending.push(
      action.setImage(dataUrl).then(
        () => {
          slotState.lastSvg = dataUrl;
        },
        (err) => {
          streamDeck.logger.error(`setImage failed for slot ${slotIndex}`, err);
        },
      ),
    );
  }
  await Promise.all(pending);
}
