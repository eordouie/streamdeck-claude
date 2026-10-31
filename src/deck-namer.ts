import { access, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";
import {
  broadWords,
  clipWord,
  namingReady,
  normaliseWord,
  rejectionReason,
  selfReferentialWords,
  takenWordsFromDisk,
  UNKNOWN_WORD,
  type NamingContext,
} from "./naming-policy.js";
import { spawnCapture } from "./spawn-capture.js";
import { WSL_SESSIONS_DIR } from "./env.js";

/**
 * One deliberate word per session, chosen once and never changed.
 *
 * When a session has enough context (namingReady: its first prompt and the
 * assistant's first reply, or 90 s without one), a headless `claude -p` call
 * picks one or two distinguishing words (joined by a hyphen on the key and
 * in the tab title). An answer the policy refuses is asked again WITH the
 * reason, then clipped to fit — never silently dropped: three identical
 * re-asks of `cone-visualization` left that session bare (2026-10-28). The user can overrule it by renaming the
 * Ghostty tab (adoptName). The word is persisted to
 * `<sid>.deckname` next to the session files, so it survives plugin restarts,
 * and is kept after SessionEnd so `--resume` reclaims it (30-day GC in
 * sessions.ts).
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
/** An alias, not a dated id: a retired id once failed every naming call
 *  (see gaveUp). Sonnet over Haiku since 2026-10-06 — the call is one short
 *  prompt, and Haiku's words named the project rather than the subject. */
const NAMER_MODEL = "sonnet";
const NAMER_TIMEOUT_MS = 45_000;
const RETRY_COOLDOWN_MS = 120_000;
const REJECT = new Set(["session", "claude", "code", "project", "projects", "help", "question", "task", "work"]);

/** Backstop against the namer naming a session after its own sentinel cwd —
 *  see selfReferentialWords for the measurement behind it. */
const SELF_WORDS = selfReferentialWords(NAMER_CWD);

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
/** Prompt count at the last UNKNOWN_WORD answer, per session: the model saw
 *  nothing to name yet, so ask again only once another prompt has arrived —
 *  not every cooldown with the same thin opener. */
const askedWith = new Map<string, number>();
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
  prompts: readonly string[];
  reply: string;
  firstPromptAt: number;
  title: string;
  cwd: string;
  takenWords: readonly string[];
  liveSids: ReadonlySet<string>;
}): void {
  const { sessionId, prompts, reply, firstPromptAt, title, cwd, takenWords, liveSids } = opts;
  const ctx: NamingContext = { prompts, reply, firstPromptAt };
  if (known.get(sessionId)) return;
  if (gaveUp.has(sessionId)) return;
  if (!namingReady(ctx, Date.now())) return; // don't rush — wait for the reply, or 90 s
  if ((askedWith.get(sessionId) ?? -1) >= prompts.length) return; // answered `unknown` on these
  if (inflight.has(sessionId)) return;
  if ((cooldownUntil.get(sessionId) ?? 0) > Date.now()) return;
  inflight.add(sessionId);
  nameQueue = nameQueue
    .then(() => nameSession(sessionId, ctx, title, cwd, takenWords, liveSids))
    .catch((err) => {
      streamDeck.logger.warn(`namer failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      inflight.delete(sessionId);
    });
}

/** The user's word wins: a hand-renamed Ghostty tab (handRenamedWord) replaces
 *  the session's word, persisted like a namer word so `--resume` keeps it. */
export async function adoptName(sessionId: string, word: string): Promise<void> {
  if (known.get(sessionId) === word) return;
  await writeFile(sidecarPath(sessionId), `${word}\n`);
  known.set(sessionId, word);
  streamDeck.logger.info(`namer: session ${sessionId} -> "${word}" (tab renamed by hand)`);
}

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

const SYSTEM_PROMPT = [
  "You label a developer's parallel terminal sessions so he can tell them apart at a glance",
  "and say the label out loud to mean that session.",
  "Reply with a label of ONE or TWO short lowercase words separated by a space (letters or",
  "digits, 20 characters at most in total): the specific subject of THIS session — the",
  "component, study, artifact, bug, decision or question being worked on. Use two words",
  "only when one is ambiguous.",
  "The first request was dictated by voice and may contain mis-heard or misspelled words;",
  "the assistant's reply, when given, restates what the session is actually about — trust",
  "it over the raw transcription, and never copy a misspelling into the label.",
  "Many sessions share the same company, product, repo and tool, so a word naming those",
  "identifies nothing. Prefer the narrowest concrete noun the context supports",
  "(calorimeter, dfmea, shading, crossfire, tab naming, step files), not the umbrella it",
  "belongs to, and not the kind of work (review, fix, plan, question) unless nothing else",
  "distinguishes it.",
  `If the context names no specific subject yet ("continue the session", "pull all"),`,
  `reply exactly: ${UNKNOWN_WORD}`,
  "Reply with ONLY the label.",
].join("\n");

function namingPrompt(ctx: NamingContext, title: string, broad: readonly string[], taken: readonly string[]): string {
  const [first = "", ...later] = ctx.prompts;
  return [
    `Never use these broad words: ${broad.join(", ")}.`,
    `Never use generic words (${[...REJECT].join(", ")})${taken.length ? ` and never any of: ${taken.join(", ")}` : ""}.`,
    "",
    ...(title ? [`Session title: ${title}`] : []),
    `First request (voice-dictated): ${first}`,
    `Assistant's reply: ${ctx.reply || "(none yet)"}`,
    ...later.map((p, i) => `Later request ${i + 2}: ${p}`),
  ].join("\n");
}

/** One headless call. `word` is the normalised first line of the answer;
 *  `failed` covers a missing binary, a non-zero exit and the timeout. */
async function askNamer(bin: string, prompt: string): Promise<{ word: string; failed: string }> {
  // Lean call: our own system prompt and no settings sources, so the user's
  // global CLAUDE.md (which names every repo and product) is not in context —
  // measured 2026-10-06, the default call listed hive, terrawatt, fresnel… as
  // context, which pulled words toward the project. No tools: it only answers.
  const r = await spawnCapture(bin, ["-p", prompt, "--model", NAMER_MODEL, "--system-prompt", SYSTEM_PROMPT, "--setting-sources", "", "--tools", ""], {
    timeoutMs: NAMER_TIMEOUT_MS,
    cwd: NAMER_CWD,
  });
  if (r.err || r.timedOut || r.code !== 0) {
    return { word: "", failed: `err=${r.err ?? "none"} code=${r.code} timedOut=${r.timedOut === true} stderr=${r.stderr.trim().slice(0, 200)}` };
  }
  return { word: normaliseWord(r.stdout), failed: "" };
}

async function nameSession(
  sessionId: string,
  ctx: NamingContext,
  title: string,
  cwd: string,
  takenWords: readonly string[],
  liveSids: ReadonlySet<string>,
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

  const taken = [...new Set([...takenWords.filter(Boolean), ...(await takenWordsFromDisk(liveSids, WSL_SESSIONS_DIR))])];
  const broad = broadWords(cwd);
  const bans = { generic: REJECT, broad, taken };
  // A word that describes the labelling tool is wrong for EVERY session, and
  // would be wrong identically for the next one too (selfReferentialWords).
  const whyNot = (word: string): string =>
    rejectionReason(word, bans) || (SELF_WORDS.has(word) ? `"${word}" names the labelling tool, not the session` : "");
  const fail = (what: string): void => {
    const n = (failures.get(sessionId) ?? 0) + 1;
    failures.set(sessionId, n);
    if (n >= MAX_NAMER_FAILURES) {
      gaveUp.add(sessionId);
      streamDeck.logger.warn(`namer: giving up on ${sessionId} after ${n} failures — label stays the cwd basename`);
    }
    streamDeck.logger.warn(`namer ${what} for ${sessionId}`);
  };

  const prompt = namingPrompt(ctx, title, broad, taken);
  const first = await askNamer(bin, prompt);
  if (first.failed) {
    fail(`call failed: ${first.failed}`);
    return;
  }
  if (first.word === UNKNOWN_WORD) {
    // Nothing to name yet — not a failure. The next prompt re-opens the
    // question; until then the key keeps the cwd basename.
    askedWith.set(sessionId, ctx.prompts.length);
    streamDeck.logger.info(`namer: no subject yet for ${sessionId} (${ctx.prompts.length} prompt(s)); waiting for the next prompt`);
    return;
  }

  let word = first.word;
  let note = "";
  const reason = whyNot(word);
  if (reason) {
    // Ask again WITH the reason — the same prompt re-sent returns the same
    // answer — then clip whatever comes back rather than leave the key bare.
    const second = await askNamer(bin, `${prompt}\n\nYour previous answer was rejected: ${reason}. Answer again with a different label that fits the rules.`);
    const candidate = second.failed || second.word === UNKNOWN_WORD ? "" : second.word;
    if (candidate && !whyNot(candidate)) {
      word = candidate;
      note = ` (first answer ${JSON.stringify(first.word)} rejected: ${reason})`;
    } else {
      const clipped = [candidate, first.word].map(clipWord).find((w) => w && !whyNot(w)) ?? "";
      if (!clipped) {
        // Counted as a failure: a model that keeps answering with a banned
        // word would otherwise be re-asked every RETRY_COOLDOWN_MS forever.
        fail(`produced unusable words ${JSON.stringify(first.word)} / ${JSON.stringify(candidate || second.failed || UNKNOWN_WORD)}`);
        return;
      }
      word = clipped;
      note = ` (clipped from ${JSON.stringify(candidate || first.word)}: ${reason})`;
    }
  }
  // The user may have renamed the tab while the call ran; their word stands.
  if (known.get(sessionId)) return;
  await writeFile(sidecarPath(sessionId), `${word}\n`);
  known.set(sessionId, word);
  streamDeck.logger.info(`namer: session ${sessionId} -> "${word}"${note}`);
}
