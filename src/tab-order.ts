import { platform } from "node:os";
import streamDeck from "@elgato/streamdeck";
import { ghosttyScriptFailure, listTabs } from "./ghostty-script.js";
import { orderTabs, pidFromStampedTitle, type TabEntry } from "./slot-plan.js";

/**
 * The Ghostty tab strip, as the deck last saw it.
 *
 * Deck key N mirrors tab N, so the strip is read on its own timer — every
 * POLL_MS, outside the slow tick, which must not wait on AppleScript — and
 * the render loop plans keys from the newest snapshot (slot-plan.ts). A
 * failed read keeps the previous snapshot: the plugin log shows the 2 s
 * timeout a few times a day, and reshuffling every key on each of them
 * would be worse than being a few seconds stale. Until the first read ever
 * answers, `currentTabs()` is null and the render loop falls back to start
 * order.
 */

const POLL_MS = 3_000;

let snapshot: TabEntry[] | null = null;
let signature = "";
let loggedFailure = "";

/** The strip in deck order (front window first), or null before any read. */
export function currentTabs(): TabEntry[] | null {
  return snapshot;
}

function describe(t: TabEntry): string {
  const pid = pidFromStampedTitle(t.terminal) ?? pidFromStampedTitle(t.tab);
  return `${t.index}${t.front ? "" : "'"}=${pid ?? `"${t.terminal || t.tab}"`}`;
}

/** Read the strip once. True when the order (tab ids, or the pid stamped on
 *  a tab) changed since the last read — the caller re-renders then. */
export async function refreshTabOrder(): Promise<boolean> {
  const tabs = await listTabs();
  if (tabs === null) {
    const failure = ghosttyScriptFailure();
    if (failure && failure !== loggedFailure) {
      streamDeck.logger.warn(`tab order: ghostty api unavailable (${failure}); keeping the last known strip`);
      loggedFailure = failure;
    }
    return false;
  }
  if (loggedFailure) {
    streamDeck.logger.info("tab order: ghostty api available again");
    loggedFailure = "";
  }
  const ordered = orderTabs(tabs);
  const sig = ordered
    .map((t) => `${t.tabId}:${pidFromStampedTitle(t.terminal) ?? pidFromStampedTitle(t.tab) ?? "-"}`)
    .join("|");
  snapshot = ordered;
  if (sig === signature) return false;
  signature = sig;
  streamDeck.logger.info(`tab order: ${ordered.length === 0 ? "(no tabs)" : ordered.map(describe).join(" ")}`);
  return true;
}

/** Poll the strip forever; `onChange` fires when the order changed. macOS
 *  only — the strip is a Ghostty concept, and Ghostty ships no Windows build. */
export function startTabOrderPoll(onChange: () => void): void {
  if (platform() !== "darwin") return;
  const loop = async (): Promise<void> => {
    try {
      if (await refreshTabOrder()) onChange();
    } catch (err) {
      streamDeck.logger.warn(`tab order poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTimeout(() => void loop(), POLL_MS);
    }
  };
  void loop();
}
