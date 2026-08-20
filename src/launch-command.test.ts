import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLaunchCommand } from "./launch-command.js";

const SPEC = {
  script: "/tmp/ghostty-new-agent.sh",
  env: { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1" },
  unsetEnv: ["CLAUDE_CODE_CHILD_SESSION", "AI_AGENT"],
};

test("launch command exports the launch ID into the new tab's shell", () => {
  const command = buildLaunchCommand(SPEC, "launch-1");

  assert.equal(command.env.STREAMDECK_LAUNCH_ID, "launch-1");
  // The prefix is what the launcher types; the id MUST be in it. Passing it only
  // in the child env would leave the tab's own shell without it, and the session
  // the user starts there would never bind to the key they pressed.
  assert.match(command.env.STREAMDECK_LAUNCH_PREFIX ?? "", /export STREAMDECK_LAUNCH_ID='launch-1';/);
  assert.match(command.env.STREAMDECK_LAUNCH_PREFIX ?? "", /unset CLAUDE_CODE_CHILD_SESSION AI_AGENT;/);
  assert.match(command.env.STREAMDECK_LAUNCH_PREFIX ?? "", /export CLAUDE_CODE_DISABLE_TERMINAL_TITLE='1';/);
  assert.equal(command.env.CLAUDE_CODE_CHILD_SESSION, undefined);
});

test("no agent is named anywhere in the launch — the user types it", () => {
  const command = buildLaunchCommand(SPEC, "launch-2");

  // A regression here means the deck picked the agent again. Matched as a
  // COMMAND position (start of line, or after a `;`) rather than anywhere in the
  // string, since the prefix legitimately contains the path `~/.claude/…`.
  assert.doesNotMatch(command.env.STREAMDECK_LAUNCH_PREFIX ?? "", /(^|;\s*)(claude|codex)\b/i);
  assert.deepEqual(Object.keys(command), ["script", "env"]);
});

test("the tab records its own tty under the launch id", () => {
  const command = buildLaunchCommand(SPEC, "launch-3");
  const prefix = command.env.STREAMDECK_LAUNCH_PREFIX ?? "";

  // Without this the plugin cannot tie an agent the user starts by hand to the
  // key that opened its tab: the launch id is in the agent's environment, and
  // macOS will not let anyone read another process's environment.
  assert.match(prefix, /mkdir -p '[^']*\.streamdeck-launch' 2>\/dev\/null && tty > '[^']*launch-3' 2>\/dev\/null;/);
  // Ordering matters: the export must precede the write, so a shell that dies
  // mid-line never leaves a tty file claiming an id the agent never inherited.
  assert.ok(prefix.indexOf("STREAMDECK_LAUNCH_ID") < prefix.indexOf("tty >"));
});

test("launch ids are shell-quoted", () => {
  const command = buildLaunchCommand(SPEC, "it's-1");
  assert.match(command.env.STREAMDECK_LAUNCH_PREFIX ?? "", /'it'\\''s-1'/);
});
