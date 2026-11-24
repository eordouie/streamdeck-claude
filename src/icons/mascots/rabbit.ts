import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const FUR = "#f1f5f9";
const SHADE = "#cbd5e1";
const PINK = "#f9a8d4";
const PUFF = "#ffffff";

/** A white rabbit in left-facing profile. Two tall upright ears carry the
 *  outline (the near one pink inside, the far one shaded), and they are what
 *  tell it from the white goose at a glance. It hops: on the offbeat the body
 *  rises a unit, the hind legs kick out behind and the front paws reach
 *  forward. The near ear's tip flicks back on the beat. The ears top out at
 *  y = -2, so mid-hop they stop exactly on the -3 line under the name. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const lift = stepA ? "0" : "-1";
  const legs = stepA
    ? `<rect x="4" y="11" width="2" height="4" fill="${SHADE}"/>
<rect x="3" y="11" width="2" height="4" fill="${FUR}"/>
<rect x="7" y="13" width="5" height="2" fill="${FUR}"/>`
    : `<rect x="10" y="12" width="2" height="3" fill="${FUR}"/>
<rect x="11" y="14" width="3" height="1" fill="${FUR}"/>`;
  const paws = stepA
    ? ""
    : `<rect x="3" y="11" width="2" height="2" fill="${SHADE}"/>
<rect x="2" y="11" width="2" height="3" fill="${FUR}"/>`;
  const earTipX = stepA ? 3 : 2;
  return `<g transform="translate(42 35) scale(4)">
<rect x="2" y="15" width="12" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${lift})">
${paws}
<g transform="translate(7 13) scale(1 ${breatheScaleY(frame)}) translate(-7 -13)">
<rect x="12" y="7" width="2" height="4" fill="${PUFF}"/>
<rect x="11" y="8" width="4" height="2" fill="${PUFF}"/>
<rect x="12" y="10" width="2" height="1" fill="${SHADE}"/>
<rect x="6" y="6" width="5" height="8" fill="${FUR}"/>
<rect x="5" y="7" width="7" height="7" fill="${FUR}"/>
<rect x="4" y="8" width="9" height="5" fill="${FUR}"/>
<rect x="5" y="13" width="7" height="1" fill="${SHADE}"/>
<rect x="5" y="-1" width="2" height="5" fill="${SHADE}"/>
<rect x="${earTipX}" y="-2" width="2" height="2" fill="${FUR}"/>
<rect x="2" y="-1" width="2" height="5" fill="${FUR}"/>
<rect x="3" y="-1" width="1" height="4" fill="${PINK}"/>
<rect x="1" y="3" width="5" height="6" fill="${FUR}"/>
<rect x="0" y="4" width="7" height="4" fill="${FUR}"/>
<rect x="0" y="6" width="1" height="1" fill="${PINK}"/>
<g transform="translate(2.5 5.5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-2.5 -5.5)">
<rect x="2" y="5" width="1" height="1" fill="#000"/>
</g>
</g>
</g>
</g>`;
}

export const rabbit: Mascot = { name: "rabbit", draw, dir: -1, foot: 95 };
