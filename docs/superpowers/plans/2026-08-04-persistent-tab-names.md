# Persistent `claude-xxxx-{word}` Tab Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghostty tab titles always follow `claude-<pid>-<word>` once a session is named, and the one-word deck name survives session end / reboot so `claude --resume` reclaims it.

**Architecture:** All naming policy (title format, sidecar GC horizons, live-scoped taken-words) moves into a new pure module `src/naming-policy.ts` with unit tests; `tab-title.ts` re-exports the title function so call sites don't change; `deck-namer.ts` and `sessions.ts` stop deleting `.deckname` sidecars at death and instead age them out after 30 days of the session being dead (mtime-touched while alive); the SessionEnd hook stops unlinking the sidecar.

**Tech Stack:** TypeScript ESM (Node 20 target, `strict: true`), rollup bundle, node:test via `tsx --test`, bash hook script.

**Spec:** `docs/superpowers/specs/2026-08-03-persistent-tab-names-design.md`

## Global Constraints

- Use **pnpm** only (never npm/npx). Tests: `pnpm test` (= `tsx --test src/*.test.ts`). Build: `pnpm build`.
- ESM imports use the `.js` extension even for `.ts` files (e.g. `from "./naming-policy.js"`). Don't drop the extension.
- **Never import `@elgato/streamdeck`** — directly or transitively — from any module a `*.test.ts` file imports. The SDK reads `manifest.json` at import time and crashes under `tsx --test`, and the crashed file is reported as ONE PASSING TEST with exit 0 (verified 2026-08-04). `src/naming-policy.ts` must import node builtins only.
- Working tree has unrelated WIP in `CLAUDE.md`, `LESSONS.md`, `src/icons/motifs.ts`. **Stage files explicitly by path. Never `git add -A`, `-u`, or `.`.** `CLAUDE.md` edits in Task 5 stay uncommitted.
- The plugin runs live from this working tree but only from the built bundle — source edits are inert until `pnpm build`. Do NOT run `pnpm sd:reload` before Task 6.
- Title format, exact: named → `claude-<pid>-<word>`; unnamed → `claude-<pid>` (byte-identical to current behavior).
- Constants: deckname GC horizon 30 days; events-log grace stays 60 s; mtime touch guard 12 h.
- Commit messages: conventional style (`feat:`, `docs:`), matching `git log`.

---

### Task 1: Pure naming-policy module with tests

**Files:**
- Create: `src/naming-policy.ts`
- Create: `src/naming-policy.test.ts`

**Interfaces:**
- Consumes: nothing (node builtins only — see Global Constraints).
- Produces (later tasks import these exact names from `./naming-policy.js`):
  - `canonicalTabTitle(session: { pid: number; deckName: string }): string`
  - `PRUNE_GRACE_MS: number` (60_000)
  - `DECKNAME_MAX_AGE_MS: number` (30 days in ms)
  - `sidecarMaxAgeMs(filename: string): number`
  - `takenWordsFromDisk(liveSids: ReadonlySet<string>, dir: string): Promise<string[]>`

Note the parameter type of `canonicalTabTitle` is a structural `{ pid: number; deckName: string }`, NOT `Pick<SessionInfo, ...>` — this keeps the module free of even type-imports from SDK-adjacent files. `SessionInfo` objects satisfy it structurally.

- [ ] **Step 1: Write the failing test file**

