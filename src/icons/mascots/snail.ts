import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

/** A snail gliding in right-facing profile. The amber shell and its dark
 *  spiral carry the outline: a round spiral shell on a long beige foot reads
 *  as a snail before anything else does. Two eye stalks rise off the head,
 *  each eye a white ball centred on its stalk (hence the half-unit x) with
 *  the pupil looking forward; the far stalk and eye are a shade darker, and
 *  the far stalk roots behind the shell's shoulder.
 *
 *  No legs, so the foot plays their part: it stays on the ground outside the
 *  bob group, and its two poses are a wave running along the sole (three
 *  darker cells stepping forward two units) and the tail end stretching back
 *  half a unit. The secondary motion is the stalks, whose upper segments and
 *  eyes lean forward a unit on the offbeat. Shell and head bob and breathe
 *  above the foot, which reaches up under both so the bob never opens a seam.
 *
 *  Painted in layers on a one-unit grid: the base colour first under the
 *  whole silhouette in overlapping rects, then each detail colour on top.
 *  Two rects of one colour overlap rather than abut, so the breathing scale
 *  and the walk's fractional shift never open a seam onto the tile. */
function draw(frame: number, blinkPhaseMs: number): string {
  const c = "#e7d3a8";
  const far = "#c9b48a";
  const shell = "#f59e0b";
  const spiral = "#b45309";
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  // The foot stays on the ground the way legs do: a wave runs along the sole
  // and the tail end stretches. Its top row hides under the shell.
  const wave = (stepA ? [2, 6, 10] : [4, 8, 12])
    .map((x) => `<rect x="${x}" y="14" width="1" height="1" fill="${far}"/>`)
    .join("");
  const foot =
    `<rect x="2" y="12" width="11" height="1" fill="${c}"/>` +
    `<rect x="1" y="13" width="14" height="2" fill="${c}"/>` +
    `<rect x="${stepA ? 0 : 0.5}" y="14" width="2" height="1" fill="${c}"/>` +
    wave;
  // Eye stalks: the upper segment and the eye lean forward a unit on the
  // offbeat; the lower segment stays rooted in the head.
  const lean = stepA ? 0 : 1;
  const stalks =
    `<rect x="9" y="5" width="1" height="3" fill="${far}"/>` +
    `<rect x="${9 + lean}" y="3" width="1" height="3" fill="${far}"/>` +
    `<rect x="12" y="5" width="1" height="3" fill="${c}"/>` +
    `<rect x="${12 + lean}" y="2" width="1" height="4" fill="${c}"/>`;
  // Each eye sits centred on its stalk, a ball on a stick, looking forward.
  const eye = (x: number, y: number, white: string) =>
    `<g transform="translate(${x + 1} ${y + 1}) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(${-x - 1} ${-y - 1})">` +
    `<rect x="${x}" y="${y}" width="2" height="2" fill="${white}"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="#1c1c22"/></g>`;
  const eyes = eye(8.5 + lean, 2, "#d4d4d8") + eye(11.5 + lean, 1, "#f8fafc");
  return `<g transform="translate(42 35) scale(4)">
<rect x="1" y="15" width="13" height="1" fill="#000" opacity="0.45"/>
${foot}
<g transform="translate(0 ${bob})">
<g transform="translate(7 13) scale(1 ${breatheScaleY(frame)}) translate(-7 -13)">
<rect x="10" y="7" width="2" height="7" fill="${c}"/>
<rect x="9" y="8" width="4" height="6" fill="${c}"/>
<rect x="9" y="9" width="5" height="5" fill="${c}"/>
<rect x="8" y="13" width="7" height="1" fill="${c}"/>
${stalks}
<rect x="3" y="4" width="5" height="9" fill="${shell}"/>
<rect x="2" y="5" width="7" height="7" fill="${shell}"/>
<rect x="1" y="6" width="9" height="5" fill="${shell}"/>
<rect x="3" y="5" width="5" height="1" fill="${spiral}"/>
<rect x="2" y="6" width="1" height="5" fill="${spiral}"/>
<rect x="8" y="6" width="1" height="2" fill="${spiral}"/>
<rect x="4" y="7" width="1" height="3" fill="${spiral}"/>
<rect x="4" y="7" width="3" height="1" fill="${spiral}"/>
<rect x="7" y="8" width="1" height="1" fill="${spiral}"/>
<rect x="5" y="10" width="3" height="1" fill="${spiral}"/>
<rect x="3" y="11" width="1" height="1" fill="${spiral}"/>
${eyes}
</g>
</g>
</g>`;
}

export const snail: Mascot = { name: "snail", draw, dir: 1, foot: 95 };
