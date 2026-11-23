import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const SLATE = "#334155";
const RIM = "#64748b";
const BELLY = "#f8fafc";
const BELLY_SHADE = "#cbd5e1";
const ORANGE = "#f97316";
const EYE = "#0f172a";

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A penguin in three-quarter view, facing right: an upright slate egg with a
 *  white face and belly, an orange beak and feet, a flipper at each side.
 *
 *  The egg is drawn in three horizontal bands (head, chest, hips) so the walk
 *  can be a waddle: the bands lean over the planted foot in pixel steps. Each
 *  band is built from overlapping rects that run its full height, and each
 *  band tucks half a unit of fill under the band above. Stacked one-row rects
 *  sharing an edge open hairline seams as soon as breathing scales the body to
 *  fractional heights. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // Head a full unit over the planted foot, chest half a unit, hips not at
  // all. rotate() would be the literal tilt, but it smears every edge of a
  // pixel sprite.
  const lean = stepA ? -1 : 1;
  const foot = (x: number, planted: boolean): string =>
    planted
      ? r(x + 1, 12, 1, 2, ORANGE) + r(x, 14, 3, 1, ORANGE)
      : r(x + 1, 12, 1, 1, ORANGE) + r(x + 1, 13, 3, 1, ORANGE);
  const feet = stepA ? foot(3, true) + foot(7, false) : foot(3, false) + foot(7, true);
  // The flipper on the high side lifts out for balance.
  const flipL = stepA ? r(0, 6, 1, 4, SLATE) : r(-1, 5, 1, 1, SLATE) + r(0, 5, 1, 4, SLATE);
  const flipR = stepA ? r(12, 5, 1, 4, SLATE) + r(13, 5, 1, 1, SLATE) : r(12, 6, 1, 4, SLATE);
  const hips = [
    r(2, 8.5, 9, 0.5, SLATE),
    r(1, 9, 11, 2, SLATE),
    r(2, 9, 9, 3, SLATE),
    r(3, 9, 7, 4, SLATE),
    r(1, 9, 1, 2, RIM),
    r(2, 11, 1, 1, RIM),
    r(4.5, 8.5, 6, 0.5, BELLY),
    r(4, 9, 7, 2, BELLY),
    r(5, 9, 5, 3, BELLY),
    r(6, 12, 3, 1, BELLY_SHADE),
  ].join("\n");
  const chest = [
    flipL,
    flipR,
    r(3, 4.5, 7, 0.5, SLATE),
    r(2, 5, 9, 4, SLATE),
    r(1, 7, 11, 2, SLATE),
    r(2, 5, 1, 2, RIM),
    r(1, 7, 1, 2, RIM),
    r(5.5, 4.5, 4, 0.5, BELLY),
    r(5, 5, 5, 4, BELLY),
    r(5, 6, 6, 3, BELLY),
    r(4, 7, 7, 2, BELLY),
  ].join("\n");
  const head = [
    r(4, 0, 5, 5, SLATE),
    r(3, 1, 7, 4, SLATE),
    r(2, 2, 9, 3, SLATE),
    r(4, 0, 2, 1, RIM),
    r(3, 1, 1, 1, RIM),
    r(2, 2, 1, 3, RIM),
    r(6, 2, 3, 3, BELLY),
    r(5, 3, 5, 2, BELLY),
    r(10, 4, 3, 1, ORANGE),
  ].join("\n");
  return `<g transform="translate(46 35) scale(4)">
<rect x="2" y="15" width="10" height="1" fill="#000" opacity="0.45"/>
${feet}
<g transform="translate(0 ${bob})">
<g transform="translate(6.5 13) scale(1 ${breatheScaleY(frame)}) translate(-6.5 -13)">
${hips}
<g transform="translate(${lean / 2} 0)">
${chest}
</g>
<g transform="translate(${lean} 0)">
${head}
<g transform="translate(8.5 3.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-8.5 -3.5)">
${r(8, 3, 1, 1, EYE)}
</g>
</g>
</g>
</g>
</g>`;
}

export const penguin: Mascot = { name: "penguin", draw, dir: 1, foot: 95 };
