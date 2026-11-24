import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const YELLOW = "#facc15";
const STRIPE = "#374151";
const WING = "#e0f2fe";
const GLINT = "#f8fdff";
const FEELER = "#6b7280";
const EYE = "#111827";

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A wing is a few overlapping rects under one group opacity, so the overlaps
 *  composite once instead of stacking into a darker cross. */
const wing = (opacity: number, rects: string): string => `<g opacity="${opacity}">${rects}</g>`;

/** A bumblebee facing left, hovering above its shadow: a yellow oval with two
 *  dark bands, a grey stinger, two antennae and pale wings that beat as its
 *  secondary motion. The hover bob is a full unit, twice a walker's. The bands
 *  stay 1.5 units wide and the tail end stays yellow: two 2-unit bands plus a
 *  dark tail sank half the body into the tile. Dangling legs swing on the
 *  step. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-1";
  const legs = stepA
    ? r(5, 10, 1, 3, FEELER) + r(7, 10, 1, 3, FEELER) + r(9, 10, 1, 3, FEELER)
    : r(5.5, 10, 1, 2.5, FEELER) + r(7.5, 10, 1, 2.5, FEELER) + r(9.5, 10, 1, 2.5, FEELER);
  // Upstroke: two teardrops raked back toward the tail (upright ovals read as
  // ears). Downstroke: swept flat over the back. The bright leading edge on
  // the near wing is what makes it read as glass rather than a grey patch.
  const wings = stepA
    ? wing(0.55, r(11, 0, 2, 2, WING) + r(10, 1, 3, 2, WING) + r(9, 2, 3, 3, WING) + r(9, 4, 2, 2, WING)) +
      wing(0.85, r(8, -1, 2, 2, WING) + r(7, 0, 3, 2, WING) + r(6, 1, 3, 3, WING) + r(6, 3, 2, 2, WING)) +
      r(8, -1, 1, 1, GLINT) +
      r(7, 0, 1, 1, GLINT) +
      r(6, 1, 1, 2, GLINT)
    : wing(0.55, r(11, 2, 3, 3, WING) + r(10, 3, 5, 1, WING)) +
      wing(0.85, r(8, 3, 4, 2, WING) + r(9, 2, 2, 4, WING)) +
      r(9, 2, 2, 1, GLINT) +
      r(8, 3, 1, 1, GLINT);
  return `<g transform="translate(44 35) scale(4)">
<rect x="3" y="15" width="9" height="1" fill="#000" opacity="0.45"/>
<g transform="translate(0 ${bob})">
${legs}
${wings}
<g transform="translate(7 11) scale(1 ${breatheScaleY(frame)}) translate(-7 -11)">
${r(4, 4, 1, 1, FEELER)}
${r(3, 3, 1, 1, FEELER)}
${r(2, 2, 1, 1, FEELER)}
${r(6, 3, 1, 2, FEELER)}
${r(5, 2, 1, 1, FEELER)}
${r(4, 5, 7, 7, YELLOW)}
${r(3, 6, 9, 5, YELLOW)}
${r(2, 7, 11, 3, YELLOW)}
${r(6, 5, 1.5, 7, STRIPE)}
${r(9, 5, 1.5, 7, STRIPE)}
${r(13, 8, 1, 1, FEELER)}
<g transform="translate(4.5 7.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-4.5 -7.5)">
${r(4, 7, 1, 1, EYE)}
</g>
</g>
</g>
</g>`;
}

export const bee: Mascot = { name: "bee", draw, dir: -1, foot: 95 };
