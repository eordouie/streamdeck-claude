import {
  awaitingPulse,
  emptyDashed,
  errorBolt,
  finishedCheck,
  permissionPulse,
  planPulse,
  questionPulse,
  slotCharacterIdle,
  slotCharacterWalk,
  spinnerArc,
  subagentWalk,
} from "./motifs.js";

type Palette = { bg: string; accent: string; label: string };
/** `slot` (1-based key position) lets a motif vary per key — the idle
 *  characters use it; state motifs ignore it. */
type MotifFn = (frame: number, color: string, slot?: number) => string;

interface StateDef {
  palette: Palette;
  /** True if the motif itself uses `frame` (independent of marquee on labels). */
  animated: boolean;
  /** When true, render.ts overlays the accent color on top of `bg` at a frame-driven
   *  opacity, so the whole tile pulses to "full colour" while the user is being
   *  asked to do something — much easier to spot from a distance than the motif
   *  alone. */
  pulseBg: boolean;
  motif: MotifFn;
}

export const STATES = {
  // Working keeps the amber chrome but walks the slot's own mascot across the
  // tile instead of spinning an arc, so a busy key stays the character you
  // recognise. `bg_working` deliberately keeps the arc — a background agent is
  // not this session's mascot doing the work.
  working:       { palette: { bg: "#0f1115", accent: "#fbbf24", label: "#fde68a" }, animated: true,  pulseBg: false, motif: slotCharacterWalk },
  // Same walk as `working`, plus a few small copies of the mascot in tow —
  // delegated work, travelling with you. Each member has its own frame and
  // blink phase; see subagentWalk.
  subagent:      { palette: { bg: "#0f1115", accent: "#fbbf24", label: "#fde68a" }, animated: true,  pulseBg: false, motif: subagentWalk },
  idle:          { palette: { bg: "#0f1115", accent: "#3b82f6", label: "#bfdbfe" }, animated: true,  pulseBg: false, motif: slotCharacterIdle },
  awaiting:            { palette: { bg: "#1a1208", accent: "#f97316", label: "#fed7aa" }, animated: true,  pulseBg: true,  motif: awaitingPulse },
  awaiting_permission: { palette: { bg: "#1a1308", accent: "#f59e0b", label: "#fde68a" }, animated: true,  pulseBg: true,  motif: permissionPulse },
  awaiting_question:   { palette: { bg: "#08191c", accent: "#06b6d4", label: "#a5f3fc" }, animated: true,  pulseBg: true,  motif: questionPulse },
  awaiting_plan:       { palette: { bg: "#15102a", accent: "#a78bfa", label: "#ddd6fe" }, animated: true,  pulseBg: true,  motif: planPulse },
  error:         { palette: { bg: "#1a0a0a", accent: "#ef4444", label: "#fecaca" }, animated: true,  pulseBg: true,  motif: errorBolt },
  finished:      { palette: { bg: "#0a1410", accent: "#22c55e", label: "#bbf7d0" }, animated: false, pulseBg: false, motif: finishedCheck },
  bg_working:             { palette: { bg: "#10131a", accent: "#8b9cff", label: "#c7d2fe" }, animated: true,  pulseBg: false, motif: spinnerArc },
  // bg_awaiting* partagent la même palette à dessein : états bg basse priorité, le motif seul les distingue.
  bg_awaiting_permission: { palette: { bg: "#12132e", accent: "#a5b4fc", label: "#ddd6fe" }, animated: true,  pulseBg: true,  motif: permissionPulse },
  bg_awaiting:            { palette: { bg: "#12132e", accent: "#a5b4fc", label: "#ddd6fe" }, animated: true,  pulseBg: true,  motif: awaitingPulse },
  bg_idle:                { palette: { bg: "#10131a", accent: "#6b7fd0", label: "#c7d2fe" }, animated: true,  pulseBg: false, motif: slotCharacterIdle },
  empty:         { palette: { bg: "#0a0b0e", accent: "#374151", label: "#4b5563" }, animated: false, pulseBg: false, motif: emptyDashed },
} satisfies Record<string, StateDef>;

export type SessionState = keyof typeof STATES;

/** True for the dedicated background-agent states. The `bg_` prefix is the
 *  single source of truth — render.ts uses this to draw the "bg" badge. */
export const isBgState = (s: SessionState): boolean => s.startsWith("bg_");