Create `src/naming-policy.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalTabTitle,
  DECKNAME_MAX_AGE_MS,
  PRUNE_GRACE_MS,
  sidecarMaxAgeMs,
  takenWordsFromDisk,
} from "./naming-policy.js";

test("canonicalTabTitle appends the deck word to the pid placeholder", () => {
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "mirrors" }), "claude-84213-mirrors");
});

test("canonicalTabTitle without a word is the bare pid placeholder", () => {
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "" }), "claude-84213");
  assert.equal(canonicalTabTitle({ pid: 84213, deckName: "   " }), "claude-84213");
});

test("canonicalTabTitle rejects words the title grammar can't hold", () => {
  assert.equal(canonicalTabTitle({ pid: 1, deckName: "two words" }), "claude-1");
  assert.equal(canonicalTabTitle({ pid: 1, deckName: "x".repeat(25) }), "claude-1");
});

test("canonicalTabTitle keeps hyphenated words", () => {
  assert.equal(canonicalTabTitle({ pid: 7, deckName: "pizza-fan" }), "claude-7-pizza-fan");
});

test("sidecarMaxAgeMs: deck names persist, event logs do not", () => {
  assert.equal(sidecarMaxAgeMs("abc.deckname"), DECKNAME_MAX_AGE_MS);
  assert.equal(sidecarMaxAgeMs("abc.events.ndjson"), PRUNE_GRACE_MS);
  assert.ok(DECKNAME_MAX_AGE_MS > PRUNE_GRACE_MS);
});

test("takenWordsFromDisk reports only live sessions' words", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naming-policy-"));
  try {
    await writeFile(join(dir, "live-sid.deckname"), "mirrors\n");
    await writeFile(join(dir, "dead-sid.deckname"), "pizza\n");
    await writeFile(join(dir, "live-sid.events.ndjson"), "{}\n");
    const words = await takenWordsFromDisk(new Set(["live-sid"]), dir);
    assert.deepEqual(words, ["mirrors"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("takenWordsFromDisk on a missing dir is empty", async () => {
  assert.deepEqual(await takenWordsFromDisk(new Set(["x"]), "/nonexistent-naming-policy-test"), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test src/naming-policy.test.ts`
Expected: FAIL — cannot find module `./naming-policy.js`.

- [ ] **Step 3: Write the implementation**

Create `src/naming-policy.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Pure naming policy: what a session's terminal tab is called, and how long
 * its one-word deck name outlives the session on disk.
 *
 * Deliberately SDK-free: `@elgato/streamdeck` reads manifest.json at import
 * time and crashes under `tsx --test` — and a test file that dies on import
 * is reported as one PASSING test. Anything unit-tested must stay importable
 * from bare node, so this module's imports are node builtins only.
 */

/** Canonical tab name for a session: `claude-<pid>` while unnamed, extended
 *  to `claude-<pid>-<word>` once the one-word deck name is assigned. NEVER
 *  the display label — that falls back to the cwd basename, which every
 *  session in the same directory would share, and a shared name is exactly
 *  the ambiguity this whole mechanism exists to kill. The pid keeps the full
 *  title unique even if two live sessions ever carry the same word (possible
 *  since persisted words of dormant conversations may be reused). */
export function canonicalTabTitle(session: { pid: number; deckName: string }): string {
  const word = session.deckName.trim();
  return /^[\w-]{1,24}$/.test(word) ? `claude-${session.pid}-${word}` : `claude-${session.pid}`;
}

/** Grace before a confirmed-dead session's <pid>.json / events log is deleted.
 *  A dead file never changes yet pre-prune was re-read every tick over the
 *  slow UNC; we wait this long past the last write so we never race a session
 *  that just dropped its json but whose first liveness probe flaked. */
export const PRUNE_GRACE_MS = 60_000;

/** How long a .deckname sidecar outlives its session, so `claude --resume`
 *  of the same conversation (plain resume reuses the sid) reclaims its word
 *  across reboots. Live sessions' sidecars are mtime-touched (deck-namer's
 *  touchSidecar), so this measures time-since-last-alive, not
 *  time-since-named. */
export const DECKNAME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** GC horizon for an orphaned sidecar file, by kind: deck names persist for
 *  resume; event logs are junk within a minute of death. */
export function sidecarMaxAgeMs(filename: string): number {
  return filename.endsWith(".deckname") ? DECKNAME_MAX_AGE_MS : PRUNE_GRACE_MS;
}

/** Words currently owned by LIVE sessions, read fresh from the sidecar dir.
 *  Fresh from disk, not from the caller's snapshot: the caller's list was
 *  captured before any queued naming ahead of us finished, so it can miss
 *  the word the previous run just persisted. Scoped to live sids: persisted
 *  words of dormant conversations must not shrink the vocabulary forever —
 *  and title uniqueness survives reuse via the pid in canonicalTabTitle. */
export async function takenWordsFromDisk(
  liveSids: ReadonlySet<string>,
  dir: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const words = await Promise.all(
    entries
      .filter((f) => f.endsWith(".deckname") && liveSids.has(f.slice(0, -".deckname".length)))
      .map(async (f) => {
        try {
          return (await readFile(join(dir, f), "utf8")).trim();
        } catch {
          return "";
        }
      }),
  );
  return words.filter(Boolean);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsx --test src/naming-policy.test.ts`
