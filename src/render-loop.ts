import streamDeck from "@elgato/streamdeck";
import { isAnimated, renderIcon, renderKillArming } from "./icons/index.js";
import type { SlotAction } from "./slot-action.js";
import { KILL_PRESS_MS, LONG_PRESS_MS } from "./slot-action.js";
import type { DisplayEntry } from "./state-tracker.js";

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
): Promise<void> {
  const ordered = slotAction.orderedActions();
  const pending: Promise<void>[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const action = ordered[i];
    const entry = entries[i];
    const slotIndex = i + 1;
    const state = entry?.state ?? "empty";
    const label = entry?.session.label ?? "";
    const todos = entry?.session.todos;
    // Animate the frame when the motif itself animates, OR when an in-progress
    // todo square needs to pulse (renderTodoColumn reads `frame` for the wave).
    const animateFrame =
      isAnimated(state) || entry?.attention === true || (todos && todos.some((s) => s === "in_progress"));
    const useFrame = animateFrame ? frame : 0;

    const svg = entry
      ? renderIcon({ state, slot: slotIndex, label, frame: useFrame, todos, attention: entry.attention })
      : renderIcon({ state: "empty", slot: slotIndex, label: "", frame: 0 });
    const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");

    const slotState = slotAction.getState(action.id);
    if (!slotState) continue;
    slotState.clipboardPayload = entry?.session.cwd;
    slotState.sessionId = entry?.session.sessionId;
    slotState.origin = entry?.session.origin;
    slotState.terminal = entry?.session.terminal;
    slotState.transcriptPath = entry?.session.transcriptPath;
    // Ordinal among UNTITLED interactive sessions in display order — their
    // tabs all read "Claude Code", so position is the only join key. Titled
    // sessions match by title and never use the ordinal; bg agents and
    // finished carry-overs have no tab at all.
    const isUntitledTab = (e: typeof entry) =>
      e !== undefined && e.session.kind !== "bg" && e.state !== "finished" && !e.session.title;
    slotState.tabCount = entries.filter(isUntitledTab).length;
    slotState.tabOrdinal = isUntitledTab(entry)
      ? entries.slice(0, slotIndex - 1).filter(isUntitledTab).length
      : undefined;
    slotState.pid = entry?.session.pid;
    // entry undefined (slot vide) → killable=true, sans risque : onKeyDown sort tôt sur un slot vide avant de lire ce flag.
    slotState.killable = entry?.session.kind !== "bg";

    // Hold passé LONG_PRESS_MS : on masque l'état normal par l'anneau "KILL"
    // tant que la touche reste enfoncée (killArmingSince posé par SlotAction).
    if (slotState.killArmingSince !== undefined) {
      const elapsed = Date.now() - slotState.killArmingSince;
      const progress = Math.max(0, Math.min(1, elapsed / (KILL_PRESS_MS - LONG_PRESS_MS)));
      const killSvg = renderKillArming({ slot: slotIndex, label, progress });
      const killUrl = "data:image/svg+xml;base64," + Buffer.from(killSvg, "utf8").toString("base64");
      if (slotState.lastSvg !== killUrl) {
        slotState.lastSvg = killUrl;
        pending.push(
          action.setImage(killUrl).catch((err) => {
            streamDeck.logger.error(`setImage(kill) failed for slot ${slotIndex}`, err);
          }),
        );
      }
      continue;
    }

    if (slotState.lastSvg === dataUrl) continue;
    slotState.lastSvg = dataUrl;
    pending.push(
      action.setImage(dataUrl).catch((err) => {
        streamDeck.logger.error(`setImage failed for slot ${slotIndex}`, err);
      }),
    );
  }
  await Promise.all(pending);
}
