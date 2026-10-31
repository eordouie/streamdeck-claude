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

/** Canonical tab name for a session: `claude-<pid>` while unnamed, or
 *  `codex-<session-id>` for Codex, extended with the deck word when present. NEVER
 *  the display label — that falls back to the cwd basename, which every
 *  session in the same directory would share, and a shared name is exactly
 *  the ambiguity this whole mechanism exists to kill. The pid keeps the full
 *  title unique even if two live sessions ever carry the same word (possible
 *  since persisted words of dormant conversations may be reused). */
export function canonicalTabTitle(session: { pid?: number; deckName: string; provider: string; sessionId?: string }): string {
  // The provider is ONLY a prefix, and it is REQUIRED: defaulting it to
  // `claude` meant a session whose provider went missing was silently renamed
  // into Claude's namespace. Every provider gets the identical
  // `<provider>-<pid>-<word>` shape so the deck word, the tab strip and the
  // exact-match focus lookup behave the same for all of them. Codex used to
  // fall back to a truncated session id here, which quietly made it a
  // second-class citizen with no deck word.
  const provider = session.provider;
  const word = session.deckName.trim();
  if (session.pid === undefined) return `${provider}-session`;
  return /^[\w-]{1,24}$/.test(word) ? `${provider}-${session.pid}-${word}` : `${provider}-${session.pid}`;
}

/**
 * Words that could only have come from the namer's OWN environment rather than
 * from the session it is naming, derived from the sentinel directory it runs in.
 *
 * `claude -p` puts its working directory into the model's context, and the namer
 * runs from a sentinel dir so its headless session can be filtered off the deck.
 * When the session being named is thin — a short first prompt and, for Codex,
 * never a title — the model reaches for that ambient context and names the
 * session after the labelling tool. Measured 2026-08-17: "what is the latest
 * news" produced `deck`/`deckname` from `~/.claude/deck-namer` and
 * `news`/`briefing` from a neutral directory, and four `.deckname` sidecars on
 * this machine had silently collected the word `deck`.
 *
 * The namer's prompt now tells the model to ignore that context, which is the
 * actual fix; this is the backstop for when it doesn't listen. Derived from the
 * path rather than hardcoded, so renaming the sentinel keeps the guard honest.
 */
