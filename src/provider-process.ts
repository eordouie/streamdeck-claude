/**
 * Does a process's `comm` belong to the agent we think it does?
 *
 * The identity check that gates every kill: a <pid>.json can outlive its
 * process, and after a reboot the pid may have been recycled by something
 * unrelated, so the signal must only ever reach a real agent process.
 *
 * The binary names come from config (agent-config.ts), so this asks "is this one
 * of the binaries declared for that provider" rather than knowing any provider's
 * name. `claude` vs `claude.exe` is the reason a provider has a LIST of binaries
 * and not one: interactive Claude Code runs as `claude`, a background job runs as
 * `claude.exe` behind --bg-pty-host, and both ARE Claude Code. Matching only
 * `claude` made every bg kill fail this check and log "refusing to kill", which
 * reads exactly like the guard doing its job.
 *
 * Its own module rather than a helper inside kill-session.ts, which imports the
 * Elgato SDK — that import dies under `tsx --test` AND the dead file is then
 * reported as one PASSING test, so a guard living there could not be honestly
 * covered. Node builtins only; same rule as naming-policy.ts.
 */
import { binaryBelongsTo, type AgentConfig } from "./agent-config.js";
import type { ProviderId } from "./provider-types.js";

export function processBelongsToProvider(comm: string, provider: ProviderId, config: AgentConfig): boolean {
  return binaryBelongsTo(comm, provider, config);
}
