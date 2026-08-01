/** Frame count of one motif-animation period. Re-exported from states.ts as the
 *  public name; defined here because the motif functions are its only consumers. */
export const ANIMATION_FRAMES = 12;

export function spinnerArc(frame: number, color: string): string {
  const cx = 72, cy = 60, r = 22;
  const startDeg = (frame * 360) / ANIMATION_FRAMES;
  const sweep = 240;
  const endDeg = startDeg + sweep;
  const toXY = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  const largeArc = sweep > 180 ? 1 : 0;
  return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
}

export function awaitingPulse(frame: number, color: string): string {
  const phase = frame / ANIMATION_FRAMES;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const r = 26 + t * 5;
  const opacity = 0.55 + t * 0.45;
  return `<circle cx="72" cy="60" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(3.5 + t * 1.5).toFixed(1)}" opacity="${opacity.toFixed(2)}"/>
<path d="M62 50 Q62 40 72 40 Q82 40 82 50 Q82 58 75 62 Q72 64 72 70" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
<circle cx="72" cy="78" r="3" fill="${color}"/>`;
}

export function questionPulse(frame: number, color: string): string {
  // Pulsing speech-bubble with "?" inside, for AskUserQuestion (PreToolUse).
  // Same pulse beat as the rest of the "needs you" family so the four read as
  // a set: orange ? = generic awaiting, amber padlock = permission, cyan bubble
  // = UI question, violet doc = plan approval.
  const phase = frame / ANIMATION_FRAMES;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const opacity = 0.55 + t * 0.45;
  const stroke = (3 + t * 1.5).toFixed(1);
  // Rounded rectangle bubble (44×34) with a small tail pointing down-left,
  // and a "?" glyph centred inside.
  return `<g opacity="${opacity.toFixed(2)}">
<path d="M50 40 H94 a4 4 0 0 1 4 4 V72 a4 4 0 0 1 -4 4 H66 L58 86 L60 76 H54 a4 4 0 0 1 -4 -4 V44 a4 4 0 0 1 4 -4 z" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>
</g>
<path d="M64 54 Q64 46 72 46 Q80 46 80 54 Q80 60 74 63 Q72 65 72 69" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
<circle cx="72" cy="74" r="2.5" fill="${color}"/>`;
}

