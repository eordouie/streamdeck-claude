import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const SKIN = "#f9a8d4";
const DARK = "#ec4899";
const NOSTRIL = "#831843";

/** A pale pink pig in right-facing profile: barrel body, a flat snout plate
 *  with two nostrils, small triangular ears (the far one darker), short legs
 *  and a curly tail that recoils with the stride. The snout plate is drawn
 *  face-on, as cartoon pigs are, because a true profile hides the nostrils.
 *  A single dark ear read as a horn; two triangles read as ears. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="11" width="2" height="${planted ? 4 : 3}" fill="${SKIN}"/>`;
  const legs = stepA ? leg(3, true) + leg(9, false) : leg(3, false) + leg(9, true);
  const px = (x: number, y: number) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${DARK}"/>`;
  const tail = stepA
    ? px(1, 7) + px(0, 6) + px(0, 5) + px(1, 4) + px(2, 5)
    : px(1, 8) + px(0, 7) + px(0, 6) + px(1, 5) + px(2, 6);
  return `<g transform="translate(40 35) scale(4)">
<rect x="2" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 12) scale(1 ${breatheScaleY(frame)}) translate(-8 -12)">
${tail}
<rect x="3" y="6" width="8" height="7" fill="${SKIN}"/>
<rect x="2" y="7" width="10" height="5" fill="${SKIN}"/>
<rect x="10" y="4" width="4" height="8" fill="${SKIN}"/>
<rect x="9" y="5" width="6" height="6" fill="${SKIN}"/>
<rect x="9" y="3" width="2" height="2" fill="${DARK}"/>
<rect x="10" y="2" width="1" height="1" fill="${DARK}"/>
<rect x="12" y="3" width="2" height="2" fill="${SKIN}"/>
<rect x="13" y="2" width="1" height="1" fill="${SKIN}"/>
<rect x="12" y="3" width="1" height="1" fill="${DARK}"/>
<rect x="13" y="7" width="3" height="3" fill="${DARK}"/>
<rect x="13" y="8" width="1" height="1" fill="${NOSTRIL}"/>
<rect x="15" y="8" width="1" height="1" fill="${NOSTRIL}"/>
<g transform="translate(11.5 5.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-11.5 -5.5)">
<rect x="11" y="5" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

export const pig: Mascot = { name: "pig", draw, dir: 1, foot: 95 };
