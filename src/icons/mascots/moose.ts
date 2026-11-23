import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const px = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A moose in left-facing profile. The palmate antlers are the outline: two
 *  wide palms of three tines each, spreading fore and aft over the head. The
 *  lower legs are pale, as a real moose's are, which is also what keeps four
 *  thin legs visible on the near-black tile. The head nods against the body's
 *  bob, so the antler tips hold at y=-3 instead of rising into the name.
 *  Same-coloured rects overlap rather than abut, so the half-pixel edges at
 *  72 px leave no seams. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#8b5a2b";
  const far = "#74491f";
  const antler = "#d6b98c";
  const stock = "#c9b79c";
  const farStock = "#a8977e";
  const nose = "#a06b3a";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const nod = stepA ? "0" : "0.5";
  const leg = (x: number, top: string, low: string, planted: boolean) =>
    px(x, 8, 1, 4, top) + px(x, 11, 1, planted ? 4 : 3, low);
  const legs = stepA
    ? leg(9, far, farStock, false) + leg(12, far, farStock, true) + leg(7, c, stock, true) + leg(14, c, stock, false)
    : leg(9, far, farStock, true) + leg(12, far, farStock, false) + leg(7, c, stock, false) + leg(14, c, stock, true);
  return `<g transform="translate(40 35) scale(4)">
<rect x="6" y="15" width="10" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(9 9) scale(1 ${breatheScaleY(frame)}) translate(-9 -9)">
${px(6, 4, 9, 4, c)}
${px(7, 3, 7, 6, c)}
${px(7, 2, 4, 7, c)}
${px(15, 4, 1, 2, c)}
${px(5, 2, 3, 4, c)}
<g transform="translate(0 ${nod})">
${px(1, 1, 5, 3, c)}
${px(0, 2, 2, 3, nose)}
${px(3, 3, 1, 3, c)}
${px(0, -3, 1, 2, antler)}
${px(2, -3, 1, 2, antler)}
${px(4, -3, 1, 2, antler)}
${px(0, -2, 5, 1, antler)}
${px(1, -2, 4, 2, antler)}
${px(4, -1, 5, 2, antler)}
${px(8, -3, 1, 2, antler)}
${px(10, -3, 1, 2, antler)}
${px(12, -3, 1, 2, antler)}
${px(8, -2, 5, 1, antler)}
${px(7, -2, 5, 2, antler)}
<g transform="translate(3.5 2.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-3.5 -2.5)">
${px(3, 2, 1, 1, "#000")}
${px(3, 2, 0.5, 0.5, "#fff")}
</g>
</g>
</g>
</g>
</g>`;
}

export const moose: Mascot = { name: "moose", draw, dir: -1, foot: 95 };
