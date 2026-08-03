import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";
import { spawnCapture } from "./spawn-capture.js";
import { WSL_SESSIONS_DIR } from "./env.js";

/**
 * One deliberate word per session, chosen once and never changed.
 *
 * When a session has enough context (its first substantial prompt, plus the
 * generated title when one exists), a single headless `claude -p` call on a
 * small model picks ONE distinguishing word. The word is persisted to
 * `<sid>.deckname` next to the session files, so it survives plugin restarts
 * and stays fixed for the session's life (the hook unlinks it at SessionEnd).
 *
 * The naming call itself spawns a headless Claude session — which would show
 * up on the deck and recursively trigger naming — so it runs from NAMER_CWD,
 * a sentinel directory sessions.ts filters out entirely.
 */

export const NAMER_CWD = join(homedir(), ".claude", "deck-namer");

const CLAUDE_BIN_CANDIDATES = [
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  join(homedir(), ".claude", "local", "claude"),
  join(homedir(), ".local", "bin", "claude"),
];
const NAMER_MODEL = "claude-haiku-4-5-20251001";
const NAMER_TIMEOUT_MS = 45_000;
const RETRY_COOLDOWN_MS = 120_000;
const WORD_RE = /^[a-z][a-z0-9-]{2,11}$/;
const REJECT = new Set(["session", "claude", "code", "project", "projects", "help", "question", "task", "work"]);

const inflight = new Set<string>();
const cooldownUntil = new Map<string, number>();
/** Sidecar contents, cached forever per sid — the word never changes. */
const known = new Map<string, string>();
/** Sessions the namer has permanently given up on (repeated call failures) —
 *  without this, a retired model id or broken binary re-spawned a failing
 *  `claude -p` every RETRY_COOLDOWN_MS forever, for every unnamed session. */
const gaveUp = new Set<string>();
const MAX_NAMER_FAILURES = 3;
const failures = new Map<string, number>();
/** Naming runs strictly one at a time: two sessions named concurrently each
 *  checked a taken-list captured before the other finished, and could both
 *  land the same word — which then collides in the Window-menu exact match
 *  and focuses the wrong tab. */
let nameQueue: Promise<void> = Promise.resolve();

function sidecarPath(sessionId: string): string {
  return join(WSL_SESSIONS_DIR, `${sessionId}.deckname`);
}

/** The assigned word for a session, or "" while none exists yet. */
export async function assignedName(sessionId: string): Promise<string> {
  const cached = known.get(sessionId);
  if (cached !== undefined) return cached;
  try {
    const word = (await readFile(sidecarPath(sessionId), "utf8")).trim();
    known.set(sessionId, word);
    return word;
  } catch {
    return "";
  }
}

async function claudeBin(): Promise<string> {
  for (const p of CLAUDE_BIN_CANDIDATES) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // next candidate
    }
  }
  return "";
}

/** Fire-and-forget: name the session once context exists. Safe to call every
 *  tick — deduped by sidecar presence, an in-flight set, and a retry cooldown. */
export function maybeName(opts: {
  sessionId: string;
  firstPrompt: string;
  title: string;
  takenWords: readonly string[];
}): void {
  const { sessionId, firstPrompt, title, takenWords } = opts;
  if (known.get(sessionId)) return;
  if (gaveUp.has(sessionId)) return;
  if (!firstPrompt && !title) return; // don't rush — wait for real context
  if (inflight.has(sessionId)) return;
  if ((cooldownUntil.get(sessionId) ?? 0) > Date.now()) return;
  inflight.add(sessionId);
  nameQueue = nameQueue
    .then(() => nameSession(sessionId, firstPrompt, title, takenWords))
    .catch((err) => {
      streamDeck.logger.warn(`namer failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      inflight.delete(sessionId);
    });
}

/** Fresh from disk, not from the caller's snapshot: the caller's list was
 *  captured before any queued naming ahead of us finished, so it can miss
 *  the word the previous run just persisted. */
async function takenWordsFromDisk(): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(WSL_SESSIONS_DIR);
    const words = await Promise.all(
      entries
        .filter((f) => f.endsWith(".deckname"))
        .map(async (f) => {
          try {
            return (await readFile(join(WSL_SESSIONS_DIR, f), "utf8")).trim();
          } catch {
            return "";
          }
        }),
    );
    return words.filter(Boolean);
  } catch {
    return [];
  }
}

async function nameSession(
  sessionId: string,
  firstPrompt: string,
  title: string,
  takenWords: readonly string[],
): Promise<void> {
  // Re-check the sidecar (another plugin instance / earlier run may have won).
  if (await assignedName(sessionId)) return;
  cooldownUntil.set(sessionId, Date.now() + RETRY_COOLDOWN_MS);

  const bin = await claudeBin();
  if (!bin) {
    streamDeck.logger.warn("namer: no claude binary found");
    return;
  }
  await mkdir(NAMER_CWD, { recursive: true });

  const taken = [...new Set([...takenWords.filter(Boolean), ...(await takenWordsFromDisk())])];
  const prompt = [
    "You label a developer's parallel Claude Code sessions.",
    "Reply with EXACTLY ONE lowercase word (letters, 3-12 chars, no punctuation)",
    "that most distinctively identifies this session among the others.",
    "Pick the specific subject being worked on (a tool, component, domain, artifact).",
    `Never use generic words (code, session, help, project, task, question)${taken.length ? ` and never any of: ${taken.join(", ")}` : ""}.`,
    "",
    `Session title: ${title || "(none yet)"}`,
    `First request: ${firstPrompt || "(none)"}`,
    "",
    "Reply with ONLY the word, nothing else.",
  ].join("\n");

  const r = await spawnCapture(bin, ["-p", prompt, "--model", NAMER_MODEL], {
    timeoutMs: NAMER_TIMEOUT_MS,
    cwd: NAMER_CWD,
  });
  if (r.err || r.timedOut || r.code !== 0) {
    const n = (failures.get(sessionId) ?? 0) + 1;
    failures.set(sessionId, n);
    if (n >= MAX_NAMER_FAILURES) {
      gaveUp.add(sessionId);
      streamDeck.logger.warn(`namer: giving up on ${sessionId} after ${n} failures — label stays the cwd basename`);
    }
    streamDeck.logger.warn(
      `namer call failed for ${sessionId}: err=${r.err ?? "none"} code=${r.code} timedOut=${r.timedOut === true} stderr=${r.stderr.trim().slice(0, 200)}`,
    );
    return;
  }
  const word = (r.stdout.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!WORD_RE.test(word) || REJECT.has(word) || taken.includes(word)) {
    streamDeck.logger.warn(`namer produced unusable word ${JSON.stringify(word)} for ${sessionId}`);
    return;
  }
  await writeFile(sidecarPath(sessionId), `${word}\n`);
  known.set(sessionId, word);
  streamDeck.logger.info(`namer: session ${sessionId} -> "${word}"`);
}
