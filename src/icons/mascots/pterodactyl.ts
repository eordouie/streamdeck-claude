import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A pterodactyl hovering in left-facing profile. The read at 72 px rests on
 *  the Pteranodon "pickaxe" head (a long tan beak forward, a long crest back)
 *  and the one big wing; the rust body and tan membrane keep it clear of the
 *  other dinosaurs on the deck.
 *
 *  The wing beat is the secondary motion: raised on step A, swept down on
 *  step B as the mirror image, so the two poses read as one wing flapping.
 *  The body rides half a unit higher on the down-stroke, which is the same
 *  bob every walker has, timed so the flyer lifts as it beats. The legs hang
 *  inside the bob group rather than standing on the ground, and the shadow
 *  stays on the ground line below the hover.
 *
 *  Painted in layers on a one-unit grid: the body colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#c2410c";
  const wing = "#e0b07a";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // Dangling legs: one hangs a unit lower than the other, swapping each step.
  // Their tops tuck one unit up under the belly.
  const leg = (x: number, low: boolean) =>
    `<rect x="${x}" y="8" width="1" height="${low ? 4 : 3}" fill="${c}"/>`;
  const legs = stepA ? leg(7, true) + leg(9, false) : leg(7, false) + leg(9, true);
  // The wing: leading edge (the arm) in the body colour, membrane behind it.
  const wings = stepA
    ? `<rect x="15" y="-1" width="1" height="5" fill="${wing}"/>
<rect x="14" y="0" width="2" height="4" fill="${wing}"/>
<rect x="13" y="1" width="3" height="3" fill="${wing}"/>
<rect x="12" y="3" width="4" height="1" fill="${wing}"/>
<rect x="12" y="3" width="3" height="2" fill="${wing}"/>
<rect x="11" y="4" width="3" height="2" fill="${wing}"/>
<rect x="11" y="4" width="4" height="1" fill="${wing}"/>
<rect x="10" y="5" width="3" height="2" fill="${wing}"/>
<rect x="10" y="5" width="4" height="1" fill="${wing}"/>
<rect x="9" y="6" width="4" height="1" fill="${wing}"/>
<rect x="15" y="-1" width="1" height="1" fill="${c}"/>
<rect x="14" y="0" width="1" height="1" fill="${c}"/>
<rect x="13" y="1" width="1" height="2" fill="${c}"/>
<rect x="12" y="3" width="1" height="1" fill="${c}"/>
<rect x="11" y="4" width="1" height="1" fill="${c}"/>
<rect x="10" y="5" width="1" height="1" fill="${c}"/>
<rect x="9" y="6" width="1" height="1" fill="${c}"/>`
    : `<rect x="9" y="7" width="6" height="1" fill="${wing}"/>
<rect x="10" y="7" width="5" height="2" fill="${wing}"/>
<rect x="10" y="8" width="6" height="1" fill="${wing}"/>
<rect x="11" y="8" width="5" height="2" fill="${wing}"/>
<rect x="12" y="8" width="4" height="3" fill="${wing}"/>
<rect x="13" y="8" width="3" height="4" fill="${wing}"/>
<rect x="14" y="8" width="2" height="5" fill="${wing}"/>
<rect x="15" y="8" width="1" height="6" fill="${wing}"/>
<rect x="9" y="7" width="1" height="1" fill="${c}"/>
<rect x="10" y="8" width="1" height="1" fill="${c}"/>
<rect x="11" y="9" width="1" height="1" fill="${c}"/>
<rect x="12" y="10" width="1" height="1" fill="${c}"/>
<rect x="13" y="11" width="1" height="1" fill="${c}"/>
<rect x="14" y="12" width="1" height="1" fill="${c}"/>
<rect x="15" y="13" width="1" height="1" fill="${c}"/>`;
  return `<g transform="translate(40 35) scale(4)">
<rect x="5" y="15" width="7" height="1" fill="#000" opacity="0.45"/>
<g transform="translate(0 ${bob})">
${legs}
<g transform="translate(8 10) scale(1 ${breatheScaleY(frame)}) translate(-8 -10)">
<rect x="10" y="2" width="1" height="2" fill="${c}"/>
<rect x="10" y="2" width="2" height="1" fill="${c}"/>
<rect x="6" y="3" width="3" height="6" fill="${c}"/>
<rect x="6" y="3" width="5" height="1" fill="${c}"/>
<rect x="4" y="4" width="5" height="3" fill="${c}"/>
<rect x="0" y="5" width="9" height="1" fill="${c}"/>
<rect x="1" y="5" width="8" height="2" fill="${c}"/>
<rect x="1" y="6" width="12" height="1" fill="${c}"/>
<rect x="5" y="6" width="8" height="2" fill="${c}"/>
<rect x="6" y="6" width="7" height="3" fill="${c}"/>
<rect x="8" y="6" width="4" height="4" fill="${c}"/>
<rect x="5" y="7" width="10" height="1" fill="${c}"/>
<rect x="0" y="5" width="4" height="1" fill="${wing}"/>
<rect x="1" y="5" width="3" height="2" fill="${wing}"/>
<rect x="8" y="8" width="4" height="1" fill="${wing}"/>
<rect x="8" y="8" width="3" height="2" fill="${wing}"/>
${wings}
<g transform="translate(6.5 5.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-6.5 -5.5)">
<rect x="6" y="5" width="1" height="1" fill="#1c1c22"/>
<rect x="6" y="5" width="0.5" height="0.5" fill="#fff"/>
</g>
</g>
</g>
</g>`;
}

export const pterodactyl: Mascot = { name: "pterodactyl", draw, dir: -1, foot: 95 };
