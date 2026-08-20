import assert from "node:assert/strict";
import { test } from "node:test";

// Provider modules load the runtime path configuration. Tests run against the
// TypeScript sources before the build step, so supply the one build-time value
// that is normally baked into the bundle.
process.env.WSL_DISTRO_NAME ??= "test-distro";
const { createBuiltinProviders } = await import("./providers/index.js");

test("built-in providers are discovery adapters, not launchers", () => {
  const providers = createBuiltinProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["claude", "codex"]);

  const claude = providers.find((provider) => provider.id === "claude");
  const codex = providers.find((provider) => provider.id === "codex");
  assert.ok(claude);
  assert.ok(codex);
  assert.notEqual(claude, codex);
  // No adapter carries a launch command: the deck opens a bare tab and the user
  // types the agent, so an adapter that could start one would be dead weight
  // that quietly reintroduces a default.
  for (const provider of [claude, codex]) {
    assert.equal((provider as unknown as Record<string, unknown>).launch, undefined);
  }
});

test("built-in providers expose the common adapter operations", () => {
  for (const provider of createBuiltinProviders()) {
    assert.equal(typeof provider.readSessions, "function");
    assert.equal(typeof provider.filterLive, "function");
    assert.equal(typeof provider.focus, "function");
    assert.equal(typeof provider.terminate, "function");
  }
});
