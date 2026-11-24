import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const px = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A sheep in left-facing profile: a lumpy fleece cloud built from
 *  overlapping puffs, a dark face under a wool topknot, four thin dark legs.
 *  The cloud outline and the dark face are what keep it apart from the white
 *  goose. The eye is a dark pupil with a white catch, because a black pixel
 *  alone disappears into the grey face. The ear lies over the white fleece,
 *  not the tile, so its flick shows. */
function draw(frame: number, blinkPhaseMs: number): string {
  const wool = "#f8fafc";
  const shade = "#cbd5e1";
  const face = "#4b5563";
  const pupil = "#111827";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean) => px(x, 10, 1, planted ? 5 : 4, face);
  const legs = stepA
    ? leg(7, false) + leg(11, true) + leg(5, true) + leg(13, false)
    : leg(7, true) + leg(11, false) + leg(5, false) + leg(13, true);
  const earY = stepA ? 5 : 4;
  const ear = px(5, earY, 2, 1, face) + px(6, earY, 1, 1, "#e8a0b4");
  return `<g transform="translate(42 35) scale(4)">
<rect x="3" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 11) scale(1 ${breatheScaleY(frame)}) translate(-8 -11)">
${px(4, 3, 10, 7, wool)}
${px(5, 2, 8, 9, wool)}
${px(5, 1, 3, 2, wool)}
${px(9, 1, 3, 2, wool)}
${px(14, 4, 1, 2, wool)}
${px(14, 7, 1, 2, wool)}
${px(5, 10, 3, 2, wool)}
${px(10, 10, 3, 2, wool)}
${px(6, 11, 2, 1, shade)}
${px(11, 11, 2, 1, shade)}
${px(8, 9, 2, 1, shade)}
${px(12, 5, 2, 1, shade)}
${px(9, 6, 1, 1, shade)}
${px(10, 3, 2, 1, shade)}
${px(6, 3, 1, 1, shade)}
${px(1, 4, 4, 4, face)}
${px(0, 5, 5, 2, face)}
${px(1, 7, 2, 2, face)}
${px(2, 2, 3, 2, wool)}
${px(1, 3, 5, 1, wool)}
${ear}
<g transform="translate(2.5 5.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-2.5 -5.5)">
${px(2, 5, 1, 1, pupil)}
${px(2, 5, 0.5, 0.5, "#fff")}
</g>
</g>
</g>
</g>`;
}

export const sheep: Mascot = { name: "sheep", draw, dir: -1, foot: 95 };
