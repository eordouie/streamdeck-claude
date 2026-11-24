#!/usr/bin/env node
// pnpm deck:demo runs the stand-in. A separate pnpm deck:live selects the live route.
import { mkdirSync, mkdtempSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { startFakeHerdr } from "../src/herdr-deck/fake-herdr.ts";
import { readSnapshot } from "../src/herdr-deck/herdr-client.ts";
import { readRoute } from "../src/herdr-deck/route.ts";

export async function runDemo(dir, args, input = process.stdin) {
  const marker = join(dir, "demo-active");
  const reload = () => writeFileSync(join(dir, "reload"), `${Date.now()}\n`);
  mkdirSync(dir, { recursive: true });
  const route = readRoute(dir);
  if (args.length === 1 && args[0] === "--live") {
    if (route.demo) {
      readlinkSync(marker); // Only a selector symlink can be removed here.
      unlinkSync(marker);
    }
    reload();
    console.log(`live route requested: ${route.liveSocket}; verify the new plugin startup line`);
    return;
  }
  if (args.length) throw new Error("usage: herdr-deck-demo.mjs [--live]");
  if (route.demo) throw new Error("a demo is already selected; finish or recover it before starting another");
  let snapshot;
  try {
    snapshot = await readSnapshot(route.liveSocket);
  } catch (err) {
    console.log(`demo could not read the configured snapshot (${String(err)}); using stand-in agents`);
    snapshot = { workspaces: [], tabs: [], agents: [], focused_pane_id: null };
  }
  // Take at most thirty real labels. Freeze ranking until the owner asks for a change.
  snapshot.agents = snapshot.agents.slice(0, 30);
  const used = new Set(snapshot.workspaces.map(w => w.workspace_id));
  for (let i = 1; snapshot.agents.length < 30; i++) {
    const ws = `wDemo${i}`;
    if (used.has(ws)) continue;
    snapshot.workspaces.push({ workspace_id: ws, label: `demo-${i}`, number: 1000 + i });
    snapshot.tabs.push({ tab_id: `${ws}:t1`, workspace_id: ws, label: "1", number: 1 });
    snapshot.agents.push({ pane_id: `${ws}:p1`, terminal_id: `${ws}-term`, workspace_id: ws,
      tab_id: `${ws}:t1`, agent: i % 2 ? "claude" : "codex", agent_session: { value: `demo-${i}` } });
  }
  snapshot.agents.forEach((a, i) => Object.assign(a, { agent_status: "idle", state_change_seq: 30 - i, focused: false }));
  snapshot.focused_pane_id = null;
  const privateDir = mkdtempSync(join(tmpdir(), "hd-demo-"));
  const socket = join(privateDir, "demo.sock");
  const fake = await startFakeHerdr(socket, snapshot);
  try {
    symlinkSync(privateDir, marker); // Exclusive. A second demo cannot replace the first.
    reload();
  } catch (err) {
    await fake.close();
    rmdirSync(privateDir);
    throw err;
  }
  const subject = snapshot.agents[29];
  console.log(`fake ready: ${socket}; 30 agents. Wait for the plugin's demo startup line.`);
  console.log(`subject ${subject.pane_id} starts at rank 30. Type working, blocked, done or idle and press Return. Ctrl+C stops the fake.`);
  let seq = 30;
  let printed = 0;
  const commands = createInterface({ input });
  commands.on("line", line => {
    const status = line.trim();
    if (!["working", "blocked", "done", "idle"].includes(status)) return;
    subject.agent_status = status;
    subject.state_change_seq = ++seq;
    console.log(`${subject.pane_id} -> ${status}`);
  });
  const pressWatch = setInterval(() => {
    while (printed < fake.focusCalls.length) console.log(`key press -> agent.focus ${fake.focusCalls[printed++]}`);
  }, 200);
  await new Promise(resolve => {
    const finish = () => {
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      commands.removeListener("close", finish);
      commands.removeListener("SIGINT", finish);
      commands.close();
      resolve();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    commands.once("SIGINT", finish);
    commands.once("close", finish);
  });
  clearInterval(pressWatch);
  await fake.close();
  rmdirSync(privateDir);
  console.log("fake stopped; demo stays selected and will show herdr off");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDemo(join(homedir(), ".config", "herdr-deck"), process.argv.slice(2));
}
