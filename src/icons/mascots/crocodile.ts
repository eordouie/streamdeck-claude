import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A crocodile in right-facing profile, long and low on the wide box: 16
 *  units, so the translate is 72 - 2 * 16 = 40. Three things in the outline
 *  carry it: a sawtooth of scutes along the back and tail, an eye bump
 *  standing up off the flat skull, and a long snout whose jaw line is a row
 *  of white teeth, with a nostril knob at the tip. The scutes are a lighter
 *  green than the body so the jagged edge reads against the near-black tile,
 *  which the deep swamp green alone does only faintly. The eye sits inside
 *  the bump, green on every side, because a dark pixel on the bump's top
 *  edge melts into the tile and leaves the catch-light floating.
 *
 *  Short legs with a forward toe; the tail tip lifts a unit against the
 *  stride as the secondary motion.
 *
 *  Painted in layers on a one-unit grid: the body colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#4d7c0f";
  const ridge = "#6f9a1c";
  const belly = "#e5e08a";
  const tooth = "#f8fafc";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // Leg tops tuck one unit up under the belly; the toe points the way it walks.
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="12" width="2" height="${planted ? 3 : 2}" fill="${c}"/>` +
    `<rect x="${x + 2}" y="${planted ? 14 : 13}" width="1" height="1" fill="${c}"/>`;
  const legs = stepA ? leg(4, true) + leg(9, false) : leg(4, false) + leg(9, true);
  const tailY = stepA ? 10 : 9;
  return `<g transform="translate(40 35) scale(4)">
<rect x="1" y="15" width="13" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 13) scale(1 ${breatheScaleY(frame)}) translate(-8 -13)">
<rect x="0" y="${tailY}" width="1.5" height="1" fill="${c}"/>
<rect x="9" y="6" width="3" height="6" fill="${c}"/>
<rect x="3" y="7" width="1" height="5" fill="${c}"/>
<rect x="5" y="7" width="1" height="6" fill="${c}"/>
<rect x="7" y="7" width="1" height="6" fill="${c}"/>
<rect x="1" y="8" width="1" height="3" fill="${c}"/>
<rect x="3" y="8" width="9" height="4" fill="${c}"/>
<rect x="4" y="8" width="7" height="5" fill="${c}"/>
<rect x="15" y="8" width="1" height="4" fill="${c}"/>
<rect x="1" y="9" width="15" height="2" fill="${c}"/>
<rect x="2" y="9" width="14" height="3" fill="${c}"/>
<rect x="3" y="7" width="1" height="1" fill="${ridge}"/>
<rect x="5" y="7" width="1" height="1" fill="${ridge}"/>
<rect x="7" y="7" width="1" height="1" fill="${ridge}"/>
<rect x="1" y="8" width="1" height="1" fill="${ridge}"/>
<rect x="11" y="10" width="1" height="1" fill="${tooth}"/>
<rect x="13" y="10" width="1" height="1" fill="${tooth}"/>
<rect x="15" y="10" width="1" height="1" fill="${tooth}"/>
<rect x="4" y="11" width="7" height="2" fill="${belly}"/>
<g transform="translate(10.5 7.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-10.5 -7.5)">
<rect x="10" y="7" width="1" height="1" fill="#1c1c22"/>
<rect x="10.5" y="7" width="0.5" height="0.5" fill="#fff"/>
</g>
</g>
</g>
</g>`;
}

export const crocodile: Mascot = { name: "crocodile", draw, dir: 1, foot: 95 };
