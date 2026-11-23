import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const px = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A flamingo in left-facing profile: S-shaped neck, round body, two long
 *  legs, and the second leg pose is the one-legged stand with the other leg
 *  folded. The beak tip is charcoal rather than black: a black tip vanishes
 *  into the tile, and with it the downward bend that makes the beak a
 *  flamingo's. Same-coloured rects overlap rather than abut, so the half-pixel
 *  edges at 72 px leave no seams across the neck. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#ec4899";
  const light = "#f9a8d4";
  const beak = "#fce7f3";
  const tip = "#52525b";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // The head holds level while the body bobs, so it never rises past y=-3
  // into the project name; the S of the neck takes up the difference.
  const level = stepA ? "0" : "0.5";
  const straight = (x: number) => px(x, 8, 1, 7, c) + px(x - 1, 14, 2, 1, c);
  const legs = stepA
    ? straight(8) + straight(10)
    : straight(8) + px(10, 8, 1, 3, c) + px(11, 10, 2, 1, c);
  const wing = stepA ? px(8, 5, 4, 2, light) : px(8, 4, 4, 2, light) + px(9, 3, 3, 3, light);
  return `<g transform="translate(44 35) scale(4)">
<rect x="6" y="15" width="7" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 9) scale(1 ${breatheScaleY(frame)}) translate(-8 -9)">
${px(6, 4, 5, 5, c)}
${px(5, 5, 7, 3, c)}
${px(12, 5, 1, 2, c)}
${px(13, 5, 1, 1, c)}
${wing}
${px(5, 2, 1, 2, c)}
${px(4, 3, 1, 3, c)}
<g transform="translate(0 ${level})">
${px(5, -1, 2, 2, c)}
${px(6, 0, 1, 3, c)}
${px(4, -3, 3, 3, c)}
${px(3, -2, 4, 2, c)}
${px(1, -2, 2, 2, beak)}
${px(0, -1, 3, 1, beak)}
${px(0, 0, 1, 2, tip)}
${px(1, 0, 1, 1, tip)}
<g transform="translate(5.5 -1.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-5.5 1.5)">
${px(5, -2, 1, 1, "#000")}
</g>
</g>
</g>
</g>
</g>`;
}

export const flamingo: Mascot = { name: "flamingo", draw, dir: -1, foot: 95 };
