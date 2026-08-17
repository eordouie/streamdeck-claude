import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry } from "./provider-registry.js";
import type { AgentProvider } from "./provider-types.js";

const provider = (id: string): AgentProvider => ({
  id,
  launch: { script: "launch-agent.sh", args: [id] },
  async readSessions() { return []; },
  async filterLive() { return new Set(); },
  async focus() { return { matched: false, reason: "test" }; },
  async terminate() { return { terminated: false, reason: "test" }; },
});

test("registry preserves provider registration order", () => {
  const registry = new ProviderRegistry([provider("claude"), provider("codex")]);
  assert.deepEqual(registry.ids(), ["claude", "codex"]);
  assert.equal(registry.get("claude").id, "claude");
  assert.equal(registry.get("codex").id, "codex");
});

test("registry rejects duplicate provider IDs", () => {
  assert.throws(
    () => new ProviderRegistry([provider("claude"), provider("claude")]),
    /duplicate provider id.*claude/i,
  );
});

test("registry reports unknown provider IDs", () => {
  const registry = new ProviderRegistry([provider("claude")]);
  assert.throws(() => registry.get("gemini"), /unknown provider id.*gemini/i);
});
