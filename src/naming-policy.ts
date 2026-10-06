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

/** How many of a session's prompts feed the namer, and when it may name.
 *  One prompt was the old bar, and the opener is often thin ("continue the
 *  session", "pull all"): 2026-10-06 the live words included `vacant` and
 *  `labeling`. Waiting for three prompts — or one prompt long enough to carry
 *  the topic on its own — trades a few minutes of cwd-basename label for a
 *  word that names the work. */
export const MAX_NAMING_PROMPTS = 3;
export const NAMING_READY_WORDS = 30;

/** A prompt that tells the namer something: a human request of 3+ words.
 *  Slash commands and machine-injected turns (background-task notifications,
 *  command wrappers) name harness plumbing, not the work. */
export function isNamingPrompt(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || t.startsWith("/") || t.startsWith("<")) return false;
  if (/^\[SYSTEM NOTIFICATION/.test(t)) return false;
  return t.split(/\s+/).length >= 3;
}

/** Enough context to pick a word that will stay right. A title alone does not
 *  count: Claude Code titles a session from its first prompt, so it adds no
 *  information the first prompt lacked. */
export function namingReady(prompts: readonly string[]): boolean {
  if (prompts.length >= MAX_NAMING_PROMPTS) return true;
  const words = prompts.reduce((n, p) => n + p.trim().split(/\s+/).filter(Boolean).length, 0);
  return words >= NAMING_READY_WORDS;
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