Expected: PASS — 7 tests, 0 fail. Also run the full suite (`pnpm test`) to confirm nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add src/naming-policy.ts src/naming-policy.test.ts
git commit -m "feat: pure naming-policy module — claude-pid-word titles, sidecar GC policy"
```

---

### Task 2: Route tab-title through naming-policy (title format flips here)

**Files:**
- Modify: `src/tab-title.ts` (header comment lines 7–20, the canonicalTabTitle block at lines 22–29)

**Interfaces:**
- Consumes: `canonicalTabTitle` from `./naming-policy.js` (Task 1).
- Produces: `tab-title.ts` continues to export `canonicalTabTitle` (re-export), so `src/render-loop.ts:7` (`import { canonicalTabTitle } from "./tab-title.js"`) and the internal use in `ensureTabTitles` need no changes.

- [ ] **Step 1: Replace the local function with a re-export**

In `src/tab-title.ts`, delete this entire block (lines 22–29):

```ts
/** Canonical tab name for a session: its deck word once assigned, else a
 *  pid-derived placeholder. NEVER the display label — that falls back to the
 *  cwd basename, which every session in the same directory would share, and a
 *  shared name is exactly the ambiguity this whole mechanism exists to kill. */
export function canonicalTabTitle(session: Pick<SessionInfo, "pid" | "deckName">): string {
  const word = session.deckName.trim();
  return /^[\w-]{1,24}$/.test(word) ? word : `claude-${session.pid}`;
}
```

and add after the existing imports (keep the `import type { SessionInfo }` line — `ensureTabTitles` still uses it):

```ts
import { canonicalTabTitle } from "./naming-policy.js";
export { canonicalTabTitle };
```

- [ ] **Step 2: Update the module header's stale sentence**

In the same file's header comment, replace:

```ts
 * Side benefit: the tab bar shows the same one-word names as the deck.
```

with:

```ts
 * Side benefit: the tab bar carries the same one-word names as the deck,
 * embedded in the stable `claude-<pid>-<word>` convention.
```

- [ ] **Step 3: Build to verify types and bundling**

Run: `pnpm test && pnpm build`
Expected: full test suite passes; rollup build completes with no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/tab-title.ts
git commit -m "feat: tab titles follow claude-<pid>-<word> once a session is named"
```

---

### Task 3: Persistence — live-scoped taken words, mtime touch, 30-day GC

**Files:**
- Modify: `src/deck-namer.ts` (imports; delete local `takenWordsFromDisk` lines 107–129; thread `liveSids`; add `touchSidecar`)
- Modify: `src/sessions.ts` (imports line 8 area; `readAllSessions` lines 250–263; delete `PRUNE_GRACE_MS` block lines 283–287; main-prune deckname unlink lines 327–333; orphan sweep grace line ~361)

**Interfaces:**
- Consumes: `PRUNE_GRACE_MS`, `sidecarMaxAgeMs`, `takenWordsFromDisk` from `./naming-policy.js` (Task 1).
- Produces:
  - `deck-namer.ts` exports `touchSidecar(sessionId: string): void` (new).
  - `maybeName(opts)` gains a required `liveSids: ReadonlySet<string>` field: `{ sessionId: string; firstPrompt: string; title: string; takenWords: readonly string[]; liveSids: ReadonlySet<string> }`.

