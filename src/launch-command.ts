import { join } from "node:path";
import type { LaunchSpec } from "./provider-types.js";
import { LAUNCH_TTY_DIR } from "./launch-tty.js";

export interface LaunchCommand {
  script: string;
  env: NodeJS.ProcessEnv;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** The tab records its own tty under its launch id. Only the tab can: the tty is
 *  what lets the plugin recognise an agent the user starts there — by process,
 *  before that agent has written any record of its own. `ps -E` would have made
 *  this unnecessary by exposing the inherited launch id, but macOS returns no
 *  environment for another process. */
function recordTtyCommand(launchId: string): string {
  const dir = shellQuote(LAUNCH_TTY_DIR);
  const file = shellQuote(join(LAUNCH_TTY_DIR, launchId));
  return `mkdir -p ${dir} 2>/dev/null && tty > ${file} 2>/dev/null; `;
}

/** Build the child environment and the shell prefix the launcher types into the
 * new tab. The prefix is the only channel that exists: the tab's shell is
 * spawned by Ghostty, not by us, so it cannot inherit anything we set here — and
 * `STREAMDECK_LAUNCH_ID` has to reach it, because that is what the agent the
 * user types will carry into its hook, and what binds their session to the key
 * they pressed. No command is appended: the launcher opens the tab and stops. */
export function buildLaunchCommand(spec: LaunchSpec, launchId: string): LaunchCommand {
  const env: NodeJS.ProcessEnv = { ...spec.env };
  for (const name of spec.unsetEnv ?? []) env[name] = undefined;
  env.STREAMDECK_LAUNCH_ID = launchId;

  const unset = (spec.unsetEnv ?? []).join(" ");
  const unsetPrefix = unset ? `unset ${unset}; ` : "";
  const exports = Object.entries(spec.env ?? {})
    .map(([name, value]) => `export ${name}=${shellQuote(value)}; `)
    .join("");
  env.STREAMDECK_LAUNCH_PREFIX =
    `${unsetPrefix}${exports}export STREAMDECK_LAUNCH_ID=${shellQuote(launchId)}; ` + recordTtyCommand(launchId);

  return { script: spec.script, env };
}
