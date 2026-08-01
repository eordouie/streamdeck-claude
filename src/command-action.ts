import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  SingletonAction,
} from "@elgato/streamdeck";
import { spawnCapture } from "./spawn-capture.js";
import { BORDER_INSET, BORDER_SIZE, BORDER_RADIUS } from "./icons/theme.js";

/** Per-key settings, baked into the profile (no property inspector yet).
 *  `label` renders on the key face — split lines with "|". `script` is an
 *  absolute path to an executable run with `args` on key press. */
interface CommandSettings {
  label?: string;
  script?: string;
  args?: string[];
  /** Key background fill; label text stays light, so keep it dark. */
  color?: string;
}

const DEFAULT_COLOR = "#313244";
const LABEL_COLOR = "#cdd6f4";
const SCRIPT_TIMEOUT_MS = 15_000;

/**
 * Command key: fire-and-report launcher for a small shell script (type a
 * slash command into Ghostty, open a new claude tab, send Esc, …). Exists
 * because the Stream Deck built-in Text/Hotkey/Multi Action settings are a
 * private schema — a first-party action with explicit settings is scriptable,
 * versionable, and testable from the shell.
 */
@action({ UUID: "com.julien.claudesessions.command" })
export class CommandAction extends SingletonAction {
  /** Instance ids with a script currently in flight — one run at a time per key. */
  private readonly running = new Set<string>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.render(ev.action, ev.payload.settings as CommandSettings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.render(ev.action, ev.payload.settings as CommandSettings);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { script, args = [], label } = ev.payload.settings as CommandSettings;
    if (!script) {
      await ev.action.showAlert();
      return;
    }
    if (this.running.has(ev.action.id)) return;
    this.running.add(ev.action.id);
    try {
      const r = await spawnCapture(script, args, { timeoutMs: SCRIPT_TIMEOUT_MS });
      const failed = r.err !== undefined || r.timedOut === true || r.code !== 0;
      if (failed) {
        streamDeck.logger.error(
          `command "${label ?? script}" failed: err=${r.err ?? "none"} code=${r.code} timedOut=${r.timedOut === true} stderr=${r.stderr.trim()}`,
        );
        await ev.action.showAlert();
      } else {
        await ev.action.showOk();
      }
    } finally {
      this.running.delete(ev.action.id);
    }
  }

  private async render(
    act: { setImage(img: string): Promise<void>; setTitle(t: string): Promise<void> },
    settings: CommandSettings,
  ): Promise<void> {
    const label = settings.label ?? "";
    const color = settings.color ?? DEFAULT_COLOR;
    const svg = renderCommandKey(label, color);
    await act.setTitle("");
    await act.setImage("data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64"));
  }
}

/** Rounded tile + up to two centered label lines ("|" splits). */
export function renderCommandKey(label: string, color: string): string {
  const lines = label.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 2);
  const fontSize = 22;
  const text =
    lines.length <= 1
      ? textLine(lines[0] ?? "", 72 + 8, fontSize)
      : textLine(lines[0], 72 - 8, fontSize) + textLine(lines[1], 72 + 20, fontSize);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
    `<rect x="${BORDER_INSET}" y="${BORDER_INSET}" width="${BORDER_SIZE}" height="${BORDER_SIZE}" rx="${BORDER_RADIUS}" fill="${escapeXml(color)}"/>` +
    text +
    `</svg>`
  );
}

function textLine(s: string, baseline: number, fontSize: number): string {
  return (
    `<text x="72" y="${baseline}" text-anchor="middle" ` +
    `font-family="-apple-system, 'Segoe UI', sans-serif" font-size="${fontSize}" ` +
    `font-weight="600" fill="${LABEL_COLOR}">${escapeXml(s)}</text>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