- [ ] **Step 1: deck-namer.ts — imports and taken-words**

Add `utimes` to the fs import and pull the shared reader from naming-policy:

```ts
import { access, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
```

and alongside the other local imports:

```ts
import { takenWordsFromDisk } from "./naming-policy.js";
```

Delete the entire local `takenWordsFromDisk` function (the block from `/** Fresh from disk, not from the caller's snapshot: ...` through its closing `}` — lines 107–129; its rationale comment now lives in naming-policy).

- [ ] **Step 2: deck-namer.ts — thread liveSids through maybeName → nameSession**

In `maybeName`, extend the opts type and destructuring:

```ts
export function maybeName(opts: {
  sessionId: string;
  firstPrompt: string;
  title: string;
  takenWords: readonly string[];
  liveSids: ReadonlySet<string>;
}): void {
  const { sessionId, firstPrompt, title, takenWords, liveSids } = opts;
```

and pass it along in the queue:

```ts
    .then(() => nameSession(sessionId, firstPrompt, title, takenWords, liveSids))
```

In `nameSession`, add the parameter and use the injected dir:

```ts
async function nameSession(
  sessionId: string,
  firstPrompt: string,
  title: string,
  takenWords: readonly string[],
  liveSids: ReadonlySet<string>,
): Promise<void> {
```

and replace the taken-list line:

```ts
  const taken = [...new Set([...takenWords.filter(Boolean), ...(await takenWordsFromDisk())])];
```

with:

```ts
  const taken = [...new Set([...takenWords.filter(Boolean), ...(await takenWordsFromDisk(liveSids, WSL_SESSIONS_DIR))])];
```

- [ ] **Step 3: deck-namer.ts — add touchSidecar**

Add after the `assignedName` function:

```ts
/** Keep a live session's sidecar mtime fresh: the dead-sidecar GC in
 *  sessions.ts measures "time since last alive" off mtime, and a word
 *  written weeks ago would otherwise age out the moment its session dies.
 *  Guarded to one utimes per session per interval; ENOENT (sidecar GC'd or
 *  never written) is fine. */
const TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const lastTouch = new Map<string, number>();

export function touchSidecar(sessionId: string): void {
  const now = Date.now();
  if (now - (lastTouch.get(sessionId) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastTouch.set(sessionId, now);
  const when = new Date();
  void utimes(sidecarPath(sessionId), when, when).catch(() => {});
}
```

- [ ] **Step 4: sessions.ts — imports**

Change line 8 from:

```ts
import { assignedName, maybeName, NAMER_CWD } from "./deck-namer.js";
```

to:

```ts
import { assignedName, maybeName, NAMER_CWD, touchSidecar } from "./deck-namer.js";
import { PRUNE_GRACE_MS, sidecarMaxAgeMs } from "./naming-policy.js";
```

Then delete the now-moved local constant block (lines 283–287):

```ts
/** Grace before a confirmed-dead session's <pid>.json is deleted. A dead file
 *  never changes yet pre-prune was re-read every tick over the slow UNC; we wait
 *  this long past the last write so we never race a session that just dropped its
 *  json but whose first liveness probe flaked (or one shown briefly as finished). */
const PRUNE_GRACE_MS = 60_000;
```

- [ ] **Step 5: sessions.ts — readAllSessions wires liveSids and the touch**

Replace (lines 253–263):

```ts
  const words = await Promise.all(sessions.map((s) => assignedName(s.sessionId)));
  const taken = words.filter(Boolean);
  sessions.forEach((s, i) => {
    if (s.kind === "bg") return;
    if (words[i]) {
      s.label = words[i];
      s.deckName = words[i];
    } else {
      maybeName({ sessionId: s.sessionId, firstPrompt: s.firstPrompt, title: s.title, takenWords: taken });
    }
  });
```

with:

