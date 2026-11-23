import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const SKIN = "#84cc16";
const BELLY = "#ecfccb";
const THIGH = "#65a30d";
const MOUTH = "#3f6212";
const SCLERA = "#f7fee7";

/** A lime frog seen from the front, the way the frog emoji draws it: two big
 *  eyes bulging above a squat, wide head, a long smile, a pale belly between
 *  the front legs, and the folded hind legs sticking out as knees at the
 *  sides. A side-view frog was tried first and read as a green brick;
 *  front-on, the eyes and the mouth carry it, and nothing in it recalls the
 *  upright T-Rex. It hops rather than walks: crouched on the beat, body up 1.5
 *  with the hind legs straightened on the offbeat, pupils looking the way it
 *  travels. The throat swells as it lands. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const lift = stepA ? "0" : "-1.5";
  const legs = stepA
    ? `<rect x="-1" y="14" width="3" height="1" fill="${THIGH}"/>
<rect x="13" y="14" width="3" height="1" fill="${THIGH}"/>`
    : `<rect x="0" y="11" width="2" height="4" fill="${THIGH}"/>
<rect x="13" y="11" width="2" height="4" fill="${THIGH}"/>
<rect x="-1" y="14" width="3" height="1" fill="${THIGH}"/>
<rect x="13" y="14" width="3" height="1" fill="${THIGH}"/>`;
  return `<g transform="translate(42 35) scale(4)">
<rect x="0" y="15" width="15" height="1" fill="#000" opacity="0.45"/>
${legs}
<g transform="translate(0 ${lift})">
<g transform="translate(7 13) scale(1 ${breatheScaleY(frame)}) translate(-7 -13)">
<rect x="1" y="6" width="13" height="8" fill="${SKIN}"/>
<rect x="0" y="7" width="15" height="6" fill="${SKIN}"/>
<rect x="2" y="3" width="2" height="4" fill="${SKIN}"/>
<rect x="1" y="4" width="4" height="3" fill="${SKIN}"/>
<rect x="11" y="3" width="2" height="4" fill="${SKIN}"/>
<rect x="10" y="4" width="4" height="3" fill="${SKIN}"/>
<rect x="-1" y="11" width="3" height="2" fill="${THIGH}"/>
<rect x="0" y="10" width="2" height="4" fill="${THIGH}"/>
<rect x="13" y="11" width="3" height="2" fill="${THIGH}"/>
<rect x="13" y="10" width="2" height="4" fill="${THIGH}"/>
<rect x="5" y="11" width="5" height="3" fill="${BELLY}"/>
<rect x="${stepA ? 5 : 6}" y="10" width="${stepA ? 5 : 3}" height="1" fill="${BELLY}"/>
<rect x="1" y="8" width="1" height="1" fill="${MOUTH}"/>
<rect x="13" y="8" width="1" height="1" fill="${MOUTH}"/>
<rect x="2" y="9" width="11" height="1" fill="${MOUTH}"/>
<g transform="translate(7 5) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-7 -5)">
<rect x="2" y="4" width="2" height="2" fill="${SCLERA}"/>
<rect x="2" y="5" width="1" height="1" fill="#000"/>
<rect x="11" y="4" width="2" height="2" fill="${SCLERA}"/>
<rect x="11" y="5" width="1" height="1" fill="#000"/>
</g>
</g>
<rect x="3" y="11" width="2" height="${stepA ? 4 : 2}" fill="${SKIN}"/>
<rect x="10" y="11" width="2" height="${stepA ? 4 : 2}" fill="${SKIN}"/>
</g>
</g>`;
}

export const frog: Mascot = { name: "frog", draw, dir: -1, foot: 95 };
