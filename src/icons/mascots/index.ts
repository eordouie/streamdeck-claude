import type { Mascot } from "../mascot-kit.js";
import { bee } from "./bee.js";
import { crocodile } from "./crocodile.js";
import { duckling } from "./duckling.js";
import { flamingo } from "./flamingo.js";
import { frog } from "./frog.js";
import { giraffe } from "./giraffe.js";
import { hedgehog } from "./hedgehog.js";
import { kangaroo } from "./kangaroo.js";
import { ladybug } from "./ladybug.js";
import { lion } from "./lion.js";
import { moose } from "./moose.js";
import { octopus } from "./octopus.js";
import { parrot } from "./parrot.js";
import { penguin } from "./penguin.js";
import { pig } from "./pig.js";
import { pterodactyl } from "./pterodactyl.js";
import { rabbit } from "./rabbit.js";
import { sheep } from "./sheep.js";
import { snail } from "./snail.js";
import { turtle } from "./turtle.js";

/** The animals added for the herdr deck, in roster order after the original
 *  eight in motifs.ts. The order is the owner's list of 2026-11-23 and decides
 *  which animal a new agent gets first; do not sort it. The lion stands where
 *  that list had a triceratops: two concepts and ten rendered rounds of it read
 *  as a maned or antlered animal at 72 px, never as a triceratops. `butterfly.ts`
 *  in this folder is a finished spare that is not in the roster. */
export const NEW_MASCOTS: Mascot[] = [
  lion, pterodactyl, giraffe, flamingo, penguin, snail, turtle, crocodile, frog, hedgehog,
  rabbit, pig, octopus, bee, ladybug, duckling, parrot, kangaroo, moose, sheep,
];