```ts
  const words = await Promise.all(sessions.map((s) => assignedName(s.sessionId)));
  const taken = words.filter(Boolean);
  const liveSids: ReadonlySet<string> = new Set(sessions.map((s) => s.sessionId));
  sessions.forEach((s, i) => {
    if (s.kind === "bg") return;
    if (words[i]) {
      s.label = words[i];
      s.deckName = words[i];
      touchSidecar(s.sessionId);
    } else {
      maybeName({ sessionId: s.sessionId, firstPrompt: s.firstPrompt, title: s.title, takenWords: taken, liveSids });
    }
  });
```

- [ ] **Step 6: sessions.ts — main prune keeps the sidecar**

In `pruneDeadSessions`, delete this block (lines 327–333):

```ts
        // The one-time deck-name sidecar dies with its session too — it was
        // the one file nothing ever deleted when SessionEnd didn't fire.
        try {
          await unlink(join(src.path, `${s.sessionId}.deckname`));
        } catch {
          /* ENOENT — fine */
        }
```

and replace it with only a comment:

```ts
        // The .deckname sidecar deliberately survives its session: plain
        // `claude --resume` reuses the sid, so the word is reclaimed across
        // reboots. Dormant sidecars age out via sidecarMaxAgeMs in the
        // orphan sweep below.
```

- [ ] **Step 7: sessions.ts — orphan sweep ages deck names on their own horizon**

In the orphan sweep, replace:

```ts
              if (now - st.mtimeMs < PRUNE_GRACE_MS) return;
```

with:

```ts
              if (now - st.mtimeMs < sidecarMaxAgeMs(m[0])) return;
```

and update the sweep's lead comment sentence `... Grace-gated like the main prune.` to `... Event logs are grace-gated like the main prune; .deckname files persist DECKNAME_MAX_AGE_MS so dormant conversations stay resumable by name.`

- [ ] **Step 8: Test and build**

Run: `pnpm test && pnpm build`
Expected: all tests pass (naming-policy suite included); build clean. If TS flags the unused `join`/`unlink` imports in sessions.ts after Step 6 — they are still used elsewhere in the file (events/json prune); nothing should need removing.

- [ ] **Step 9: Commit**

```bash
git add src/deck-namer.ts src/sessions.ts
git commit -m "feat: deck words persist past session death — live-scoped taken words, 30d GC, mtime touch"
```

---

### Task 4: Hook — SessionEnd keeps the sidecar

**Files:**
- Modify: `hooks/notification.sh` (SessionEnd block, lines ~32–38)
- Verify only (no edit): `hooks/notification.ps1`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Tasks 1–3).
- Produces: on-disk behavior only — `<sid>.deckname` survives SessionEnd.

- [ ] **Step 1: Edit the SessionEnd block**

In `hooks/notification.sh`, replace:

```bash
# SessionEnd: drop the log and the one-time deck-name sidecar.
if [ "$EVENT" = "SessionEnd" ]; then
  rm -f "$TARGET" "${SESSIONS_DIR}/${SESSION_ID}.deckname"
  echo '{}'
  exit 0
fi
```

with:

```bash
# SessionEnd: drop the log. The one-word .deckname sidecar deliberately
# survives — plain `claude --resume` reuses the session id, so the word is
# reclaimed after a reboot; dormant sidecars age out in the plugin's sweep.
if [ "$EVENT" = "SessionEnd" ]; then
  rm -f "$TARGET"
  echo '{}'
  exit 0
fi
```

- [ ] **Step 2: Confirm the PowerShell mirror needs no change**

Run: `grep -in deckname hooks/notification.ps1`
Expected: no matches (verified 2026-08-04 — the ps1 SessionEnd block only removes the events log). If a match appears, mirror the bash change there.

- [ ] **Step 3: Confirm hook registration is untouched**

