import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const YELLOW = "#fde047";
const SHADE = "#facc15";
const ORANGE = "#f97316";
const EYE = "#1c1917";
const CHEEK = "#fdba74";

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A yellow duckling facing left: a round head on a round body, flat orange
 *  bill, a tuft, a tiny wing that flicks up on the offbeat, a warm cheek.
 *  The chest sits a unit behind the chin; with head and chest sharing one
 *  front edge the two read as a single tall block. Round and neckless on
 *  purpose, so it never reads as a small goose. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean): string =>
    planted
      ? r(x, 12, 1, 2, ORANGE) + r(x - 1, 14, 2, 1, ORANGE)
      : r(x, 12, 1, 1, ORANGE) + r(x - 1, 13, 2, 1, ORANGE);
  const legs = stepA ? leg(6, true) + leg(9, false) : leg(6, false) + leg(9, true);
  const wing = stepA
    ? r(7, 8, 4, 2, SHADE) + r(11, 8, 1, 1, SHADE)
    : r(7, 7, 4, 2, SHADE) + r(10, 6, 2, 1, SHADE);
  return `<g transform="translate(44 35) scale(4)">
<rect x="2" y="15" width="11" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(7 13) scale(1 ${breatheScaleY(frame)}) translate(-7 -13)">
${r(12, 6, 1, 2, YELLOW)}
${r(13, 5, 1, 2, YELLOW)}
${r(5, 6, 6, 7, YELLOW)}
${r(4, 7, 9, 5, YELLOW)}
${r(3, 8, 10, 3, YELLOW)}
${r(5, 12, 6, 1, SHADE)}
${wing}
${r(3, 1, 5, 6, YELLOW)}
${r(2, 2, 7, 4, YELLOW)}
${r(4, 0, 2, 1, YELLOW)}
${r(5, -1, 1, 1, YELLOW)}
${r(0, 4, 3, 1, ORANGE)}
${r(0, 5, 2, 1, ORANGE)}
${r(5, 5, 1, 1, CHEEK)}
<g transform="translate(4.5 3.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-4.5 -3.5)">
${r(4, 3, 1, 1, EYE)}
</g>
</g>
</g>
</g>`;
}

export const duckling: Mascot = { name: "duckling", draw, dir: -1, foot: 95 };
