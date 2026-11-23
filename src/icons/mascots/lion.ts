import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A lion in left-facing profile with its face turned to the viewer. The
 *  big round mane is the largest shape on the sprite: a smooth disc of dark
 *  orange with a darker lower edge, and the golden face inside it (two eyes,
 *  a dark nose, a pale muzzle) is what reads at 72 px. Small golden ears sit
 *  on the mane's top. Smooth mane, gold body, four long legs and a tufted
 *  tail keep it clear of the hedgehog's brown spikes and cream face.
 *
 *  The legs step in diagonal pairs, the far pair a darker gold, tops tucked
 *  one unit up under the mane and belly. The tail curls up over the rump and
 *  its tuft flicks back and forth on the step as the secondary motion.
 *
 *  Painted in layers on a one-unit grid: the base colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#eab308";
  const far = "#c99406";
  const belly = "#fde68a";
  const mane = "#b45309";
  const maneShade = "#92400e";
  const nose = "#3b2a1a";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // Diagonal pairs step together: near front with far hind.
  const leg = (x: number, fill: string, planted: boolean) =>
    `<rect x="${x}" y="9" width="2" height="${planted ? 6 : 5}" fill="${fill}"/>`;
  const legs =
    leg(5, far, !stepA) + leg(12, far, stepA) + leg(3, c, stepA) + leg(10, c, !stepA);
  // The tail curls up over the rump; its tuft flicks back and forth.
  const tail = stepA
    ? `<rect x="14" y="5" width="1" height="2" fill="${c}"/><rect x="15" y="3" width="1" height="3" fill="${c}"/><rect x="14" y="2" width="1" height="1.5" fill="${c}"/><rect x="12.5" y="1" width="2" height="2" fill="${maneShade}"/>`
    : `<rect x="14" y="5" width="1" height="2" fill="${c}"/><rect x="15" y="3" width="1" height="3" fill="${c}"/><rect x="14.5" y="2" width="1" height="1.5" fill="${c}"/><rect x="13.5" y="0.5" width="2" height="2" fill="${maneShade}"/>`;
  return `<g transform="translate(40 35) scale(4)">
<rect x="2" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${bob})">
<g transform="translate(8 10) scale(1 ${breatheScaleY(frame)}) translate(-8 -10)">
${tail}
<rect x="2" y="0" width="2" height="10" fill="${c}"/>
<rect x="5" y="0" width="2" height="10" fill="${c}"/>
<rect x="2" y="1" width="5" height="9" fill="${c}"/>
<rect x="1" y="2" width="7" height="7" fill="${c}"/>
<rect x="0" y="3" width="9" height="5" fill="${c}"/>
<rect x="0" y="4" width="13" height="4" fill="${c}"/>
<rect x="0" y="5" width="14" height="3" fill="${c}"/>
<rect x="9" y="5" width="5" height="5" fill="${c}"/>
<rect x="0" y="6" width="15" height="2" fill="${c}"/>
<rect x="1" y="6" width="14" height="3" fill="${c}"/>
<rect x="2" y="1" width="5" height="2" fill="${mane}"/>
<rect x="1" y="2" width="7" height="1" fill="${mane}"/>
<rect x="1" y="2" width="2" height="2" fill="${mane}"/>
<rect x="6" y="2" width="2" height="2" fill="${mane}"/>
<rect x="7" y="2" width="1" height="6" fill="${mane}"/>
<rect x="0" y="3" width="2" height="5" fill="${mane}"/>
<rect x="0" y="3" width="3" height="1" fill="${mane}"/>
<rect x="6" y="3" width="3" height="1" fill="${mane}"/>
<rect x="7" y="3" width="2" height="2" fill="${mane}"/>
<rect x="0" y="7" width="3" height="1" fill="${mane}"/>
<rect x="6" y="7" width="2" height="1" fill="${mane}"/>
<rect x="4" y="5" width="1" height="1" fill="${nose}"/>
<rect x="3" y="6" width="3" height="1" fill="${belly}"/>
<rect x="9" y="9" width="5" height="1" fill="${belly}"/>
<rect x="1" y="8" width="7" height="1" fill="${maneShade}"/>
<rect x="2" y="8" width="5" height="2" fill="${maneShade}"/>
<g transform="translate(4.5 4.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-4.5 -4.5)">
<rect x="3" y="4" width="1" height="1" fill="#1c1c22"/><rect x="3" y="4" width="0.5" height="0.5" fill="#fff"/><rect x="5" y="4" width="1" height="1" fill="#1c1c22"/><rect x="5" y="4" width="0.5" height="0.5" fill="#fff"/>
</g>
</g>
</g>
</g>`;
}

export const lion: Mascot = { name: "lion", draw, dir: -1, foot: 95 };
