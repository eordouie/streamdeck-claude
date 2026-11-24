import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const RED = "#dc2626";
const DOT = "#111827";
const HEAD = "#374151";
const HEAD_LIT = "#4b5563";
const LEG = "#6b7280";
const FAR_LEG = "#4b5563";
const SPOT = "#f8fafc";

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A ladybug facing right: a red semi-elliptical dome split by a dark centre
 *  line, a dark head with two white eye spots, six tiny legs, two antennae
 *  that twitch on the step. The spots are staggered on purpose: spots lined
 *  up in columns either side of the centre line read as the letters "dB" at
 *  72 px. The dome is ten rows tall so the bug carries the same weight on the
 *  key as the stegosaurus. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean, fill: string): string => r(x, 13, 1, planted ? 2 : 1.5, fill);
  // Tripod gait: near front, far middle and near back step together, then
  // the other three.
  const legs = [
    leg(3.5, !stepA, FAR_LEG),
    leg(7.5, stepA, FAR_LEG),
    leg(11, !stepA, FAR_LEG),
    leg(2, stepA, LEG),
    leg(5.5, !stepA, LEG),
    leg(9.5, stepA, LEG),
  ].join("\n");
  const antennae = stepA
    ? r(13, 8, 1, 2, LEG) + r(12, 7, 1, 1, LEG) + r(15, 8, 1, 2, LEG) + r(15, 7, 1, 1, LEG)
    : r(13, 8, 1, 2, LEG) + r(13, 7, 1, 1, LEG) + r(15, 8, 1, 2, LEG) + r(14, 7, 1, 1, LEG);
  return `<g transform="translate(40 35) scale(4)">
<rect x="1" y="15" width="14" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(6.5 14) scale(1 ${breatheScaleY(frame)}) translate(-6.5 -14)">
${antennae}
${r(13, 10, 3, 4, HEAD)}
${r(13, 10, 3, 1, HEAD_LIT)}
${r(4, 4, 5, 10, RED)}
${r(3, 5, 7, 9, RED)}
${r(2, 6, 9, 8, RED)}
${r(1, 7, 11, 7, RED)}
${r(0, 9, 13, 4, RED)}
${r(6, 4, 1, 10, DOT)}
${r(2, 7, 2, 2, DOT)}
${r(4, 5, 1, 1, DOT)}
${r(4, 11, 1, 1, DOT)}
${r(1, 11, 1, 1, DOT)}
${r(8, 6, 1, 1, DOT)}
${r(9, 9, 2, 2, DOT)}
${r(8, 12, 1, 1, DOT)}
<g transform="translate(14 11.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-14 -11.5)">
${r(13, 11, 1, 1, SPOT)}
${r(15, 11, 1, 1, SPOT)}
</g>
</g>
</g>
</g>`;
}

export const ladybug: Mascot = { name: "ladybug", draw, dir: 1, foot: 95 };
