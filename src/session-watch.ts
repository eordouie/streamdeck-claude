import { watch, type FSWatcher } from "node:fs";
import streamDeck from "@elgato/streamdeck";

/** Collapse the burst a session start produces — the agent's own record and its
 *  hook's event log land within milliseconds of each other — into one tick. */
export const WATCH_DEBOUNCE_MS = 60;

/**
 * Wakes the slow tick the moment a session record appears or disappears, instead
 * of waiting out the 1 s poll. That poll remains the safety net (and still drives
 * state changes); this only removes the up-to-1 s lag between "the agent started"
 * and "the key lights up", which is the entire deck-side share of that delay.
 *
 * Only `rename` events (file created/removed) wake a tick. `change` events are
 * every appended hook event of every busy session — waking on those would run
 * ticks continuously for no visible gain, since state already rides the poll.
 */
export function watchSessionDirs(
  dirs: readonly string[],
  onChange: () => void,
  debounceMs = WATCH_DEBOUNCE_MS,
): () => void {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;

  const wake = (filename: string) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      streamDeck.logger.debug(`session dir change (${filename}) → immediate tick`);
      onChange();
    }, debounceMs);
  };

  for (const dir of dirs) {
    try {
      // A watcher that dies (dir deleted, descriptor limit) must not take the
      // plugin with it: the poll still covers everything a watcher would.
      const watcher = watch(dir, (event, filename) => {
        if (event === "rename") wake(filename ?? "?");
      });
      watcher.on("error", (err) => {
        streamDeck.logger.warn(`session dir watch failed for ${dir}: ${err.message} — falling back to polling`);
      });
      watchers.push(watcher);
    } catch (err) {
      streamDeck.logger.warn(
        `cannot watch ${dir}: ${err instanceof Error ? err.message : String(err)} — falling back to polling`,
      );
    }
  }
  streamDeck.logger.info(`watching ${watchers.length}/${dirs.length} session dirs for new sessions`);

  return () => {
    for (const watcher of watchers) watcher.close();
    if (timer) clearTimeout(timer);
  };
}
