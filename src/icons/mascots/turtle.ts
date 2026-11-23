import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A turtle in left-facing profile. The high dome is the outline: dark
 *  green, with lighter plates (a top plate, two side plates, a low centre
 *  plate) and a light marginal rim along its lower edge, so the shell reads
 *  as tortoiseshell rather than a plain green hump and stays clear of the
 *  T-Rex's solid green. The small head pokes out under the front of the
 *  shell, drawn before the shell so the rim overlaps the neck; stubby legs,
 *  a skin strip between them, and a short tail point at the back.
 *
 *  The head nods half a unit on step A as the secondary motion, against the
 *  body's bob, so the neck visibly works while the shell rides level.
 *
 *  Painted in layers on a one-unit grid: the base colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const shell = "#15803d";
  const plate = "#4ade80";
  const skin = "#a3b86c";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const nod = stepA ? "0.5" : "0";
  // Leg tops tuck one unit up under the shell rim.
  const leg = (x: number, planted: boolean) =>
    `<rect x="${x}" y="11" width="3" height="${planted ? 4 : 3}" fill="${skin}"/>`;
  const legs = stepA ? leg(3, true) + leg(10, false) : leg(3, false) + leg(10, true);
  return `<g transform="translate(42 35) scale(4)">
<rect x="1" y="15" width="13" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 12) scale(1 ${breatheScaleY(frame)}) translate(-8 -12)">
<rect x="13" y="12" width="1.5" height="1" fill="${skin}"/>
<rect x="3" y="12" width="10" height="1" fill="${skin}"/>
<g transform="translate(0 ${nod})">
<rect x="1" y="8" width="2" height="4" fill="${skin}"/>
<rect x="0" y="9" width="3" height="2" fill="${skin}"/>
<rect x="0" y="10" width="4" height="1" fill="${skin}"/>
<rect x="1" y="10" width="3" height="2" fill="${skin}"/>
<g transform="translate(1.5 9.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-1.5 -9.5)">
<rect x="1" y="9" width="1" height="1" fill="#1c1c22"/>
<rect x="1" y="9" width="0.5" height="0.5" fill="#fff"/>
</g>
</g>
<rect x="6" y="5" width="5" height="7" fill="${shell}"/>
<rect x="5" y="6" width="7" height="6" fill="${shell}"/>
<rect x="4" y="7" width="9" height="5" fill="${shell}"/>
<rect x="3" y="8" width="11" height="4" fill="${shell}"/>
<rect x="2" y="11" width="13" height="1" fill="${shell}"/>
<rect x="7" y="6" width="3" height="2" fill="${plate}"/>
<rect x="5" y="7" width="1" height="3" fill="${plate}"/>
<rect x="11" y="7" width="1" height="3" fill="${plate}"/>
<rect x="4" y="8" width="2" height="2" fill="${plate}"/>
<rect x="11" y="8" width="2" height="2" fill="${plate}"/>
<rect x="7" y="9" width="3" height="3" fill="${plate}"/>
<rect x="2" y="11" width="13" height="1" fill="${plate}"/>
</g>
</g>
</g>`;
}

export const turtle: Mascot = { name: "turtle", draw, dir: -1, foot: 95 };
