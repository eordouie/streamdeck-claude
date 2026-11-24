import { renderIcon } from "../icons/index.js";
import { ANIMATION_FRAMES } from "../icons/mascot-kit.js";
import { BORDER_INSET, BORDER_RADIUS, BORDER_SIZE, BORDER_STROKE } from "../icons/theme.js";
import type { AgentKeyView, KeyView, PagerView } from "./deck-view.js";

/** The old deck's empty-key colours (STATES.empty) and its needs-you accent (STATES.awaiting). */
const BG = "#0a0b0e";
const DIM = "#374151";
const INK = "#cbd5e1";
const ALERT = "#f97316";
const FONT = "-apple-system,Segoe UI,Roboto,sans-serif";

function framed(inner: string, stroke: string, opacity: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="${BG}"/>
${inner}
<rect x="${BORDER_INSET}" y="${BORDER_INSET}" width="${BORDER_SIZE}" height="${BORDER_SIZE}" rx="${BORDER_RADIUS}" fill="none" stroke="${stroke}" stroke-width="${BORDER_STROKE}" stroke-linejoin="round" opacity="${opacity}"/>
</svg>`;
}

const word = (y: number, text: string, size: number, fill: string): string =>
  `<text x="72" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="middle">${text}</text>`;

/** An agent key, drawn by the old deck's renderer. The view carries no agent
 *  kind, so a Claude key and a Codex key cannot be drawn differently. */
export function agentKeySvg(view: AgentKeyView, frame: number, now: number): string {
  return renderIcon({
    state: view.state,
    slot: view.slot,
    label: view.lines.top,
    lines: view.lines,
    frame,
    now,
    attention: view.attention,
    awaitingReply: view.awaitingReply,
  });
}

/** A key with no agent: a dim frame. It opens nothing, so it says nothing. */
export const emptyKeySvg = (): string => framed("", DIM, 0.35);

/** The arrow key. Page 1: an arrow forward and "1/2". Page 2: an arrow back,
 *  "2/2", and the word "back". On either page "+N" stands on top instead when
 *  N agents have no key on the deck at all. One page: a dim arrow. No herdr:
 *  "herdr off". */
export function pagerKeySvg(view: PagerView, frame: number): string {
  if (view.offline) return framed(word(68, "herdr", 19, "#6b7280") + word(92, "off", 19, "#6b7280"), DIM, 0.35);
  if (view.pages < 2) return framed(`<path d="M54 46 L100 76 L54 106 Z" fill="${DIM}" opacity="0.6"/>`, DIM, 0.35);
  const forward = view.page === 1;
  const arrow = forward ? "M54 46 L100 76 L54 106 Z" : "M90 46 L44 76 L90 106 Z";
  const top = view.more > 0 ? `+${view.more}` : forward ? "" : "back";
  let pulse = "";
  if (view.alert) {
    const phase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    pulse = `<rect width="144" height="144" fill="${ALERT}" opacity="${(tri * 0.75).toFixed(3)}"/>`;
  }
  const inner = `${pulse}<path d="${arrow}" fill="${INK}"/>${top ? word(30, top, 19, INK) : ""}${word(132, `${view.page}/${view.pages}`, 17, INK)}`;
  return framed(inner, view.alert ? ALERT : "#64748b", 0.95);
}

export function keySvg(view: KeyView, frame: number, now: number): string {
  return view.kind === "agent" ? agentKeySvg(view, frame, now) : emptyKeySvg();
}

export const toDataUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
