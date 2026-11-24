import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/** herdr's default session socket. A named session (`herdr --session x`) has
 *  its own; `~/.config/herdr-deck/config.json` can point the deck at it. */
export const DEFAULT_SOCKET = join(homedir(), ".config", "herdr", "herdr.sock");

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export interface RawAgent {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  agent?: string | null;
  agent_status: string;
  focused: boolean;
  state_change_seq?: number;
  agent_session?: { value?: string } | null;
}
export interface RawWorkspace {
  workspace_id: string;
  label: string;
  number: number;
}
export interface RawTab {
  tab_id: string;
  workspace_id: string;
  label: string | number;
  number: number;
}
export interface RawSnapshot {
  focused_pane_id: string | null;
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  agents: RawAgent[];
}

/** One request, one reply, one connection. herdr answers a full snapshot in
 *  under a millisecond, so a connection per call costs nothing and leaves no
 *  socket state to heal after herdr restarts. Rejects with a HerdrError whose
 *  code is herdr's own (`agent_not_found`), the socket's (`ENOENT`,
 *  `ECONNREFUSED`), or `timeout` / `closed` / `bad_reply`. */
export function herdrCall<T>(socketPath: string, method: string, params: object = {}, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    let buf = "";
    let settled = false;
    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      act();
    };
    const timer = setTimeout(
      () => finish(() => reject(new HerdrError("timeout", `${method} got no reply in ${timeoutMs} ms`))),
      timeoutMs,
    );
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(`${JSON.stringify({ id: "deck", method, params })}\n`));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const end = buf.indexOf("\n");
      if (end < 0) return;
      const line = buf.slice(0, end);
      finish(() => {
        let msg: { id?: string; result?: T; error?: { code?: string; message?: string } } | null;
        try {
          msg = JSON.parse(line);
        } catch {
          reject(new HerdrError("bad_reply", `${method} reply is not JSON`));
          return;
        }
        if (!msg || msg.id !== "deck") {
          reject(new HerdrError("bad_reply", `${method} reply has the wrong id or envelope`));
          return;
        }
        if (msg.error) reject(new HerdrError(msg.error.code ?? "error", msg.error.message ?? method));
        else if (msg.result === undefined) reject(new HerdrError("bad_reply", `${method} reply has no result`));
        else resolve(msg.result);
      });
    });
    sock.on("error", (err: NodeJS.ErrnoException) => finish(() => reject(new HerdrError(err.code ?? "socket", err.message))));
    sock.on("close", () => finish(() => reject(new HerdrError("closed", `${method}: herdr closed the connection before replying`))));
  });
}

export async function readSnapshot(socketPath: string): Promise<RawSnapshot> {
  const result = await herdrCall<{ type?: string; snapshot?: RawSnapshot } | null>(socketPath, "session.snapshot");
  const snap = result?.snapshot;
  if (result?.type !== "session_snapshot" || !snap ||
      !Array.isArray(snap.workspaces) || !snap.workspaces.every(w => w && typeof w.workspace_id === "string" &&
        typeof w.label === "string" && Number.isInteger(w.number)) ||
      !Array.isArray(snap.tabs) || !snap.tabs.every(t => t && typeof t.tab_id === "string" &&
        (typeof t.label === "string" || typeof t.label === "number")) ||
      !Array.isArray(snap.agents) || !snap.agents.every(a => a && typeof a.pane_id === "string" &&
        typeof a.terminal_id === "string" && typeof a.workspace_id === "string" && typeof a.tab_id === "string" &&
        typeof a.agent_status === "string" && (a.agent == null || typeof a.agent === "string") &&
        (a.agent_session == null || typeof a.agent_session.value === "string") &&
        (a.state_change_seq == null || Number.isSafeInteger(a.state_change_seq)))) {
    throw new HerdrError("bad_reply", "invalid session.snapshot reply");
  }
  return snap;
}

/** Moves the owner's live herdr view to this agent. Called from a key press
 *  and from nowhere else. */
export async function focusAgent(socketPath: string, paneId: string): Promise<void> {
  const reply = await herdrCall<{ type?: string; agent?: RawAgent } | null>(socketPath, "agent.focus", { target: paneId });
  if (reply?.type !== "agent_info" || reply.agent?.pane_id !== paneId) {
    throw new HerdrError("bad_reply", "agent.focus did not confirm the requested pane");
  }
}
