import { blinkScaleY, breatheScaleY, isStepA, type Mascot } from "../mascot-kit.js";

const SKIN = "#a855f7";
const SUCKER = "#d8b4fe";
const EYE = "#1e1030";
const GLINT = "#ffffff";

type Px = [x: number, y: number, w: number, h: number, fill?: string];

/** The two tentacles on the left half, for one leg pose. The right half is
 *  their mirror image in the opposite pose, so the four alternate like legs.
 *  The outer tentacle flares out in two-row steps; the inner one hangs
 *  straight. Each ends in a tip curled outward with a pale sucker on top. */
function leftArms(planted: boolean): Px[] {
  const outer: Px[] = planted
    ? [
        [1, 8, 2, 3],
        [0, 10, 2, 3],
        [-1, 12, 2, 2],
        [-1, 14, 2, 1],
        [-1, 13, 1, 1, SUCKER],
      ]
    : [
        [1, 8, 2, 3],
        [0, 10, 2, 2],
        [-1, 12, 2, 1],
        [-1, 11, 1, 1, SUCKER],
      ];
  const inner: Px[] = planted
    ? [
        [4, 8, 2, 6],
        [3, 14, 2, 1],
        [3, 13, 1, 1, SUCKER],
      ]
    : [
        [4, 8, 2, 5],
        [3, 13, 2, 1],
        [3, 12, 1, 1, SUCKER],
      ];
  return [...outer, ...inner];
}

const rect = ([x, y, w, h, fill]: Px): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill ?? SKIN}"/>`;
const mirror = ([x, y, w, h, fill]: Px): Px => [14 - x - w, y, w, h, fill];

/** A purple octopus seen from the front, as the emoji draws it: a big round
 *  mantle with two shiny eyes over four thick tentacles. It walks on them: the
 *  two halves alternate like legs, a lifted tentacle curling its tip higher.
 *  Straight two-wide tentacles made a Space Invader (the blocky peach Clawd is
 *  close kin to one) and one-wide splayed ones made a spider; thick tentacles
 *  with the outer pair flaring out keep it round and soft. */
function draw(frame: number, blinkPhaseMs: number): string {
  const stepA = isStepA(frame);
  const bob = stepA ? "0" : "-0.5";
  const arms = [...leftArms(stepA), ...leftArms(!stepA).map(mirror)].map(rect).join("\n");
  // The mantle pulses with the stride: its crown stretches half a unit up on
  // the lifted beat and settles on the planted one. The crown overlaps the
  // head below it, so the stretch never opens a seam.
  const crown = stepA ? 0 : -0.5;
  return `<g transform="translate(44 35) scale(4)">
<rect x="0" y="15" width="14" height="1" fill="#000" opacity="0.45"/>
${arms}
<g transform="translate(0 ${bob})">
<g transform="translate(7 9) scale(1 ${breatheScaleY(frame)}) translate(-7 -9)">
<rect x="5" y="${-1 + crown}" width="4" height="3" fill="${SKIN}"/>
<rect x="3" y="${crown}" width="8" height="2" fill="${SKIN}"/>
<rect x="3" y="1" width="8" height="8" fill="${SKIN}"/>
<rect x="2" y="1" width="10" height="7" fill="${SKIN}"/>
<rect x="1" y="2" width="12" height="5" fill="${SKIN}"/>
<g transform="translate(7 6) scale(1 ${blinkScaleY(blinkPhaseMs)}) translate(-7 -6)">
<rect x="3" y="5" width="2" height="2" fill="${EYE}"/>
<rect x="4" y="5" width="1" height="1" fill="${GLINT}"/>
<rect x="9" y="5" width="2" height="2" fill="${EYE}"/>
<rect x="10" y="5" width="1" height="1" fill="${GLINT}"/>
</g>
</g>
</g>
</g>`;
}

export const octopus: Mascot = { name: "octopus", draw, dir: 1, foot: 95 };
