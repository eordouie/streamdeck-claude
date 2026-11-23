/** What every mascot sprite shares: the frame counter, the blink clock and the
 *  contract a sprite fulfils. Lives apart from motifs.ts so a sprite file under
 *  `mascots/` can import it without importing the roster that imports it. */

/** Frame count of one motif-animation period. */
export const ANIMATION_FRAMES = 12;

/** Blink cadence shared by every mascot: a quick ~150 ms closure every
 *  ~3.4 s — lively without being twitchy. */
export const BLINK_PERIOD_MS = 3400;
export const BLINK_CLOSED_MS = 150;

/** `scaleY` for an eye group: "0.1" inside the blink window, "1" outside it.
 *  Wall-clock driven, because the cadence does not divide the frame counter. */
export const blinkScaleY = (phaseMs: number): string =>
  (Date.now() + phaseMs) % BLINK_PERIOD_MS < BLINK_CLOSED_MS ? "0.1" : "1";

/** `scaleY` for the upper body: 0.98..1, two beats per frame loop. */
export function breatheScaleY(frame: number): string {
  const phase = ((frame * 2) % ANIMATION_FRAMES) / ANIMATION_FRAMES;
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return (1 - 0.02 * tri).toFixed(3);
}

/** The two-pose leg cycle every walker shares: 3 frames (360 ms) per step. */
export const isStepA = (frame: number): boolean => Math.floor(frame / 3) % 2 === 0;

/** One key's character, and the two facts the motion code needs about it.
 *
 *  A mascot is a uniform `(frame, blinkPhaseMs)` function: the walking and
 *  subagent motifs drive those two channels independently of the slot, which
 *  is the only thing `slotCharacterIdle` derives them from — a family of the
 *  same character needs one sprite per member on its own phase.
 *
 *  Direction and foot line live here rather than in their own per-slot
 *  switches. They were three parallel `switch ((slot - 1) % 5)` blocks, which
 *  is a standing invitation to add a character to two of them and leave the
 *  third behind — a mascot that moonwalks, or a family whose babies hover. */
export type Mascot = {
  /** The animal, for contact sheets and logs. Never drawn on a key. */
  name?: string;
  draw: (frame: number, blinkPhaseMs: number) => string;
  /** Travel direction. Every mascot walks the way it faces, or it moonwalks. */
  dir: 1 | -1;
  /** Key-space y of the shadow: the sprite's base translate + 60, since every
   *  mascot draws its shadow at local y=15 under `scale(4)`. Clawd is the one
   *  that sits higher. Babies are scaled about this line, so a family walks on
   *  the same ground however small its members are. */
  foot: number;
  /** Baby sprite for the `subagent` family, when a small copy of `draw`
   *  wouldn't read as the same animal's young — a hatchling with an adult's
   *  full markings reads as "shrunk in a wash", not "young". No mascot needs
   *  one right now (every current baby is believably just a small copy of
   *  its parent, the elephant and llama's included), but the hen/chick and
   *  cat/kitten pairs both needed it before those animals were replaced —
   *  keep the field for whichever mascot needs it next. Defaults to `draw`. */
  drawBaby?: (frame: number, blinkPhaseMs: number) => string;
};