export function permissionPulse(frame: number, color: string): string {
  // Pulsing padlock for permission_prompt. Same beat as awaitingPulse / planPulse
  // so the three "needs you" states read as a family (orange = elicitation,
  // amber padlock = tool permission, violet doc = plan approval).
  const phase = frame / ANIMATION_FRAMES;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const opacity = 0.55 + t * 0.45;
  const stroke = (3 + t * 1.5).toFixed(1);
  // Shackle (∩) sits above the body; body is a rounded rect; keyhole is a
  // small filled circle with a tapered line beneath, centred at cx=72.
  return `<g opacity="${opacity.toFixed(2)}">
<path d="M60 60 V50 Q60 38 72 38 Q84 38 84 50 V60" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
<rect x="52" y="58" width="40" height="34" rx="4" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>
</g>
<circle cx="72" cy="72" r="3.5" fill="${color}"/>
<path d="M72 75 L72 82" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
}

export function planPulse(frame: number, color: string): string {
  // Pulsing document/clipboard outline with a checklist inside, signalling
  // "approve this plan". Same beat as awaitingPulse so the two read as a
  // matched pair (orange = permission, violet = plan approval).
  const phase = frame / ANIMATION_FRAMES;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const opacity = 0.55 + t * 0.45;
  const stroke = (3 + t * 1.5).toFixed(1);
  // Document body (rounded rect 44x52) with a folded corner.
  return `<g opacity="${opacity.toFixed(2)}">
<path d="M50 38 H86 a4 4 0 0 1 4 4 V82 a4 4 0 0 1 -4 4 H54 a4 4 0 0 1 -4 -4 V42 a4 4 0 0 1 4 -4 z" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>
<path d="M82 38 V46 H90" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>
</g>
<path d="M58 56 L62 60 L70 52" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="58" y1="68" x2="80" y2="68" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
<line x1="58" y1="76" x2="76" y2="76" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`;
}

/** Clawd, the Claude Code mascot, derived from `assets/clawd/clawd-idle-look.svg`
 *  (AGPL-3.0 — see assets/clawd/NOTICE.md). Two channels of life:
 *    - breathe (scaleY 0.98..1 on the upper body, two beats per 12-frame loop)
 *      — driven by `frame`, naturally fits the 1.44 s motif cycle.
 *    - blink (~150 ms every 4 s) — driven by `Date.now()` because that cadence
 *      doesn't divide our 12-frame counter; the 120 ms animation tick is fast
 *      enough to catch the blink window and render-loop dedups between blinks.
 *  `color` is unused — keeping Clawd's native peach preserves the character
 *  while the idle palette drives chrome. */
export function clawdIdleLook(frame: number, blinkPhaseMs = 0): string {
  const breathePhase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const breatheTri = breathePhase < 0.5 ? breathePhase * 2 : (1 - breathePhase) * 2;
  const breatheY = (1 - 0.02 * breatheTri).toFixed(3);
  const eyeScaleY = blinkScaleY(blinkPhaseMs);
  const c = "#DE886D";
  // Clawd strolls too: leg pairs alternate every 3 frames, phase-opposed to
  // the T-Rex next door; the body (drawn over the leg tops) bobs on the
  // offbeat, so lifted legs never open a seam.
  const stepA = Math.floor(frame / 3) % 2 === 1;
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="12" width="1" height="${planted ? 3 : 2}" fill="${c}"/>`;
  const legs = stepA
    ? leg(3, true) + leg(5, false) + leg(9, false) + leg(11, true)
    : leg(3, false) + leg(5, true) + leg(9, true) + leg(11, false);
  const bob = stepA ? "0" : "-0.5";
  return `<g transform="translate(42 25) scale(4)">
<rect x="3" y="15" width="9" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(7.5 13) scale(1 ${breatheY}) translate(-7.5 -13)">
<rect x="2" y="6" width="11" height="7" fill="${c}"/>
<rect x="0" y="9" width="2" height="2" fill="${c}"/>
<rect x="13" y="9" width="2" height="2" fill="${c}"/>
<g transform="translate(7.5 9) scale(1 ${eyeScaleY}) translate(-7.5 -9)">
<rect x="4" y="8" width="1" height="2" fill="#000"/>
<rect x="10" y="8" width="1" height="2" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

/** Per-slot idle mascots: each key gets its own pixel character, same life
 *  channels as Clawd (breathe/bob on `frame`, ~150 ms blink every 4 s on
 *  wall-clock). Blinks are phase-shifted per slot so the row doesn't blink
 *  in unison. Native palettes — like Clawd, the characters keep their own
 *  colors while the idle palette drives the chrome. */
/** A slot's mascot as a uniform `(frame, blinkPhaseMs)` function. The walking
 *  and subagent motifs drive those two channels independently of the slot,
 *  which is the only thing `slotCharacterIdle` derives them from — a family of
 *  the same character needs one sprite per member on its own phase. */
function mascotFor(slot: number): (frame: number, blinkPhaseMs: number) => string {
  switch ((Math.max(1, slot) - 1) % 5) {
    case 1: return dinoIdleLook;
    case 2: return sauropodIdleLook;
    case 3: return llamaIdleLook;
    case 4: return elephantIdleLook;
    default: return clawdIdleLook;
  }
}

/** Blink phase for a slot's own mascot — staggered so the row never blinks in
 *  unison. Babies offset further off this. */
const slotBlinkPhase = (slot: number): number => (Math.max(1, slot) - 1) * 700;

/** Key-space y of a mascot's shadow. Every mascot draws its shadow at local
 *  y=15 under `scale(4)`, so this is just its base translate + 60 — Clawd is
 *  the one that sits higher. Babies are scaled about this line, so a family
 *  walks on the same ground however small its members are. */
const footLine = (slot: number): number => ((Math.max(1, slot) - 1) % 5 === 0 ? 85 : 95);

export function slotCharacterIdle(frame: number, _color: string, slot?: number): string {
  const n = Math.max(1, slot ?? 1);
  return mascotFor(n)(frame, slotBlinkPhase(n));
}

/** One full traverse of the key while a session is working. Wall-clock
 *  driven, not frame-driven: the 12-frame counter is 1.44 s at ANIMATION_MS
 *  =120, so a crossing on that period would be a frantic skitter rather than
 *  a walk. Same reason `blinkScaleY` reads the clock — a cadence that doesn't
 *  divide the frame counter belongs on wall-clock, and the 120 ms tick is
 *  fast enough to sample it smoothly. The leg cycle stays on `frame`, which
 *  is what it was built for. */
export const WALK_PERIOD_MS = 5200;

/** The character is drawn twice, one key-width apart, so its leading edge
 *  enters one side while its tail is still leaving the other — a full exit
 *  followed by a re-entry would leave the tile empty for part of every loop. */
const WALK_SPAN = 144;

/** Every mascot travels the way it faces, or it moonwalks. Slots 3-5
 *  (sauropod, llama, elephant) are drawn in left-facing profile; the T-Rex
 *  faces right, and Clawd is front-on with no preferred side. */
function walkDirection(slot: number): 1 | -1 {
  switch ((Math.max(1, slot) - 1) % 5) {
    case 2:
    case 3:
    case 4:
      return -1;
    default:
      return 1;
  }
}

/** The per-slot mascot from `slotCharacterIdle`, walking across the key and
 *  wrapping. Used for `working` in place of the spinner arc.
 *
 *  Deliberately does NOT clip itself. The character disappears behind the
 *  border because render.ts paints the border *after* the motif — pure paint
 *  order, needing nothing from the renderer.
 *
 *  The first attempt clipped instead, with a bare `<clipPath>` as a child of
 *  the motif group. On the deck that rendered as a black box over the whole
 *  tile, leaving only two slivers of border. Not because clipping is
 *  unsupported — `text.ts` clips the marquee and always has — but because it
 *  wraps its `<clipPath>` in `<defs>`. Outside `<defs>` the Stream Deck app
 *  paints the clip's `<rect>` as ordinary content. See LESSONS.md. */
/** Walking pace in px/ms, derived once so every walk motif moves at the same
 *  speed whatever distance it has to cover. The subagent family is wider than
 *  a lone mascot and needs a longer span; the same legs must not sprint to
 *  cover it. */
const WALK_SPEED_PX_MS = WALK_SPAN / WALK_PERIOD_MS;

/** Draw `body` twice, `span` apart, sliding at the shared pace. Two copies is
 *  what makes the wrap continuous: the leading edge enters one side while the
 *  tail is still leaving the other. */
function traverse(body: string, span: number, dir: 1 | -1): string {
  const periodMs = span / WALK_SPEED_PX_MS;
  const t = (Date.now() % periodMs) / periodMs;
  const travelled = dir > 0 ? t * span : (1 - t) * span;
  return `<g transform="translate(${(travelled - span).toFixed(2)} 0)">${body}</g>
<g transform="translate(${travelled.toFixed(2)} 0)">${body}</g>`;
}

export function slotCharacterWalk(frame: number, _color: string, slot?: number): string {
  const n = Math.max(1, slot ?? 1);
  return traverse(mascotFor(n)(frame, slotBlinkPhase(n)), WALK_SPAN, walkDirection(n));
}

/** How many babies trail the parent while a Task subagent runs. */
const BABY_COUNT = 3;
/** Baby size relative to the parent. */
const BABY_SCALE = 0.45;
/** Clear space between the parent and the first baby, and between babies. */
const BABY_GAP = 4;
/** A mascot is 13 local units wide under `scale(4)`. */
const PARENT_W = 52;
const BABY_W = PARENT_W * BABY_SCALE;
const FAMILY_W = PARENT_W + BABY_COUNT * (BABY_W + BABY_GAP);
/** Clear ground behind one family before the next arrives. Deliberately well
 *  under the 144 px key: the family is wide, so a large gap leaves the tile
 *  looking empty for seconds at a time, and an empty tile reads as idle. */
const FAMILY_TAILGAP = 55;

/** Blink phases spread across the blink period so no two of a family ever
 *  blink together, nudged off an even split so the spread is not itself a
 *  visible pattern. Worth stating why this is not a plain multiple: a 1130 ms
 *  step looks fine until you notice 3 x 1130 = 3390 ~ BLINK_PERIOD_MS, which
 *  put the last baby back in lockstep with the parent — the exact thing the
 *  offsets exist to prevent. */
const blinkSpread = (i: number): number => ((i + 1) * BLINK_PERIOD_MS) / (BABY_COUNT + 1) + i * 130;

/** Baby leg cadences, in ms per unit of the leg cycle. The parent's legs ride
 *  the 12-frame counter — 3 frames x 120 ms, a 360 ms step. Babies are smaller
 *  and step quicker, which is how small animals actually walk and, less
 *  obviously, the only way to desynchronise three of them.
 *
 *  Frame offsets cannot do it, however carefully chosen. The leg cycle
 *  switches every 3 frames, so it has exactly three residues; the parent
 *  occupies one, leaving two for three babies. By pigeonhole two must share a
 *  residue — and two offsets sharing a residue differ by a multiple of 3,
 *  which pins them to the same switch frame forever: identical pose if the
 *  multiple is even, exactly mirrored if it is odd. Mirrored-and-locked is
 *  still locked. The first attempt here was `[1, 2, 4]`, and `4 - 1 = 3` did
 *  precisely that to the first and third baby.
 *
 *  Distinct cadences have no such pigeonhole. Times 3, these give step periods
 *  of 282 / 249 / 303 ms against the parent's 360 ms — no two share a small
 *  common multiple, so they drift continuously instead of locking. */
const BABY_LEG_TICK_MS = [94, 83, 101] as const;

/** The slot's mascot walking with a few small copies of itself in tow — the
 *  `subagent` state's answer to `slotCharacterWalk`.
 *
 *  The family travels as one group (same direction, same pace: delegated work
 *  moves with you), but every member runs its own gait and blink phase. Shared
 *  phase is what makes a repeated sprite read as one object stamped N times
 *  rather than N individuals, so the desync is the whole point: the babies
 *  step quicker than the parent and than each other, and nobody blinks in
 *  unison. See BABY_LEG_TICK_MS for why cadence rather than offset.
 *
 *  Babies are scaled about `(72, footLine)` — the key's horizontal centre and
 *  the mascot's own shadow line — so they shrink toward the ground rather than
 *  toward the origin, and the whole family walks on one surface. */
export function subagentWalk(frame: number, _color: string, slot?: number): string {
  const n = Math.max(1, slot ?? 1);
  const dir = walkDirection(n);
  const draw = mascotFor(n);
  const pivotY = footLine(n) * (1 - BABY_SCALE);
  const pivotX = 72 * (1 - BABY_SCALE);

  let family = draw(frame, slotBlinkPhase(n));
  for (let i = 0; i < BABY_COUNT; i++) {
    // Behind the parent is opposite the direction of travel, so the family
    // follows rather than leads whichever way the character faces.
    const back = PARENT_W / 2 + BABY_GAP + BABY_W / 2 + i * (BABY_W + BABY_GAP);
    // Wall-clock rather than the shared counter, so each baby's gait runs on
    // its own clock. Monotonic and unbounded, which both channels inside the
    // mascot handle: legs take it mod 6, breathing mod 12.
    const legFrame = Math.floor(Date.now() / BABY_LEG_TICK_MS[i % BABY_LEG_TICK_MS.length]);
    const body = draw(legFrame, slotBlinkPhase(n) + blinkSpread(i));
    const x = (pivotX - dir * back).toFixed(2);
    family += `\n<g transform="translate(${x} ${pivotY.toFixed(2)}) scale(${BABY_SCALE})">${body}</g>`;
  }
  // The pace is unchanged by the longer span — `traverse` derives time from
  // distance, so the same legs cover more ground in proportionally more time.
  return traverse(family, FAMILY_W + FAMILY_TAILGAP, dir);
}

/** Blink cadence shared by every mascot: a quick ~150 ms closure every
 *  ~3.4 s — lively without being twitchy. */
const BLINK_PERIOD_MS = 3400;
const BLINK_CLOSED_MS = 150;

const blinkScaleY = (phaseMs: number): string =>
  (Date.now() + phaseMs) % BLINK_PERIOD_MS < BLINK_CLOSED_MS ? "0.1" : "1";

/** The Chrome offline runner T-Rex, in green. Faces right; breathes from the
 *  hips up, legs planted. */
function dinoIdleLook(frame: number, blinkPhaseMs: number): string {
  const breathePhase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const breatheTri = breathePhase < 0.5 ? breathePhase * 2 : (1 - breathePhase) * 2;
  const breatheY = (1 - 0.02 * breatheTri).toFixed(3);
  const c = "#22c55e";
  // Walk-in-place: two leg poses alternating every 3 frames (360 ms/step),
  // Chrome-runner style — planted leg keeps its foot, lifted leg tucks up
  // with the foot a pixel forward. Torso bobs half a pixel on the offbeat.
  // Legs reach one unit UP under the torso (drawn first, torso paints over),
  // so the torso's bob can't open a seam between body and leg.
  const stepA = Math.floor(frame / 3) % 2 === 0;
  const legL = stepA
    ? `<rect x="4" y="9" width="2" height="5" fill="${c}"/><rect x="4" y="13" width="3" height="1" fill="${c}"/>`
    : `<rect x="4" y="9" width="2" height="4" fill="${c}"/><rect x="5" y="12" width="3" height="1" fill="${c}"/>`;
  const legR = stepA
    ? `<rect x="7" y="9" width="2" height="4" fill="${c}"/><rect x="8" y="12" width="3" height="1" fill="${c}"/>`
    : `<rect x="7" y="9" width="2" height="5" fill="${c}"/><rect x="7" y="13" width="3" height="1" fill="${c}"/>`;
  const bob = stepA ? "0" : "-0.5";
  // Tail tip wags against the stride, same trick as the sauropod.
  const tailTipY = stepA ? 4 : 3;
  return `<g transform="translate(46 35) scale(4)">
<rect x="2" y="15" width="9" height="1" fill="#000" opacity="0.45"/>
${legL}
${legR}
<g transform="translate(0 ${bob})">
<g transform="translate(6.5 10) scale(1 ${breatheY}) translate(-6.5 -10)">
<rect x="0" y="${tailTipY}" width="2" height="2" fill="${c}"/>
<rect x="1" y="5" width="2" height="3" fill="${c}"/>
<rect x="3" y="5" width="6" height="5" fill="${c}"/>
<rect x="7" y="3" width="2" height="2" fill="${c}"/>
<rect x="6" y="0" width="7" height="3" fill="${c}"/>
<rect x="6" y="3" width="4" height="1" fill="${c}"/>
<rect x="8" y="6" width="2" height="1" fill="${c}"/>
<g transform="translate(8.5 1.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-8.5 -1.5)">
<rect x="8" y="1" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

/** A cute blue sauropod — the Apple 🦕 long-neck herbivore, in the same
 *  pixel idiom as the T-Rex. Faces left; stepped neck, lighter belly, darker
 *  back spots. Walks in place with a wagging tail. */
function sauropodIdleLook(frame: number, blinkPhaseMs: number): string {
  const breathePhase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const breatheTri = breathePhase < 0.5 ? breathePhase * 2 : (1 - breathePhase) * 2;
  const breatheY = (1 - 0.02 * breatheTri).toFixed(3);
  const c = "#4ab8d1";
  const belly = "#a8e0ec";
  const spot = "#2d8fa8";
  // Same stroll cadence as the T-Rex, phase-flipped so the pair don't march
  // in lockstep on adjacent keys. The lifted leg shortens off the ground and
  // the tail tip wags against the stride.
  const stepA = Math.floor(frame / 3) % 2 === 1;
  // Same seam guard as the T-Rex: leg tops tuck one unit under the body.
  const legF = stepA
    ? `<rect x="4" y="11" width="2" height="4" fill="${c}"/>`
    : `<rect x="4" y="11" width="2" height="3" fill="${c}"/>`;
  const legB = stepA
    ? `<rect x="9" y="11" width="2" height="3" fill="${c}"/>`
    : `<rect x="9" y="11" width="2" height="4" fill="${c}"/>`;
  const tailTipY = stepA ? 6 : 5;
  const bob = stepA ? "0" : "-0.5";
  return `<g transform="translate(42 35) scale(4)">
<rect x="2" y="15" width="11" height="1" fill="#000" opacity="0.45"/>
${legF}
${legB}
<g transform="translate(0 ${bob})">
<g transform="translate(7.5 12) scale(1 ${breatheY}) translate(-7.5 -12)">
<rect x="3" y="7" width="9" height="5" fill="${c}"/>
<rect x="5" y="10" width="6" height="2" fill="${belly}"/>
<rect x="12" y="7" width="2" height="2" fill="${c}"/>
<rect x="14" y="${tailTipY}" width="1" height="2" fill="${c}"/>
<rect x="3" y="5" width="2" height="2" fill="${c}"/>
<rect x="2" y="2" width="2" height="4" fill="${c}"/>
<rect x="0" y="0" width="3" height="3" fill="${c}"/>
<rect x="5" y="7" width="1" height="1" fill="${spot}"/>
<rect x="8" y="7" width="1" height="1" fill="${spot}"/>
<rect x="11" y="8" width="1" height="1" fill="${spot}"/>
<g transform="translate(1.5 1) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-1.5 -1)">
<rect x="1" y="1" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

/** A cream llama in side profile, facing left — perky ears, long neck,
 *  fluffy tail nub. Breathes from the shoulders up. */
function llamaIdleLook(frame: number, blinkPhaseMs: number): string {
  const breathePhase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const breatheTri = breathePhase < 0.5 ? breathePhase * 2 : (1 - breathePhase) * 2;
  const breatheY = (1 - 0.02 * breatheTri).toFixed(3);
  const c = "#ecd9b0";
  const shade = "#c8a165";
  // Same stroll idiom as the dinos: two legs (side view), front and back
  // alternating every 3 frames, lifted leg shortened off the ground, tops
  // tucked under the body, torso bob on the offbeat.
  const stepA = Math.floor(frame / 3) % 2 === 0;
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="12" width="1" height="${planted ? 3 : 2}" fill="${c}"/>`;
  const legs = stepA ? leg(3, true) + leg(10, false) : leg(3, false) + leg(10, true);
  const bob = stepA ? "0" : "-0.5";
  return `<g transform="translate(46 35) scale(4)">
<rect x="1" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<rect x="2" y="9" width="10" height="4" fill="${c}"/>
<rect x="11" y="8" width="2" height="2" fill="${c}"/>
<g transform="translate(3 9) scale(1 ${breatheY}) translate(-3 -9)">
<rect x="2" y="5" width="2" height="4" fill="${c}"/>
<rect x="0" y="0" width="1" height="2" fill="${c}"/>
<rect x="2" y="0" width="1" height="2" fill="${c}"/>
<rect x="0" y="2" width="4" height="3" fill="${c}"/>
<rect x="0" y="4" width="2" height="1" fill="${shade}"/>
<g transform="translate(1.5 3.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-1.5 -3.5)">
<rect x="1" y="3" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

/** A cute baby elephant in side profile, facing left — oversized head, big
 *  floppy ear with a pink inner, trunk that swings with the stride, chunky
 *  stubby legs. Strolls phase-opposed to the llama next door. */
function elephantIdleLook(frame: number, blinkPhaseMs: number): string {
  const breathePhase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const breatheTri = breathePhase < 0.5 ? breathePhase * 2 : (1 - breathePhase) * 2;
  const breatheY = (1 - 0.02 * breatheTri).toFixed(3);
  const c = "#9fa8ba";
  const ear = "#c6cedd";
  const tuft = "#5f6878";
  const pink = "#f2a6b3";
  const stepA = Math.floor(frame / 3) % 2 === 1;
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="10" width="2" height="${planted ? 5 : 4}" fill="${c}"/>`;
  const legs = stepA ? leg(5, true) + leg(10, false) : leg(5, false) + leg(10, true);
  const bob = stepA ? "0" : "-0.5";
  // Trunk swings with the walk: curled tip on one beat, hanging straight on
  // the other.
  const trunk = stepA
    ? `<rect x="0" y="7" width="1" height="3" fill="${c}"/><rect x="1" y="9" width="1" height="1" fill="${c}"/>`
    : `<rect x="0" y="7" width="1" height="4" fill="${c}"/>`;
  // Tail: a shaded shaft (darker than the body so it doesn't melt into the
  // silhouette) hanging past the rump, tipped with a dark tuft in open space
  // below the belly line. Flicks outward on the offbeat.
  const shaft = "#7d8698";
  const tail = stepA
    ? `<rect x="13" y="5" width="1" height="6" fill="${shaft}"/><rect x="13" y="11" width="1" height="2" fill="${tuft}"/>`
    : `<rect x="13" y="5" width="1" height="5" fill="${shaft}"/><rect x="14" y="10" width="1" height="2" fill="${shaft}"/><rect x="14" y="12" width="1" height="1" fill="${tuft}"/>`;
  return `<g transform="translate(44 35) scale(4)">
<rect x="1" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(6.5 10) scale(1 ${breatheY}) translate(-6.5 -10)">
${tail}
<rect x="4" y="4" width="9" height="7" fill="${c}"/>
<rect x="0" y="2" width="5" height="5" fill="${c}"/>
${trunk}
<rect x="4" y="2" width="3" height="5" fill="${ear}"/>
<rect x="5" y="4" width="1" height="1" fill="${pink}"/>
<g transform="translate(1.5 4.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-1.5 -4.5)">
<rect x="1" y="4" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

export function finishedCheck(_frame: number, color: string): string {
  return `<circle cx="72" cy="60" r="28" fill="${color}" opacity="0.18"/>
<circle cx="72" cy="60" r="28" fill="none" stroke="${color}" stroke-width="3.5" opacity="0.85"/>
<path d="M58 61 L68 71 L88 51" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function emptyDashed(_frame: number, color: string): string {
  return `<rect x="22" y="34" width="100" height="56" rx="9" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 4"/>
<path d="M72 46 L72 78 M56 62 L88 62" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>`;
}

export function errorBolt(frame: number, color: string): string {
  // Warning triangle with `!` glyph, pulsing in time with awaitingPulse so the
  // family relationship reads as "needs attention" — but the red palette in
  // states.ts makes the urgency unmistakable.
  const phase = frame / ANIMATION_FRAMES;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const opacity = 0.6 + t * 0.4;
  const stroke = (4 + t * 1.5).toFixed(1);
  return `<path d="M72 32 L100 82 a4 4 0 0 1 -3.5 6 H47.5 a4 4 0 0 1 -3.5 -6 Z" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" opacity="${opacity.toFixed(2)}"/>
<rect x="69" y="50" width="6" height="18" rx="2.5" fill="${color}"/>
<circle cx="72" cy="76" r="3.2" fill="${color}"/>`;
}

export function subagentBranch(frame: number, color: string): string {
  // A spinner arc + an orbiting satellite — visually rhymes with `spinnerArc`
  // (same core spin) but the satellite reads as "delegated work running in
  // parallel". Used while a Task tool / subagent is active.
  const cx = 72, cy = 60;
  const mainR = 18;
  const mainStartDeg = (frame * 360) / ANIMATION_FRAMES;
  const mainSweep = 220;
  const mainEndDeg = mainStartDeg + mainSweep;
  const toXY = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [mx1, my1] = toXY(mainR, mainStartDeg);
  const [mx2, my2] = toXY(mainR, mainEndDeg);
  const mainLargeArc = mainSweep > 180 ? 1 : 0;
  // Satellite spins twice as fast, opposite direction.
  const satDeg = -(frame * 720) / ANIMATION_FRAMES;
  const orbitR = 30;
  const [sx, sy] = toXY(orbitR, satDeg);
  return `<path d="M ${mx1.toFixed(2)} ${my1.toFixed(2)} A ${mainR} ${mainR} 0 ${mainLargeArc} 1 ${mx2.toFixed(2)} ${my2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="5" fill="${color}"/>`;
}
