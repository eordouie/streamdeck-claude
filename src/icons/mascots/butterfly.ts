import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A butterfly seen from above, wings spread. The four-lobed outline
 *  (forewings pointing up and out, a notch, smaller hindwings pointing down
 *  and out) reads as a butterfly at 72 px before anything else does, and no
 *  other animal on the deck is turquoise. Turquoise wings with lighter inner
 *  cells, a dark teal rim (not black, so the edge stays on the tile), two
 *  cream dots near each wing tip, and a slim slate body with two antennae
 *  and one cream eye on the head.
 *
 *  It flutters instead of stepping: on the step cycle the wings narrow to
 *  about half their span and widen again, the body lifts half a unit on the
 *  narrow beat, and it hovers well above its shadow on the ground line. The
 *  antennae twitch (spread, then upright) as the secondary motion. From
 *  above it is symmetric, so `dir` only sets which way it drifts.
 *
 *  Painted in layers on a one-unit grid: the base colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const wing = "#14b8a6";
  const cell = "#5eead4";
  const rim = "#134e4a";
  const dot = "#f5f0dc";
  const body = "#475569";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // Wide on step A, narrowed to about half the span on step B: the flutter
  // that stands in for a leg cycle.
  const wings = stepA
    ? `<rect x="1" y="0" width="3" height="5" fill="${rim}"/>
<rect x="11" y="0" width="3" height="5" fill="${rim}"/>
<rect x="0" y="1" width="6" height="3" fill="${rim}"/>
<rect x="3" y="1" width="2" height="10" fill="${rim}"/>
<rect x="9" y="1" width="6" height="3" fill="${rim}"/>
<rect x="10" y="1" width="2" height="10" fill="${rim}"/>
<rect x="0" y="2" width="7" height="2" fill="${rim}"/>
<rect x="1" y="2" width="6" height="3" fill="${rim}"/>
<rect x="2" y="2" width="5" height="4" fill="${rim}"/>
<rect x="3" y="2" width="4" height="7" fill="${rim}"/>
<rect x="8" y="2" width="7" height="2" fill="${rim}"/>
<rect x="8" y="2" width="6" height="3" fill="${rim}"/>
<rect x="8" y="2" width="5" height="4" fill="${rim}"/>
<rect x="8" y="2" width="4" height="7" fill="${rim}"/>
<rect x="2" y="7" width="5" height="2" fill="${rim}"/>
<rect x="2" y="7" width="4" height="3" fill="${rim}"/>
<rect x="8" y="7" width="5" height="2" fill="${rim}"/>
<rect x="9" y="7" width="4" height="3" fill="${rim}"/>
<rect x="1" y="8" width="6" height="1" fill="${rim}"/>
<rect x="8" y="8" width="6" height="1" fill="${rim}"/>
<rect x="1" y="1" width="3" height="1" fill="${wing}"/>
<rect x="1" y="1" width="1" height="3" fill="${wing}"/>
<rect x="3" y="1" width="1" height="2" fill="${wing}"/>
<rect x="11" y="1" width="3" height="1" fill="${wing}"/>
<rect x="11" y="1" width="1" height="2" fill="${wing}"/>
<rect x="13" y="1" width="1" height="3" fill="${wing}"/>
<rect x="3" y="2" width="3" height="1" fill="${wing}"/>
<rect x="5" y="2" width="1" height="5" fill="${wing}"/>
<rect x="9" y="2" width="1" height="5" fill="${wing}"/>
<rect x="9" y="2" width="3" height="1" fill="${wing}"/>
<rect x="1" y="3" width="2" height="1" fill="${wing}"/>
<rect x="2" y="3" width="1" height="2" fill="${wing}"/>
<rect x="12" y="3" width="2" height="1" fill="${wing}"/>
<rect x="12" y="3" width="1" height="2" fill="${wing}"/>
<rect x="4" y="5" width="2" height="2" fill="${wing}"/>
<rect x="9" y="5" width="2" height="2" fill="${wing}"/>
<rect x="3" y="7" width="1" height="1" fill="${wing}"/>
<rect x="11" y="7" width="1" height="1" fill="${wing}"/>
<rect x="2" y="8" width="1" height="1" fill="${wing}"/>
<rect x="5" y="8" width="1" height="1" fill="${wing}"/>
<rect x="9" y="8" width="1" height="1" fill="${wing}"/>
<rect x="12" y="8" width="1" height="1" fill="${wing}"/>
<rect x="3" y="9" width="2" height="1" fill="${wing}"/>
<rect x="10" y="9" width="2" height="1" fill="${wing}"/>
<rect x="2" y="2" width="1" height="1" fill="${dot}"/>
<rect x="12" y="2" width="1" height="1" fill="${dot}"/>
<rect x="3" y="3" width="2" height="2" fill="${cell}"/>
<rect x="10" y="3" width="2" height="2" fill="${cell}"/>
<rect x="4" y="7" width="1" height="2" fill="${cell}"/>
<rect x="4" y="7" width="2" height="1" fill="${cell}"/>
<rect x="9" y="7" width="2" height="1" fill="${cell}"/>
<rect x="10" y="7" width="1" height="2" fill="${cell}"/>
<rect x="3" y="8" width="2" height="1" fill="${cell}"/>
<rect x="10" y="8" width="2" height="1" fill="${cell}"/>`
    : `<rect x="4" y="1" width="1" height="9" fill="${rim}"/>
<rect x="10" y="1" width="1" height="9" fill="${rim}"/>
<rect x="3" y="2" width="3" height="3" fill="${rim}"/>
<rect x="4" y="2" width="2" height="8" fill="${rim}"/>
<rect x="9" y="2" width="2" height="8" fill="${rim}"/>
<rect x="9" y="2" width="3" height="3" fill="${rim}"/>
<rect x="3" y="3" width="4" height="2" fill="${rim}"/>
<rect x="4" y="3" width="3" height="6" fill="${rim}"/>
<rect x="8" y="3" width="4" height="2" fill="${rim}"/>
<rect x="8" y="3" width="3" height="6" fill="${rim}"/>
<rect x="3" y="8" width="4" height="1" fill="${rim}"/>
<rect x="8" y="8" width="4" height="1" fill="${rim}"/>
<rect x="4" y="2" width="1" height="1" fill="${wing}"/>
<rect x="10" y="2" width="1" height="1" fill="${wing}"/>
<rect x="5" y="3" width="1" height="3" fill="${wing}"/>
<rect x="9" y="3" width="1" height="3" fill="${wing}"/>
<rect x="5" y="7" width="1" height="1" fill="${wing}"/>
<rect x="9" y="7" width="1" height="1" fill="${wing}"/>
<rect x="4" y="8" width="1" height="1" fill="${wing}"/>
<rect x="10" y="8" width="1" height="1" fill="${wing}"/>
<rect x="4" y="3" width="1" height="1" fill="${dot}"/>
<rect x="10" y="3" width="1" height="1" fill="${dot}"/>
<rect x="4" y="4" width="1" height="1" fill="${cell}"/>
<rect x="10" y="4" width="1" height="1" fill="${cell}"/>
<rect x="5" y="8" width="1" height="1" fill="${cell}"/>
<rect x="9" y="8" width="1" height="1" fill="${cell}"/>`;
  const antennae = stepA
    ? `<rect x="6" y="-1" width="1" height="1" fill="${body}"/><rect x="5" y="-2" width="1" height="1" fill="${body}"/><rect x="8" y="-1" width="1" height="1" fill="${body}"/><rect x="9" y="-2" width="1" height="1" fill="${body}"/>`
    : `<rect x="6" y="-1" width="1" height="1" fill="${body}"/><rect x="6" y="-2" width="1" height="1" fill="${body}"/><rect x="8" y="-1" width="1" height="1" fill="${body}"/><rect x="8" y="-2" width="1" height="1" fill="${body}"/>`;
  return `<g transform="translate(42 35) scale(4)">
<rect x="4" y="15" width="7" height="1" fill="#000" opacity="0.45"/>
<g transform="translate(0 ${bob})">
<g transform="translate(7 10) scale(1 ${breatheScaleY(frame)}) translate(-7 -10)">
${wings}
${antennae}
<rect x="7" y="0" width="1" height="10" fill="${body}"/>
<g transform="translate(7.5 0.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-7.5 -0.5)">
<rect x="7" y="0" width="1" height="1" fill="#f5f0dc"/>
<rect x="7.5" y="0" width="0.5" height="0.5" fill="#1c1c22"/>
</g>
</g>
</g>
</g>`;
}

export const butterfly: Mascot = { name: "butterfly", draw, dir: 1, foot: 95 };
