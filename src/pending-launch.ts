import { randomUUID } from "node:crypto";
import type { AgentSession } from "./provider-types.js";

export interface PendingLaunch {
  id: string;
  actionId: string;
  startedAt: number;
}

/** How long a pressed slot stays reserved for the tab it opened. Generous
 *  because the wait is now a HUMAN one: the tab opens at a bare prompt and the
 *  reservation only ends when the user has typed their agent and it has
 *  registered. Two minutes covers "open a tab, cd somewhere, then start
 *  claude"; past that the slot goes back into the pool and a later session
 *  simply lands on the first free key instead of the one that was pressed. */
export const DEFAULT_PENDING_TTL_MS = 120_000;

/**
 * Slots that opened a tab and are waiting for whatever agent gets typed in it.
 *
 * Keyed by launch id ALONE — deliberately not by provider. The gesture no
 * longer decides which agent runs, so a reservation cannot know whether it will
 * be claimed by Claude, Codex, or something added later; the id is exported into
 * the tab's shell and comes back through whichever provider's hook fires.
 */
export class PendingLaunches {
  private readonly byAction = new Map<string, PendingLaunch>();

  start(actionId: string, now = Date.now()): PendingLaunch {
    const launch = { id: randomUUID(), actionId, startedAt: now };
    this.byAction.set(actionId, launch);
    return launch;
  }

  match(session: Pick<AgentSession, "launchId">): string | undefined {
    if (!session.launchId) return undefined;
    for (const [actionId, launch] of this.byAction) {
      if (launch.id !== session.launchId) continue;
      this.byAction.delete(actionId);
      return actionId;
    }
    return undefined;
  }

  fail(actionId: string): void {
    this.byAction.delete(actionId);
  }

  get(actionId: string): PendingLaunch | undefined {
    return this.byAction.get(actionId);
  }

  values(): readonly PendingLaunch[] {
    return [...this.byAction.values()];
  }

  expire(now = Date.now(), ttlMs = DEFAULT_PENDING_TTL_MS): string[] {
    const expired: string[] = [];
    for (const [actionId, launch] of this.byAction) {
      if (now - launch.startedAt < ttlMs) continue;
      this.byAction.delete(actionId);
      expired.push(actionId);
    }
    return expired;
  }
}
