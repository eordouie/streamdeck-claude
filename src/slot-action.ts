import streamDeck, {
  action,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { platform } from "node:os";
import type { SessionOrigin, SessionProvider } from "./sessions.js";
import type { TerminalKind } from "./terminal-kind.js";
import { focusTerminalForSession, type FocusTarget } from "./terminal-focus.js";
import { spawnCapture } from "./spawn-capture.js";
import type { LaunchSpec } from "./provider-types.js";
import { buildLaunchCommand } from "./launch-command.js";
import { PendingLaunches } from "./pending-launch.js";

/** Hold ≥ this long → wipe just this agent's event log (palier 1). */
export const LONG_PRESS_MS = 500;
/** Hold ≥ this long → kill the agent process (palier 2). Le wipe à
 *  LONG_PRESS_MS a déjà eu lieu quand on atteint ce seuil. */
export const KILL_PRESS_MS = 3000;

/** Per-instance state we render onto each key. */
export interface SlotState {
  /** SVG already rendered last tick — used to skip redundant setImage calls. */
  lastSvg?: string;
  /** What we copy to the clipboard when the key is short-pressed. */
  clipboardPayload?: string;
  /** Bound session — used by long-press to wipe just this agent's event log. */
  sessionId?: string;
  origin?: SessionOrigin;
  provider?: SessionProvider;
  /** Terminal host of the bound session — drives slot-press focus dispatch. */
  terminal?: TerminalKind;
  /** Unique name stamped on this session's tab — focus matches it exactly. */
  canonicalTitle?: string;
  /** Bound session pid — required to kill the process on a ≥3s hold. */
  pid?: number;
  /** Where a short press should land. Normally the bound session's own tab;
   *  for a bg job — which has none — the tab of the interactive session that
   *  parked it. undefined = nowhere to go, so the press says so. Posé chaque
   *  tick par le render-loop. */
  focusTarget?: FocusTarget;
  /** Wall-clock ms du début d'arming (≥LONG_PRESS_MS tenu). undefined = pas en
   *  arming. Lu par le render-loop pour dessiner l'anneau "KILL". */
  killArmingSince?: number;
  /** False quand la session n'expose pas de pid. Posé chaque tick par le
   *  render-loop. Les agents bg SONT killable : leur pid est un process dédié. */
  killable?: boolean;
}

@action({ UUID: "com.julien.claudesessions.slot" })
export class SlotAction extends SingletonAction {
  /** All currently-visible action instances, keyed by their Stream Deck instance id. */
  private readonly instances = new Map<string, KeyAction>();
  /** Per-instance render bookkeeping. */
  private readonly state = new Map<string, SlotState>();
  /** Armed long-press timers. Presence = key is currently held but threshold
   *  not yet reached. Cleared on KeyUp (short press) or when the timer fires. */
  private readonly pressTimers = new Map<string, NodeJS.Timeout>();
  /** Armed kill timers (fire at KILL_PRESS_MS). Same lifecycle as pressTimers. */
  private readonly killTimers = new Map<string, NodeJS.Timeout>();
  /** Empty-slot launches in flight — one at a time per key. */
  private readonly emptyLaunching = new Set<string>();

  constructor(
    private readonly resetSlot: (sessionId: string, origin: SessionOrigin, provider: SessionProvider) => Promise<void>,
    private readonly killSlot: (pid: number, sessionId: string, origin: SessionOrigin, provider: SessionProvider) => Promise<void>,
    private readonly acknowledgeSlot: (sessionId: string) => void = () => {},
    private readonly dismissSlot: (sessionId: string) => void = () => {},
    private readonly pendingLaunches: PendingLaunches = new PendingLaunches(),
    private readonly requestRender: () => void = () => {},
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (!ev.action.isKey()) {
      streamDeck.logger.warn(`willAppear: not a key, id=${ev.action.id}`);
      return;
    }
    this.instances.set(ev.action.id, ev.action);
    this.state.set(ev.action.id, {});
    const c = ev.action.coordinates;
    streamDeck.logger.info(
      `willAppear: id=${ev.action.id} coords=${c ? `(${c.row},${c.column})` : "none"} total=${this.instances.size}`,
    );
  }

  override onWillDisappear(ev: WillDisappearEvent): void | Promise<void> {
    this.instances.delete(ev.action.id);
    this.state.delete(ev.action.id);
    const t = this.pressTimers.get(ev.action.id);
    if (t) {
      clearTimeout(t);
      this.pressTimers.delete(ev.action.id);
    }
    const k = this.killTimers.get(ev.action.id);
    if (k) {
      clearTimeout(k);
      this.killTimers.delete(ev.action.id);
    }
    this.pendingLaunches.fail(ev.action.id);
    streamDeck.logger.info(`willDisappear: id=${ev.action.id} total=${this.instances.size}`);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    const slot = this.state.get(ev.action.id);
    if (!slot?.clipboardPayload || !slot.sessionId || !slot.origin || !slot.provider) {
      // Empty slot: a free key is a "new tab" launcher. One gesture, one
      // meaning, so it fires here on KeyDown — the press cannot mean anything
      // else, and there is no second gesture to disambiguate on release.
      // `provider` joins the bound-slot test rather than defaulting to Claude:
      // a slot that cannot say which agent it holds must not have that agent
      // guessed for it, because the guess ends in a wipe or a SIGTERM.
      void this.openAgentTab(ev);
      return;
    }
    const id = ev.action.id;
    const sessionId = slot.sessionId;
    const origin = slot.origin;
    const provider = slot.provider;
    const pid = slot.pid;
    // Sans pid on garde le palier 1 (wipe du log) mais ni l'anneau KILL ni le
    // palier 2.
    const killable = slot.killable === true && pid !== undefined;
    const wipeTimer = setTimeout(() => {
      this.pressTimers.delete(id);
      // Palier 1 atteint : wipe le log. L'anneau "KILL" ne s'arme que si un kill
      // peut effectivement suivre.
      if (killable) slot.killArmingSince = Date.now();
      void this.runLongPress(ev, sessionId, origin, provider);
    }, LONG_PRESS_MS);
    this.pressTimers.set(id, wipeTimer);
    if (killable) {
      const killTimer = setTimeout(() => {
        this.killTimers.delete(id);
        // Garde killArmingSince posé pendant le kill pour que l'anneau s'affiche
        // plein (progress clampé à 1) le temps du SIGTERM, puis le libère — sinon
        // le dernier frame visible plafonne à ~0.95 avant de disparaître.
        void this.runKill(ev, pid!, sessionId, origin, provider).finally(() => {
          slot.killArmingSince = undefined;
        });
      }, KILL_PRESS_MS);
      this.killTimers.set(id, killTimer);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const id = ev.action.id;
    // An empty key launched on KeyDown and armed no timers, so every branch
    // below is a no-op for it.
    const wipeTimer = this.pressTimers.get(id);
    const killTimer = this.killTimers.get(id);
    if (wipeTimer) {
      // Relâché avant 500ms → short press (copie + Warp). Annule tout.
      clearTimeout(wipeTimer);
      this.pressTimers.delete(id);
      if (killTimer) {
        clearTimeout(killTimer);
        this.killTimers.delete(id);
      }
      await this.runShortPress(ev);
      return;
    }
    // Pour un agent bg, killTimer n'a jamais été armé → toujours undefined ici ; cette branche est alors un no-op (killArmingSince n'a jamais été posé non plus).
    if (killTimer) {
      // Relâché entre 500ms et 3s → le wipe a déjà eu lieu. Annule le kill et
      // l'arming visuel ; le render-loop reprend l'état normal au prochain tick.
      clearTimeout(killTimer);
      this.killTimers.delete(id);
      const slot = this.state.get(id);
      if (slot) slot.killArmingSince = undefined;
      return;
    }
    // Relâché après 3s → kill déjà fired, no-op.
  }

  /** Opens one bare agent tab and reserves this key for whatever agent the user
   *  types in it. No agent is chosen here — that is the point. */
  private async openAgentTab(ev: KeyDownEvent): Promise<void> {
    const spec = (ev.payload.settings as { launch?: LaunchSpec }).launch;
    if (!spec?.script) {
      // A slot with no launch spec is a stale profile — apply-layout.sh has not
      // run since the layout changed.
      streamDeck.logger.error("empty-slot press: no launch spec in settings — re-run apply-layout.sh");
      await ev.action.showAlert();
      return;
    }
    if (this.emptyLaunching.has(ev.action.id)) return;
    this.emptyLaunching.add(ev.action.id);
    // Reserve the key before the tab exists, so the session that eventually
    // registers from it lands here rather than on the first free slot.
    const launch = this.pendingLaunches.start(ev.action.id);
    this.requestRender();
    try {
      // Log every launch, not just failures: the launcher can exit 0 having typed
      // into the WRONG tab (the keystroke race in ghostty-new-agent.sh, see
      // LESSONS.md), which is indistinguishable from "the key did nothing".
      streamDeck.logger.info(`empty-slot launch: script=${spec.script} launchId=${launch.id}`);
      const command = buildLaunchCommand(spec, launch.id);
      const r = await spawnCapture(command.script, [], { timeoutMs: 15_000, env: command.env });
      const failed = r.err !== undefined || r.timedOut === true || r.code !== 0;
      if (failed) {
        this.pendingLaunches.fail(ev.action.id);
        this.requestRender();
        streamDeck.logger.error(
          `empty-slot launch failed (${spec.script}): err=${r.err ?? "none"} code=${r.code} timedOut=${r.timedOut === true} stderr=${r.stderr.trim()}`,
        );
        await ev.action.showAlert();
      }
      // Success feedback is the new tab itself.
    } finally {
      this.emptyLaunching.delete(ev.action.id);
    }
  }

  private async runShortPress(ev: KeyUpEvent): Promise<void> {
    const slot = this.state.get(ev.action.id);
    const cwd = slot?.clipboardPayload;
    if (!cwd) {
      await ev.action.showAlert();
      return;
    }
    // Pressing the key IS the acknowledgement — stop the attention flash even
    // if the focus attempt below misses.
    if (slot?.sessionId) this.acknowledgeSlot(slot.sessionId);
    try {
      await copyToClipboard(cwd);
      const target = slot?.focusTarget;
      if (!target) {
        // A bg job whose owning session is gone: no tab anywhere shows this
        // agent. Say so at once instead of spending ~2s missing warp → vscode
        // → ghostty in turn, which is what every press on a bg slot used to do.
        streamDeck.logger.info(
          `focus: no reachable tab for ${slot?.sessionId ?? "slot"} — bg job, owning session gone`,
        );
        await ev.action.showAlert();
        return;
      }
      const res = await focusTerminalForSession(target);
      // No showOk here: landing on the tab (and the flash clearing) IS the
      // feedback — the green checkmark overlay just adds noise.
      // Pressing the key for a session you were ALREADY looking at means
      // "I know, nothing owed here" — clear the debt outright instead of
      // just snoozing it.
      if (res.alreadyFront === true && slot?.sessionId) {
        this.dismissSlot(slot.sessionId);
      }
      streamDeck.logger.info(
        `focus(${target.terminal}): ${res.reason}${res.alreadyFront ? " [already front → dismissed]" : ""} for cwd=${target.cwd}`,
      );
    } catch (err) {
      streamDeck.logger.error("clipboard copy failed", err);
      await ev.action.showAlert();
    }
  }

  private async runLongPress(
    ev: KeyDownEvent,
    sessionId: string,
    origin: SessionOrigin,
    provider: SessionProvider,
  ): Promise<void> {
    try {
      await this.resetSlot(sessionId, origin, provider);
      // Pendant l'armement du kill (cas normal d'un long-press), l'anneau rouge
      // sert de confirmation : on évite le flash vert showOk qui le masquerait
      // et laisserait croire que l'action est terminée.
      const slot = this.state.get(ev.action.id);
      if (!slot?.killArmingSince) await ev.action.showOk();
    } catch (err) {
      streamDeck.logger.error(`long-press reset failed for ${origin}/${sessionId}`, err);
      await ev.action.showAlert();
    }
  }

  private async runKill(
    ev: KeyDownEvent,
    pid: number,
    sessionId: string,
    origin: SessionOrigin,
    provider: SessionProvider,
  ): Promise<void> {
    try {
      await this.killSlot(pid, sessionId, origin, provider);
      // No showOk: the green checkmark covers the key for about a second, which
      // is exactly the moment the tile is supposed to be seen going dark. The
      // completed KILL ring was the confirmation; the empty slot is the result.
    } catch (err) {
      streamDeck.logger.error(`kill failed for ${origin}/${sessionId} pid=${pid}`, err);
      await ev.action.showAlert();
    }
  }

  /** True if any visible slot is mid-hold past LONG_PRESS_MS — consumed by the
   *  animation tick so the progress ring keeps advancing. */
  anyKillArming(): boolean {
    for (const s of this.state.values()) {
      if (s.killArmingSince !== undefined) return true;
    }
    return false;
  }

  /**
   * Returns the action instances ordered by physical position on the deck
   * (top-to-bottom, left-to-right). This ordering is what defines slot 1..N.
   */
  orderedActions(): KeyAction[] {
    return [...this.instances.values()]
      .filter((a) => a.coordinates) // skip multi-action contexts
      .sort((a, b) => {
        const A = a.coordinates!;
        const B = b.coordinates!;
        return A.row !== B.row ? A.row - B.row : A.column - B.column;
      });
  }

  getState(id: string): SlotState | undefined {
    return this.state.get(id);
  }
}

/**
 * Writes `text` to the host clipboard. Windows pipes to `clip.exe`; macOS to
 * `pbcopy`; Linux tries `wl-copy`, then `xclip`, then `xsel` (best-effort).
 */
async function copyToClipboard(text: string): Promise<void> {
  const p = platform();
  const candidates: [string, string[]][] =
    p === "win32" ? [["clip.exe", []]]
    : p === "darwin" ? [["pbcopy", []]]
    : [
        ["wl-copy", []],
        ["xclip", ["-selection", "clipboard"]],
        ["xsel", ["--clipboard", "--input"]],
      ];

  for (const [cmd, args] of candidates) {
    const r = await spawnCapture(cmd, args, { stdin: text });
    if (!r.err && r.code === 0) return;
  }
  throw new Error("no clipboard tool succeeded");
}
