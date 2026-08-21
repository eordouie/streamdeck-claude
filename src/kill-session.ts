import { platform } from "node:os";
import streamDeck from "@elgato/streamdeck";
import type { SessionOrigin } from "./sessions.js";
import type { ProviderId, TerminateResult } from "./provider-types.js";
import { WSL_DISTRO } from "./env.js";
import { spawnCapture } from "./spawn-capture.js";
import { processBelongsToProvider } from "./provider-process.js";
import { loadAgentConfig } from "./agent-config.js";

/** Délai avant d'escalader SIGTERM → SIGKILL si le process refuse de partir. */
const SIGKILL_ESCALATION_MS = 2000;

/**
 * Best-effort : termine le process d'une session Claude Code. SIGTERM d'abord,
 * puis SIGKILL après SIGKILL_ESCALATION_MS s'il est toujours vivant.
 *
 * Dispatch par plateforme (miroir de live-pids.ts). Sur macOS/Linux la session
 * vit dans notre propre namespace de process, donc `process.kill` direct suffit
 * (le tag `origin` y vaut "wsl" mais est sans effet). La branche win32 est
 * dormante sur Mac.
 */
export async function killSession(
  pid: number,
  origin: SessionOrigin,
  provider: ProviderId,
): Promise<TerminateResult> {
  if (platform() === "win32") {
    await killWindows(pid, origin);
    return { terminated: true, reason: "termination-requested" };
  }
  // Identity check before signaling: a <pid>.json can outlive its process
  // (CC died while the SD app was off), and after a reboot the pid may have
  // been recycled by an unrelated process. Killing must only ever hit a process
  // that IS this provider's binary — the names come from config, so a newly
  // configured agent is killable without touching this file.
  const [probe, config] = await Promise.all([
    spawnCapture("/bin/ps", ["-p", String(pid), "-o", "comm="], { timeoutMs: 2000 }),
    loadAgentConfig(),
  ]);
  const comm = probe.stdout.trim().split("/").pop() ?? "";
  if (probe.err || probe.code !== 0 || !processBelongsToProvider(comm, provider, config)) {
    streamDeck.logger.warn(
      `refusing to kill pid=${pid}: comm=${JSON.stringify(comm)} is not a ${provider} process (recycled pid?)`,
    );
    return { terminated: false, reason: `process-identity-mismatch:${provider}` };
  }
  return killNative(pid);
}

function killNative(pid: number): TerminateResult {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return { terminated: false, reason: "process-already-exited" };
    streamDeck.logger.warn(`SIGTERM ${pid} failed: ${code ?? String(err)}`);
    return { terminated: false, reason: `sigterm-failed:${code ?? "unknown"}` };
  }
  setTimeout(() => {
    try {
      process.kill(pid, 0); // sonde : throw ESRCH si mort
      process.kill(pid, "SIGKILL");
      streamDeck.logger.info(`escalated to SIGKILL for ${pid}`);
    } catch {
      // déjà mort entre-temps — rien à faire
    }
  }, SIGKILL_ESCALATION_MS);
  return { terminated: true, reason: "termination-requested" };
}

async function killWindows(pid: number, origin: SessionOrigin): Promise<void> {
  if (origin === "wsl") {
    await spawnCapture("wsl.exe", ["-d", WSL_DISTRO, "--", "kill", "-TERM", String(pid)]);
    setTimeout(() => {
      void spawnCapture("wsl.exe", ["-d", WSL_DISTRO, "--", "kill", "-KILL", String(pid)]);
    }, SIGKILL_ESCALATION_MS);
    return;
  }
  await spawnCapture("taskkill.exe", ["/PID", String(pid), "/T"]);
  setTimeout(() => {
    void spawnCapture("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
  }, SIGKILL_ESCALATION_MS);
}