Run: `pnpm check:hooks`
Expected: installed hook config still matches (the script path didn't change, only its body). No re-install needed.

- [ ] **Step 4: Commit**

```bash
git add hooks/notification.sh
git commit -m "feat(hooks): keep .deckname at SessionEnd so resume reclaims the word"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/ghostty-focus.md` (lines ~45–46 and ~54–55) — committed.
- Modify: `CLAUDE.md` (lines 121, 132–134, 182) — **edited but NOT committed** (file carries unrelated WIP; Ehsan's own commit flow will pick it up).

**Interfaces:** none — prose only.

- [ ] **Step 1: docs/ghostty-focus.md — canonical-name description**

Replace:

```
`canonicalTabTitle()` returns the session's **deck word** once the namer has
assigned one (`src/deck-namer.ts`), else `claude-<pid>`.
```

with:

```
`canonicalTabTitle()` (in `src/naming-policy.ts`) returns
`claude-<pid>-<word>` once the namer has assigned the session's one-word
deck name (`src/deck-namer.ts`), else `claude-<pid>`. The word persists in
`<sid>.deckname` past session death, so a resumed conversation (same sid)
reclaims it; the pid part keeps every live title unique even if a dormant
conversation's word gets reused.
```

- [ ] **Step 2: docs/ghostty-focus.md — side-benefit sentence**

Replace:

```
Side benefit: the Ghostty tab bar ends up showing the same one-word names as
the deck keys.
```

with:

```
Side benefit: the Ghostty tab bar ends up carrying the deck's one-word names,
embedded in the stable `claude-<pid>-<word>` convention.
```

- [ ] **Step 3: CLAUDE.md — three stale sentences (edit, don't commit)**

Line 121: change `name (deck word, else `claude-<pid>`) as an OSC 2 sequence` to `name (`claude-<pid>-<word>` once named, else `claude-<pid>`) as an OSC 2 sequence`.

Lines 132–134: change `Persisted to `~/.claude/sessions/<sid>.deckname`, never changed for the session's life, unlinked at SessionEnd.` to `Persisted to `~/.claude/sessions/<sid>.deckname`, never changed for the session's life, and kept past SessionEnd so a plain `claude --resume` (same sid) reclaims it; dormant sidecars age out after 30 days dead.`

Line 182: change `naming context, and unlinks the `.deckname` sidecar at SessionEnd.` to `naming context. The `.deckname` sidecar survives SessionEnd for resume.`

- [ ] **Step 4: Commit (ghostty-focus.md ONLY)**

```bash
git add docs/ghostty-focus.md
git commit -m "docs: persistent claude-pid-word tab naming"
git status --short   # CLAUDE.md must still show as modified-uncommitted
```

---

### Task 6: Rollout and live verification

**Files:** none created — build, reload, observe.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Full gate**

Run: `pnpm test && pnpm build && pnpm sd:validate`
Expected: suite green, bundle built, manifest validates.

- [ ] **Step 2: Reload the live plugin**

Run: `pnpm sd:reload`
Expected: plugin self-exits and the Stream Deck app respawns it within ~1 s.

- [ ] **Step 3: Watch the new-format stamps land**

Run (within a minute of reload): `grep -o 'tab title: pid=[0-9]* -> "[^"]*"' com.julien.claudesessions.sdPlugin/logs/com.julien.claudesessions.0.log | tail -8`
Expected: named sessions now stamp `claude-<pid>-<word>` (e.g. `claude-3397-decknames`); unnamed ones still `claude-<pid>`. Ghostty tab bar / Window menu show the same. Press a deck key for a NAMED session → correct tab focuses (exact-match still works with the new format).

- [ ] **Step 4: Sidecar survives SessionEnd**

In a throwaway Ghostty tab: start `claude`, send one trivial prompt, wait for the key to show a word, note the sid (`ls -t ~/.claude/sessions/*.deckname | head -1`), then exit the session. After >60 s (one prune grace), verify:
`ls ~/.claude/sessions/<sid>.deckname` → still exists, while `<sid>.events.ndjson` is gone.

- [ ] **Step 5: Resume reclaims the word**

In a new tab run `claude --resume` and pick that same conversation. Within ~30 s the tab must be stamped `claude-<newpid>-<sameword>` (watch the log line from Step 3). Exit and clean up the throwaway conversation afterwards if desired.

- [ ] **Step 6: Mark done**

No commit here unless fixes were needed. Report the observed log lines as evidence.
