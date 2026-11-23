import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DEFAULT_SOCKET } from "./herdr-client.js";
import type { Route } from "./jump.js";

function absent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

export function readRoute(dir: string): Route {
  let liveSocket = DEFAULT_SOCKET;
  let clientTty: string | undefined;
  let config: string | undefined;
  try { config = readFileSync(join(dir, "config.json"), "utf8"); }
  catch (err) { if (!absent(err)) throw err; }
  if (config !== undefined) {
    const c = JSON.parse(config);
    if (!c || typeof c.socketPath !== "string" || !isAbsolute(c.socketPath) ||
        (c.clientTty !== undefined && (typeof c.clientTty !== "string" || !/^\/dev\/ttys\d+$/.test(c.clientTty)))) {
      throw new Error("config.json requires an absolute socketPath and an optional /dev/ttysNNN clientTty");
    }
    liveSocket = c.socketPath;
    clientTty = c.clientTty;
  }
  try {
    // readlink succeeds even if the demo died or its temporary directory is gone.
    const demoDir = readlinkSync(join(dir, "demo-active"));
    if (!isAbsolute(demoDir)) throw new Error("invalid demo-active link");
    return { socketPath: join(demoDir, "demo.sock"), liveSocket, clientTty, demo: true };
  } catch (err) {
    if (!absent(err)) throw err;
  }
  return { socketPath: liveSocket, liveSocket, clientTty, demo: false };
}

export function statePath(dir: string, route: Route): string | undefined {
  if (route.demo) return undefined;
  if (route.socketPath === DEFAULT_SOCKET) return join(dir, "state.json");
  const key = createHash("sha256").update(route.socketPath).digest("hex");
  return join(dir, `state-${key}.json`);
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.demo === b.demo && a.socketPath === b.socketPath && a.liveSocket === b.liveSocket && a.clientTty === b.clientTty;
}
