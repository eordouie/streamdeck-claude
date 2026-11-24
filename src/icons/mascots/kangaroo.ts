import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const px = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A kangaroo in right-facing profile, standing on the tripod of its long hind
 *  foot and its tail. What says "kangaroo" is spread over four shapes, so each
 *  is drawn as its own: the long foot flat on the ground in front of a round
 *  haunch; a thick tail that leaves the rump low, with a notch of tile between
 *  it and the back of the leg (merged into one ramp, tail and haunch read as a
 *  tan wedge); a big head with two separate upright ears on a neck narrower
 *  than head and chest; and a joey's head in the pouch.
 *
 *  The joey is the mother's sand, framed by cream on three sides: a lighter
 *  tan washed into the cream at 72 px, and a joey touching the mother's sand
 *  merged into her chest.
 *
 *  It hops rather than steps: the body lifts one unit on the offbeat, the tail
 *  swings out straight behind, and the shadow stays on the ground line and
 *  narrows. The head holds level, so the ears stay upright with their tips at
 *  y=-3; sweeping them flat to fit a two-unit hop made them read as a cap. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#d4a373";
  const shade = "#b8875a";
  const belly = "#f3e3c3";
  const inner = "#e9b9a0";
  const nose = "#5b3a29";
  const stepA = isStepA(frame);
  const lift = stepA ? "0" : "-1";
  const level = stepA ? "0" : "1";
  const [shadowX, shadowW] = stepA ? [1, 15] : [5, 10];
  const tail = stepA
    ? px(2, 13, 6, 2, c) + px(0, 14, 2, 1, c)
    : px(2, 12, 6, 2, c) + px(0, 12, 2, 1, c);
  return `<g transform="translate(40 35) scale(4)">
<rect x="${shadowX}" y="15" width="${shadowW}" height="1" fill="#000" opacity="0.45"/>
<g transform="translate(0 ${lift})">
${tail}
${px(7, 8, 5, 6, c)}
${px(5, 9, 7, 2, c)}
${px(6, 8, 6, 3, c)}
${px(8, 13, 4, 2, c)}
${px(12, 14, 4, 1, c)}
<g transform="translate(11 9) scale(1 ${breatheScaleY(frame)}) translate(-11 -9)">
${px(9, 5, 5, 4, c)}
${px(11, 5, 3, 7, belly)}
${px(12, 7, 3, 2, c)}
${px(12, 6, 1, 1, c)}
${px(14, 6, 1, 1, c)}
<g transform="translate(13.5 7.5) scale(1 ${blinkScaleY(blinkPhaseMs + 1300)}) translate(-13.5 -7.5)">
${px(13, 7, 1, 1, "#000")}
</g>
<g transform="translate(0 ${level})">
${px(10, 3, 3, 3, c)}
${px(9, -3, 1, 3, shade)}
${px(11, -3, 2, 3, c)}
${px(12, -2, 1, 2, inner)}
${px(9, 0, 5, 3, c)}
${px(14, 1, 2, 2, c)}
${px(15, 1, 1, 1, nose)}
<g transform="translate(12.5 1.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-12.5 -1.5)">
${px(12, 1, 1, 1, "#000")}
</g>
</g>
</g>
</g>
</g>`;
}

export const kangaroo: Mascot = { name: "kangaroo", draw, dir: 1, foot: 95 };
