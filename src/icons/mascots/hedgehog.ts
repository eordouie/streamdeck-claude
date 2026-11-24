import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const SPINE = "#92400e";
const TIP = "#b45309";
const FACE = "#fde8c8";
const NOSE = "#3b2416";
const FEET = "#d4a373";

/** Quills standing above the top of the dome: [x, topY, height]. Tall and
 *  short columns alternate so the sawtooth leans back like real quills. */
const TOP_QUILLS: [number, number, number][] = [
  [0, 4, 2],
  [1, 3, 2],
  [2, 4, 1],
  [3, 2, 2],
  [4, 3, 1],
  [5, 2, 2],
  [6, 3, 1],
  [7, 2, 2],
  [8, 3, 1],
  [9, 3, 2],
  [10, 4, 1],
];
/** Lighter quill ends inside the coat, staggered so the dome reads as spines
 *  rather than a smooth brown cap. */
const COAT_FLECKS: [number, number][] = [
  [2, 6],
  [5, 5],
  [8, 6],
  [0, 8],
  [3, 8],
  [6, 7],
  [1, 10],
  [4, 10],
  [7, 9],
];
/** Quills sticking out of the rump: [leftX, y, width]. */
const BACK_QUILLS: [number, number, number][] = [
  [-1, 6, 1],
  [-2, 7, 2],
  [-2, 9, 1],
  [-2, 11, 1],
];

/** A hedgehog in right-facing profile: a dome of quills, a cream face ending
 *  in a pointed snout and a dark nose, tiny feet. The outline is the sawtooth
 *  of quills running along the whole back, every tooth leaning backward. With
 *  teeth on the crown alone it read as a flame or a crown. The nose sniffs
 *  with the stride. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="11" width="2" height="${planted ? 4 : 3}" fill="${FEET}"/>`;
  const legs = stepA ? leg(2, true) + leg(8, false) : leg(2, false) + leg(8, true);
  const noseY = stepA ? 10 : 9.5;
  const quills =
    TOP_QUILLS.map(
      ([x, y, h]) =>
        `<rect x="${x}" y="${y}" width="1" height="${h + 1}" fill="${SPINE}"/><rect x="${x}" y="${y}" width="1" height="1" fill="${TIP}"/>`
    ).join("\n") +
    "\n" +
    BACK_QUILLS.map(
      ([x, y, w]) =>
        `<rect x="${x}" y="${y}" width="${w + 1}" height="1" fill="${SPINE}"/><rect x="${x}" y="${y}" width="1" height="1" fill="${TIP}"/>`
    ).join("\n");
  return `<g transform="translate(46 35) scale(4)">
<rect x="0" y="15" width="13" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(6 12) scale(1 ${breatheScaleY(frame)}) translate(-6 -12)">
${quills}
<rect x="3" y="4" width="6" height="9" fill="${SPINE}"/>
<rect x="1" y="5" width="10" height="8" fill="${SPINE}"/>
<rect x="0" y="6" width="12" height="6" fill="${SPINE}"/>
<rect x="-1" y="8" width="12" height="4" fill="${SPINE}"/>
${COAT_FLECKS.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${TIP}"/>`).join("")}
<rect x="9" y="8" width="3" height="4" fill="${FACE}"/>
<rect x="8" y="9" width="5" height="3" fill="${FACE}"/>
<rect x="8" y="10" width="6" height="1" fill="${FACE}"/>
<rect x="7" y="11" width="5" height="2" fill="${FACE}"/>
<rect x="2" y="12" width="9" height="1" fill="${FACE}"/>
<rect x="14" y="${noseY}" width="1" height="1" fill="${NOSE}"/>
<g transform="translate(10.5 9.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-10.5 -9.5)">
<rect x="10" y="9" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

export const hedgehog: Mascot = { name: "hedgehog", draw, dir: 1, foot: 95 };
