import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const px = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A giraffe in right-facing profile. Height, yellow and the brown patches are
 *  what keep it apart from the cream llama, and the neck leans forward where
 *  the llama's stands straight. Four thin legs, the far pair a shade darker,
 *  walk in a pace (both legs of a side together), as giraffes do. The tail
 *  hangs clear of the rump, or it reads as a wider rump instead of a tail.
 *
 *  Same-coloured rects overlap rather than abut: on the deck every unit edge
 *  lands on a half physical pixel, and two abutting rects leave a faint seam
 *  of background between them. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#facc15";
  const far = "#d4a20c";
  const patch = "#92400e";
  const muzzle = "#fde68a";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // The head holds level while the body bobs, so the horn knobs never rise
  // past y=-3 into the project name.
  const level = stepA ? "0" : "0.5";
  const leg = (x: number, fill: string, planted: boolean) => px(x, 8, 1, planted ? 7 : 6, fill);
  const legs = leg(5, far, !stepA) + leg(10, far, !stepA) + leg(3, c, stepA) + leg(8, c, stepA);
  const tail = stepA
    ? px(1, 5, 3, 1, c) + px(1, 5, 1, 4, c) + px(1, 9, 1, 2, patch)
    : px(1, 5, 3, 1, c) + px(1, 5, 1, 3, c) + px(0, 7, 1, 2, c) + px(0, 9, 1, 2, patch);
  return `<g transform="translate(42 35) scale(4)">
<rect x="2" y="15" width="10" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(7 9) scale(1 ${breatheScaleY(frame)}) translate(-7 -9)">
${tail}
${px(3, 6, 8, 3, c)}
${px(4, 5, 7, 4, c)}
${px(7, 4, 4, 5, c)}
${px(4, 7, 2, 1, patch)}
${px(7, 6, 1, 1, patch)}
${px(9, 5, 1, 1, patch)}
${px(7, 8, 2, 1, patch)}
${px(8, 2, 2, 3, c)}
${px(9, 3, 1, 1, patch)}
<g transform="translate(0 ${level})">
${px(9, -1, 2, 4, c)}
${px(10, 0, 1, 1, patch)}
${px(10, -2, 3, 3, c)}
${px(9, -1, 4, 2, c)}
${px(13, -1, 2, 2, muzzle)}
${px(8, -1, 1, 1, c)}
${px(10, -3, 1, 1, patch)}
${px(12, -3, 1, 1, patch)}
<g transform="translate(11.5 -0.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-11.5 0.5)">
${px(11, -1, 1, 1, "#000")}
</g>
</g>
</g>
</g>
</g>`;
}

export const giraffe: Mascot = { name: "giraffe", draw, dir: 1, foot: 95 };