export function selfReferentialWords(namerCwd: string): Set<string> {
  const out = new Set<string>();
  for (const segment of namerCwd.split(/[\\/]/).filter(Boolean)) {
    const clean = segment.replace(/^\./, "").toLowerCase();
    if (!clean) continue;
    const parts = clean.split(/[-_]/).filter(Boolean);
    out.add(clean);
    out.add(parts.join("")); // "deck-namer" also leaks as "decknamer"
    for (const part of parts) out.add(part);
  }
  out.delete("");
  return out;
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

/**
 * Display label for a BACKGROUND job's tile.
 *
 * A bg job never earns a deck word — `readAllSessions`'s namer returns early on
 * `kind === "bg"` — so whatever this returns is what the tile says for the whole
 * life of the job. `basename(cwd)` alone made that "projects" for every job
 * launched from `~/Projects`, which is the shared-name ambiguity this module
 * exists to kill (see `canonicalTabTitle`). Measured 2026-08-19: a job whose own
 * record said `name: "lever-ats-auth-issue"` rendered as `projects`, and the user
 * could not tell what the tile was for — the field was documented as the label's
 * first choice and never actually read.
 *
 * Claude Code names its jobs after the work, so prefer that. `cwdBasename` stays
 * the fallback for a job with no name yet, which is a real state right after a
 * park. Whitespace-only names count as absent, and the result is trimmed but not
 * length-capped: the renderer wraps and escapes it (`splitLabel`, `xmlEscape`).
 */
export function bgJobLabel(name: string | undefined, cwdBasename: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed === "" ? cwdBasename : trimmed;
}

/** How many of a session's prompts feed the namer. Three is context, not a
 *  bar: 2026-10-06 the namer waited for three prompts (or 30 words) so a thin
 *  opener ("continue the session") would not name the session `vacant`, and
 *  by 2026-10-20 a one-task session had sat on the cwd basename (`Projects`)
 *  for an hour. The thin-opener case is the model's to call now: it answers
 *  UNKNOWN_WORD and the namer retries when another prompt arrives. */
export const MAX_NAMING_PROMPTS = 3;

/** How much of each piece of naming context the namer sees. The transcript
 *  holds the full first prompt; the hook's events clip it at 200 characters,
 *  and 200 characters of a voice-dictated opener named a session `headersd`
 *  (Handy's `heresder` for herdr) on 2026-10-31. Later prompts and the reply
 *  refine; the first prompt and the reply carry the subject. */
export const NAMING_FIRST_PROMPT_CHARS = 1500;
export const NAMING_LATER_PROMPT_CHARS = 300;
export const NAMING_REPLY_CHARS = 800;

/** How long the namer waits for the assistant's first reply after the first
 *  qualifying prompt before naming from the prompt alone. The reply restates
 *  a dictated request in clean words (measured 2026-10-31: `heresder` →
 *  `herdr upgrade`, `view-toggle` → `source visibility`); a first turn that
 *  runs tools for longer than this is named without it. */
export const NAMING_REPLY_WAIT_MS = 90_000;

/** What the namer is given for one session. */
export interface NamingContext {
  /** The first MAX_NAMING_PROMPTS human prompts (isNamingPrompt). */
  prompts: readonly string[];
  /** The assistant's first text reply after the first prompt; "" until it lands. */
  reply: string;
  /** When the first qualifying prompt was submitted (ms epoch); 0 when unknown. */
  firstPromptAt: number;
}

/** The namer's reply when the prompts name no specific subject yet. Not a
 *  failure — it waits for the next prompt (deck-namer.ts). */
export const UNKNOWN_WORD = "unknown";

/** Longest deck word, hyphen included; canonicalTabTitle accepts 24. */
export const MAX_DECK_WORD_LEN = 20;

/** A usable deck word: one or two lowercase tokens of letters or digits (at
 *  least one letter overall), joined by a single hyphen, MAX_DECK_WORD_LEN
 *  characters in all. The key splits the label on the hyphen (splitLabel).
 *  History: a 12-char single-word cap rejected `asphaltsiting` and
 *  `capacityfactor` (2026-10-06 … 10-20); its replacement, 3-16 letters plus
 *  an optional 2-12 letter tail, rejected `cone-visualization`,
 *  `hotel-reimbursement`, `amt-3921` and `az-el` three times each
 *  (2026-10-28 … 10-30) and the namer gave up on those sessions. Every one
 *  of those was a fine label; the shape rule now only guards the title
 *  grammar, and deck-namer re-asks with the reason or clips (clipWord)
 *  instead of giving up. */
export const DECK_WORD_RE = /^(?=[a-z0-9-]{2,20}$)(?=.*[a-z])[a-z0-9]{2,}(?:-[a-z0-9]{2,})?$/;

/** The model's reply as a candidate word: first line, lowercased, anything
 *  but letters, digits, spaces and hyphens dropped, at most two tokens
 *  joined by one hyphen. "" when nothing usable remains; DECK_WORD_RE still
 *  judges the result. */
export function normaliseWord(reply: string): string {
  const line = reply.trim().split("\n")[0] ?? "";
  const tokens = line
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (tokens[0] === UNKNOWN_WORD) return UNKNOWN_WORD;
  return tokens.slice(0, 2).join("-");
}

/** The nearest usable word to an answer DECK_WORD_RE refused, or "" when
 *  nothing survives: both tokens when they fit, else the first token alone,
 *  else the first token cut to MAX_DECK_WORD_LEN. Tokens of one character
 *  are dropped. The last resort after a re-ask — a clipped word on the key
 *  beats a bare key, which is what three identical rejections produced. */
export function clipWord(answer: string): string {
  const tokens = answer
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 2);
  const one = tokens[0] ?? "";
  const pair = tokens.join("-");
  if (DECK_WORD_RE.test(pair)) return pair;
  if (DECK_WORD_RE.test(one)) return one;
  const cut = one.slice(0, MAX_DECK_WORD_LEN);
  return DECK_WORD_RE.test(cut) ? cut : "";
}

/** Why a candidate word cannot be used, in words the namer can be told on a
 *  second ask ("" when it can). The bans are the caller's: generic words,
 *  broad words (broadWords) and words already taken by live sessions. */
