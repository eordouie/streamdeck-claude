import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../dotfiles/streamdeck/scripts/ghostty-new-agent.sh",
);

test("no arguments means a bare tab, not a defaulted agent", async () => {
  const source = await readFile(LAUNCHER, "utf8");

  // The old launcher defaulted to `claude` when called with no arguments. A slot
  // key now calls it with none, so that default would silently take the choice
  // back from the user.
  assert.doesNotMatch(source, /set -- claude/);
  assert.match(source, /\$\{cmd:-clear\}/);
});

test("Ghostty launcher waits for the new tab and fails closed on an unreadable baseline", async () => {
  const source = await readFile(LAUNCHER, "utf8");

  assert.match(
    source,
    /set tabsBefore to my countWindowMenuItems\(\)\n\s+if hadWindow and tabsBefore is -1 then\n\s+error /,
  );
  assert.match(
    source,
    /if not sawNewTab then\n[\s\S]+?end if/,
  );
  assert.match(
    source,
    /delay 0\.4\n\s+assertGhosttyFrontmost\(\)/,
  );
  assert.match(
    source,
    /keystroke launchCmd[\s\S]+?delay 0\.2\n\s+key code 36/,
  );
});
