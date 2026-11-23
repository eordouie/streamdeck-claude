import { spawnCapture } from "../spawn-capture.js";
import { DEFAULT_SOCKET, focusAgent, HerdrError, readSnapshot } from "./herdr-client.js";
import type { Target } from "./press.js";

export type JumpResult = "jumped" | "gone" | "failed";
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
export interface Route {
  socketPath: string;
  liveSocket: string;
  clientTty?: string;
  demo: boolean;
}

/** ps columns: tty, stat, ucomm, command. '+' identifies the foreground group.
 *  Only a bare local viewer is automatic. A configured tty can also name a
 *  local named-session viewer. A CLI helper on a Ghostty tty is never a match. */
export function clientTtys(psOutput: string, clientTty?: string): string[] {
  const out = new Set<string>();
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(ttys\d+)\s+(\S+)\s+herdr\s+(?:\S*\/)?herdr(?:\s+(.*?))?\s*$/.exec(line);
    if (!m || !m[2].includes("+")) continue;
    const tty = `/dev/${m[1]}`;
    const args = m[3]?.trim() ?? "";
    if (clientTty && clientTty !== tty) continue;
    if (args === "" || (clientTty && /^(?:--session|session attach) \S+$/.test(args))) out.add(tty);
  }
  return [...out];
}

/** Ghostty 1.4's dictionary defines the application's terminals, their IDs
 *  and ttys, and focus(terminal). Collect matches before any focus operation.
 *  The script selects the terminal inside Ghostty and nothing more: bringing
 *  the application forward is `open -b` in jumpTo. */
export function raiseScript(ttys: readonly string[]): string {
  const wanted = `{${ttys.map(t => JSON.stringify(t)).join(", ")}}`;
  return `
if not (application id "com.mitchellh.ghostty" is running) then return "ERR:not-running"
tell application id "com.mitchellh.ghostty"
  set wanted to ${wanted}
  set matchCount to 0
  set targetID to ""
  repeat with t in terminals
    if wanted contains ((tty of t) as text) then
      set matchCount to matchCount + 1
      set targetID to (id of t) as text
    end if
  end repeat
  if matchCount is not 1 then return "ERR:missing-or-ambiguous"
  focus (terminal id targetID)
  return "OK"
end tell`;
}

export async function jumpTo(
  route: Route, target: Target, log: (line: string) => void,
  options: { run?: typeof spawnCapture; isSelected?: () => boolean } = {},
): Promise<JumpResult> {
  try {
    const snapshot = await readSnapshot(route.socketPath);
    const occupant = snapshot.agents.find(a => a.pane_id === target.paneId);
    if (!occupant || occupant.terminal_id !== target.terminalId ||
        (target.sessionId && occupant.agent_session?.value !== target.sessionId)) return "gone";
    if (options.isSelected && !options.isSelected()) {
      log("deck source changed during the press");
      return "failed";
    }
    await focusAgent(route.socketPath, target.paneId);
  } catch (err) {
    if (err instanceof HerdrError && err.code === "agent_not_found") return "gone";
    log(`jump to ${target.paneId} unconfirmed: ${String(err)}`);
    return "failed";
  }
  if (route.liveSocket !== DEFAULT_SOCKET && !route.clientTty) {
    log("herdr focused; set clientTty for the Ghostty viewer of this custom socket");
    return "failed";
  }
  const run = options.run ?? spawnCapture;
  const ps = await run("/bin/ps", ["-axo", "tty=,stat=,ucomm=,command="], { timeoutMs: 2000 });
  const ttys = ps.code === 0 && !ps.timedOut ? clientTtys(ps.stdout, route.clientTty) : [];
  if (ttys.length) {
    const result = await run("/usr/bin/osascript", ["-e", raiseScript(ttys)], { timeoutMs: 3000 });
    if (result.code === 0 && !result.timedOut && result.stdout.trim() === "OK") {
      // The right terminal is now selected inside Ghostty. The application
      // itself comes forward through LaunchServices: an AppleScript `activate`
      // sent from the Stream Deck app's child returned without error and left
      // Ghostty behind (hardware check, 2026-11-23). `open -b` is what the old
      // plugin used, and it runs only after the one terminal was identified.
      const front = await run("/usr/bin/open", ["-b", GHOSTTY_BUNDLE_ID], { timeoutMs: 3000 });
      if (front.code === 0 && !front.timedOut) return "jumped";
      log(`herdr focused and its terminal selected; bringing Ghostty forward failed: ${front.err || front.stderr.trim() || front.code}`);
      return "failed";
    }
    log(`herdr focused; Ghostty selection failed: ${result.err || result.stderr.trim() || result.stdout.trim() || result.code}`);
  } else {
    log("herdr focused; no matching foreground herdr viewer on a tty");
  }
  return "failed";
}