export function rejectionReason(
  word: string,
  bans: { generic: ReadonlySet<string>; broad: readonly string[]; taken: readonly string[] },
): string {
  if (!word) return "the reply held no usable letters";
  if (bans.generic.has(word)) return `"${word}" is a generic word that names no subject`;
  if (bans.broad.includes(word)) return `"${word}" names what many sessions share`;
  if (bans.taken.includes(word)) return `"${word}" already labels another live session`;
  if (word.length > MAX_DECK_WORD_LEN) {
    return `"${word}" is ${word.length} characters; the limit is ${MAX_DECK_WORD_LEN} including the space`;
  }
  if (!DECK_WORD_RE.test(word)) return `"${word}" is not one or two words of letters or digits`;
  return "";
}

/** A prompt that tells the namer something: a human request of 3+ words.
 *  Slash commands and machine-injected turns (background-task notifications,
 *  command wrappers) name harness plumbing, not the work. */
export function isNamingPrompt(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || t.startsWith("/") || t.startsWith("<")) return false;
  if (/^\[SYSTEM NOTIFICATION/.test(t)) return false;
  return t.split(/\s+/).length >= 3;
}

/** Enough context to ask for a word: one human prompt (isNamingPrompt) AND
 *  the assistant's first reply to it — or NAMING_REPLY_WAIT_MS since the
 *  prompt when no reply has landed (a first turn spent in tools, a Codex
 *  session, a transcript that cannot be read). A prompt whose time is
 *  unknown is not kept waiting. Whether the context names a subject is the
 *  model's call (UNKNOWN_WORD). Ehsan's choice 2026-10-31: a word chosen once,
 *  a minute late, over a quick word that changes. */
export function namingReady(ctx: NamingContext, now: number): boolean {
  if (ctx.prompts.length === 0) return false;
  if (ctx.reply) return true;
  return ctx.firstPromptAt <= 0 || now - ctx.firstPromptAt >= NAMING_REPLY_WAIT_MS;
}

/** Words that name what MANY sessions share — the workspace, its products and
 *  tools — so they cannot tell sessions apart. 2026-10-06: of 15 recent words,
 *  `hive`, `nebula`, `mirror`, `lighttools` and `lenses` named the project or
 *  tool, not the subject. */
const BROAD_WORDS = [
  "exowatt", "hive", "minihive", "nebula", "optics", "optical", "mirror", "mirrors",
  "lens", "lenses", "lighttools", "receiver", "tracker", "solar", "sim", "sims",
  "simulation", "deck", "streamdeck", "claude", "agent", "agents", "workspace",
];

/** BROAD_WORDS plus every folder on the session's path (repo names like
 *  `terrawatt`, zone names like `active`): the session's location is shared by
 *  every other session in the same repo. */
export function broadWords(cwd: string): string[] {
  const out = new Set(BROAD_WORDS);
  for (const segment of cwd.split(/[\\/]/).filter(Boolean)) {
    const clean = segment.replace(/^\./, "").toLowerCase();
    if (clean.length < 3 || clean === "users") continue;
    out.add(clean);
    for (const part of clean.split(/[-_]/)) if (part.length >= 4) out.add(part);
  }
  return [...out];
}

/** The word a hand-renamed Ghostty tab asks for, or null.
 *
 *  Ghostty keeps a hand-set tab name (View > Change Tab Title…) as an override
 *  above the title the plugin stamps, so the two layers disagree:
 *  tab `claude-33832-Humain`, terminal `claude-33832-nebula` (2026-10-01).
 *  The user renamed it because the deck word was wrong, so the deck follows
 *  the tab. The terminal title identifies the session (`<provider>-<pid>…`,
 *  our own stamp); the tab name supplies the word, with or without the
 *  `<provider>-<pid>-` prefix — the pid in a hand-typed name may be stale
 *  after a resume in the same tab, so it is not trusted. Spaces become dashes;
 *  anything canonicalTabTitle would not accept as a word is ignored. */
export function handRenamedWord(tabName: string, terminalTitle: string): { pid: number; word: string } | null {
  const term = /^(?:claude|codex)-(\d+)(?:-|$)/.exec(terminalTitle.trim());
  if (!term) return null;
  const tab = tabName.trim();
  if (!tab || tab === terminalTitle.trim()) return null;
  const prefixed = /^(?:claude|codex)-\d+(?:-(.*))?$/.exec(tab);
  if (prefixed && prefixed[1] === undefined) return null; // bare `claude-<pid>`: no word asked for
  const word = (prefixed ? prefixed[1] : tab).trim().replace(/\s+/g, "-");
  if (!/^[\w-]{1,24}$/.test(word)) return null;
  return { pid: Number(term[1]), word };
}
