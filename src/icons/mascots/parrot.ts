import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const RED = "#ef4444";
const BLUE = "#3b82f6";
const YELLOW = "#facc15";
const BEAK = "#f5f0dc";
const JAW = "#374151";
const FOOT = "#9ca3af";
const EYE = "#111827";
const FACE = "#fff1f2";

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A scarlet macaw standing upright, facing right. Four features carry it:
 *  the pale hooked beak (the gap under the hook is the hook), the white face
 *  patch round the eye, the yellow and blue wing bands, and the long tail
 *  raked down to the ground, whose blue tip flicks on the offbeat. The chest
 *  starts below a notch under the chin; without it head and body merge into
 *  one red slab. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean): string =>
    planted ? r(x, 11, 1, 3, FOOT) + r(x, 14, 2, 1, FOOT) : r(x, 11, 1, 2, FOOT) + r(x, 13, 2, 1, FOOT);
  const legs = stepA ? leg(8, true) + leg(10, false) : leg(8, false) + leg(10, true);
  const tailTip = stepA ? r(0, 13, 3, 2, BLUE) : r(0, 12, 3, 2, BLUE);
  return `<g transform="translate(40 35) scale(4)">
<rect x="1" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 12) scale(1 ${breatheScaleY(frame)}) translate(-8 -12)">
${tailTip}
${r(2, 12, 3, 2, RED)}
${r(4, 11, 3, 2, RED)}
${r(6, 5, 6, 7, RED)}
${r(7, 4, 5, 5, RED)}
${r(12, 6, 1, 3, RED)}
${r(6, 6, 3, 1, YELLOW)}
${r(5, 7, 4, 1, YELLOW)}
${r(4, 8, 5, 2, BLUE)}
${r(4, 10, 4, 1, BLUE)}
${r(3, 11, 3, 1, BLUE)}
${r(8, 0, 4, 5, RED)}
${r(7, 1, 6, 3, RED)}
${r(13, 1, 2, 2, BEAK)}
${r(15, 2, 1, 2, BEAK)}
${r(13, 3, 1, 1, JAW)}
${r(10, 1, 2, 3, FACE)}
<g transform="translate(10.5 2.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-10.5 -2.5)">
${r(10, 2, 1, 1, EYE)}
</g>
</g>
</g>
</g>`;
}

export const parrot: Mascot = { name: "parrot", draw, dir: 1, foot: 95 };
