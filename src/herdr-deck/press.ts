import type { DeckAgent } from "./model.js";

export type Target = Pick<DeckAgent, "paneId" | "terminalId" | "sessionId">;
export const PRESS_GRACE_MS = 250;

interface Binding {
  current: Target;
  previous?: Target;
  changedAt: number;
}

/** One physical action instance. The SDK promise confirms dispatch over the
 *  connection. The hardware provides no acknowledgement of the displayed pixels. */
export class PaintedKey {
  private binding?: Binding;
  private sent?: string;
  private page?: number;
  private generation = 0;
  private busy = false;

  constructor(private readonly now: () => number) {}

  reset(): void {
    this.binding = undefined;
    this.sent = undefined;
    this.generation++;
  }

  async paint(page: number, image: string, target: Target | undefined, send: (image: string) => Promise<void>): Promise<void> {
    if (page !== this.page) {
      this.page = page;
      this.reset();
    }
    if (this.busy) return; // The next frame samples the current view.
    const generation = this.generation;
    this.busy = true;
    try {
      if (image !== this.sent) await send(image);
      if (generation !== this.generation) return;
      this.sent = image;
      const old = this.binding;
      if (!target) this.binding = undefined;
      else if (old && old.current.paneId === target.paneId && old.current.terminalId === target.terminalId &&
               (!old.current.sessionId || old.current.sessionId === target.sessionId)) {
        this.binding = { ...old, current: target };
      } else {
        this.binding = { current: target, changedAt: this.now(),
          previous: old?.current.paneId !== target.paneId ? old?.current : undefined };
      }
    } finally {
      this.busy = false;
    }
  }

  pressed(): Target | undefined {
    const b = this.binding;
    if (b?.previous && this.now() - b.changedAt < PRESS_GRACE_MS) return b.previous;
    return b?.current;
  }
}

/** Row-major positions of the 14 agent wells on the MK.2. */
export const AGENTS_PER_PAGE = 14;
export function keyIndex(pos: { column: number; row: number } | undefined): number | undefined {
  if (!pos || !Number.isInteger(pos.column) || !Number.isInteger(pos.row) ||
      pos.column < 0 || pos.column > 4 || pos.row < 0 || pos.row > 2) return undefined;
  const i = pos.row * 5 + pos.column;
  return i < AGENTS_PER_PAGE ? i : undefined;
}
