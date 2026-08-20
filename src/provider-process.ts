/**
 * Does a process's `comm` belong to the agent we think it does?
 *
 * The identity check that gates every kill: a <pid>.json can outlive its
 * process, and after a reboot the pid may have been recycled by something
 * unrelated, so the signal must only ever reach a real agent process.
 *
 * Its own module rather than a helper inside kill-session.ts, which imports the
 * Elgato SDK — that import dies under `tsx --test` AND the dead file is then
 * reported as one PASSING test, so a guard living there could not be honestly
 * covered. Node builtins only (none needed); same rule as naming-policy.ts.
 */
import type { ProviderId } from "./provider-types.js";

export function processBelongsToProvider(comm: string, provider: ProviderId): boolean {
  // Interactive sessions run as `claude`; a background job runs as
  // `claude.exe` — the binary Claude Code execs behind --bg-pty-host. Both ARE
  // Claude Code. Matching only `claude` made every bg kill fail this check and
  // log "refusing to kill" instead, which is half of why a background job could
  // not be cleared off the deck.
  if (provider === "claude") return comm === "claude" || comm === "claude.exe";
  if (provider === "codex") return comm.includes("codex");
  return false;
}
