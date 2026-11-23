import { createServer, type Socket } from "node:net";
import type { RawSnapshot } from "./herdr-client.js";

export interface FakeHerdr {
  socketPath: string;
  /** Mutable: a test or the demo changes it and the next read sees the change. */
  snapshot: RawSnapshot;
  /** Every pane id an `agent.focus` asked for, in order. */
  focusCalls: string[];
  close(): Promise<void>;
}

/** A unix socket that speaks the three herdr methods the deck uses. For tests
 *  and for the hardware demo, so neither ever touches the owner's herdr. */
export function startFakeHerdr(socketPath: string, snapshot: RawSnapshot): Promise<FakeHerdr> {
  // Let listen() reject an occupied path. Node removes its own socket on close.
  // server.close() waits for every open connection; close() destroys them so
  // a client that never hangs up cannot keep a test or the demo from ending.
  const open = new Set<Socket>();
  const server = createServer((conn) => {
    let buf = "";
    open.add(conn);
    conn.setEncoding("utf8");
    conn.on("error", () => {});
    conn.on("close", () => open.delete(conn));
    conn.on("data", (chunk: string) => {
      buf += chunk;
      for (let end = buf.indexOf("\n"); end >= 0; end = buf.indexOf("\n")) {
        const line = buf.slice(0, end);
        buf = buf.slice(end + 1);
        conn.write(`${JSON.stringify(reply(fake, line))}\n`);
      }
    });
  });
  const fake: FakeHerdr = {
    socketPath,
    snapshot,
    focusCalls: [],
    close: () =>
      new Promise((resolve) => {
        for (const conn of open) conn.destroy();
        server.close(() => resolve());
      }),
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(fake));
  });
}

function reply(fake: FakeHerdr, line: string): object {
  let req: { id?: string; method?: string; params?: { target?: string } };
  try {
    req = JSON.parse(line);
  } catch {
    return { id: "", error: { code: "bad_request", message: "not JSON" } };
  }
  const id = req.id ?? "";
  if (req.method === "ping") return { id, result: { type: "pong", version: "fake", protocol: 22 } };
  if (req.method === "session.snapshot") return { id, result: { type: "session_snapshot", snapshot: fake.snapshot } };
  if (req.method === "agent.focus") {
    const target = req.params?.target ?? "";
    const agent = fake.snapshot.agents.find((a) => a.pane_id === target);
    if (!agent) return { id, error: { code: "agent_not_found", message: `agent target ${target} not found` } };
    fake.focusCalls.push(target);
    for (const a of fake.snapshot.agents) a.focused = a.pane_id === target;
    fake.snapshot.focused_pane_id = target;
    if (agent.agent_status === "done") agent.agent_status = "idle";
    return { id, result: { type: "agent_info", agent } };
  }
  return { id, error: { code: "unknown_method", message: String(req.method) } };
}
