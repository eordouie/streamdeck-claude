import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binaryIndex,
  DEFAULT_AGENT_CONFIG,
  parseAgentConfig,
  providerTag,
} from "./agent-config.js";

test("the built-in default is exactly the deck's pre-config behaviour", () => {
  // A machine with no config file must not be a machine with no agents.
  assert.deepEqual(DEFAULT_AGENT_CONFIG.agents, {
    claude: ["claude", "claude.exe"],
    codex: ["codex"],
  });
  assert.equal(DEFAULT_AGENT_CONFIG.untaggedAgent, "claude");
});

test("a third agent is one config line", () => {
  const { config, error } = parseAgentConfig(
    JSON.stringify({ agents: { claude: ["claude"], gemini: ["gemini"] } }),
  );
  assert.equal(error, undefined);
  assert.deepEqual(binaryIndex(config).get("gemini"), "gemini");
  assert.deepEqual(binaryIndex(config).get("claude"), "claude");
});

test("an agent declared with no binaries is named after itself", () => {
  // `{"gemini": []}` is a hand-written config meaning "the gemini command".
  const { config } = parseAgentConfig(JSON.stringify({ agents: { gemini: [] } }));
  assert.deepEqual(config.agents.gemini, ["gemini"]);
});

test("a broken config falls back whole rather than emptying the deck", () => {
  for (const bad of ["", "not json", "[]", "null", '{"agents":{}}', '{"agents":42}']) {
    const { config, error } = parseAgentConfig(bad);
    assert.deepEqual(config, DEFAULT_AGENT_CONFIG, `input: ${bad}`);
    assert.ok(error, `expected an error for: ${bad}`);
  }
});

test("untaggedAgent is a preference, and it can be nobody", () => {
  const claudeBare = { agents: { claude: ["claude"], codex: ["codex"] }, untaggedAgent: "claude" };
  assert.equal(providerTag("claude", claudeBare), undefined);
  assert.equal(providerTag("codex", claudeBare), "codex");
  // Flip it and Claude is the one carrying a tag — nothing in the code cares.
  const codexBare = { ...claudeBare, untaggedAgent: "codex" };
  assert.equal(providerTag("claude", codexBare), "claude");
  assert.equal(providerTag("codex", codexBare), undefined);
  // Or tag everything evenly.
  const allTagged = { ...claudeBare, untaggedAgent: "" };
  assert.equal(providerTag("claude", allTagged), "claude");
  assert.equal(providerTag("codex", allTagged), "codex");
});

test("binaries are matched on basename, so a full vendor path still resolves", () => {
  const index = binaryIndex(DEFAULT_AGENT_CONFIG);
  assert.equal(index.get("codex"), "codex");
  assert.equal(index.get("claude.exe"), "claude");
  assert.equal(index.get("node"), undefined);
});
