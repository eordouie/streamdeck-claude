import assert from "node:assert/strict";
import { test } from "node:test";
import { rawAgent } from "./fixtures.js";
import type { RawSnapshot } from "./herdr-client.js";
import { toDeckAgents } from "./model.js";

const snapshot: RawSnapshot = {
  focused_pane_id: null,
  workspaces: [
    { workspace_id: "w2", label: "hive-2.0", number: 2 },
    { workspace_id: "wT", label: "personal", number: 1 },
  ],
  tabs: [
    { tab_id: "w2:t1", workspace_id: "w2", label: "simulation", number: 1 },
    { tab_id: "wT:t3", workspace_id: "wT", label: 3, number: 3 },
  ],
  agents: [
    rawAgent({ pane_id: "w2:p2", tab_id: "w2:t1", agent: "codex", agent_status: "done", state_change_seq: 94, agent_session: { value: "abc" } }),
    rawAgent({ pane_id: "wT:p3", tab_id: "wT:t3", agent: null, agent_status: "sleeping", state_change_seq: undefined, agent_session: null }),
    rawAgent({ pane_id: "wX:p1" }),
  ],
};

test("an agent carries its workspace's name and number and its tab's name", () => {
  const [a] = toDeckAgents(snapshot);
  assert.deepEqual(a, { paneId: "w2:p2", terminalId: "term-w2:p2", kind: "codex", status: "done", seq: 94, workspace: "hive-2.0", workspaceNumber: 2, tab: "simulation", sessionId: "abc" });
});

test("a status herdr does not define, a missing counter and a missing session are tolerated", () => {
  const b = toDeckAgents(snapshot)[1];
  assert.equal(b.status, "unknown");
  assert.equal(b.kind, "agent");
  assert.equal(b.seq, 0);
  assert.equal(b.sessionId, "");
  assert.equal(b.tab, "3");
});

test("an agent whose workspace is not in the snapshot is named by its workspace id", () => {
  const c = toDeckAgents(snapshot)[2];
  assert.equal(c.workspace, "wX");
  assert.equal(c.workspaceNumber, Number.MAX_SAFE_INTEGER);
  assert.equal(c.tab, "");
});
