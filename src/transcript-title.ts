import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Last occurrence of `"key":"<value>"` in raw JSONL, JSON-unescaped. */
export function lastJsonString(text: string, key: string): string {
  const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, "g");
  let last = "";
  for (const m of text.matchAll(re)) last = m[1];
  if (!last) return "";
  try {
    return JSON.parse(`"${last}"`) as string;
  } catch {
    return "";
  }
}

/** Claude Code's project-dir encoding: every non-alphanumeric cwd character
 *  becomes "-" (so `/Users/x/Projects` → `-Users-x-Projects`). */
export function derivedTranscriptPath(cwd: string, sessionId: string): string {
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", enc, `${sessionId}.jsonl`);
}

/** The session's display title: customTitle (user rename) over aiTitle (auto
 *  topic). Bounded read — the tail chunk catches retitles, the head chunk the
 *  first title — so ticking every second over multi-MB transcripts stays
 *  cheap. Cached by (size, mtime). "" when the transcript has no title yet. */
const CHUNK = 256 * 1024;
const titleCache = new Map<string, { size: number; mtimeMs: number; title: string }>();

export async function readSessionTitle(path: string): Promise<string> {
  if (!path) return "";
  let size: number, mtimeMs: number;
  try {
    const st = await stat(path);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return "";
  }
  const cached = titleCache.get(path);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.title;

  let title = "";
  try {
    const fh = await open(path, "r");
    try {
      const tail = Buffer.alloc(Math.min(CHUNK, size));
      await fh.read(tail, 0, tail.length, Math.max(0, size - tail.length));
      let text = tail.toString("utf8");
      title = lastJsonString(text, "customTitle") || lastJsonString(text, "aiTitle");
      if (!title && size > CHUNK) {
        const head = Buffer.alloc(CHUNK);
        await fh.read(head, 0, head.length, 0);
        text = head.toString("utf8");
        title = lastJsonString(text, "customTitle") || lastJsonString(text, "aiTitle");
      }
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
  titleCache.set(path, { size, mtimeMs, title });
  return title;
}

/** Words that carry no meaning on a 12-char key label — covers both title
 *  prose and chat-prompt filler (the label also feeds off raw prompts). */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with",
  "from", "into", "onto", "via", "by", "at", "as", "is", "are", "be",
  "set", "setup", "up", "make", "add", "get", "fix", "use", "using",
  "new", "how", "what", "why", "when", "claude", "code", "session",
  "i", "you", "it", "we", "me", "my", "your", "this", "that", "these",
  "those", "them", "they", "there", "then", "now", "also", "just",
  "please", "can", "cant", "could", "should", "would", "will", "wont",
  "do", "does", "dont", "did", "want", "like", "need", "one", "same",
  "all", "any", "some", "instead", "change", "changes", "changed",
  "not", "no", "yes", "ok", "okay", "too", "very", "more", "less",
]);
const MAX_LABEL_CHARS = 24;

/** Compress a session title to its two most significant leading words (the
 *  key's top line marquees when wide, so width only vetoes absurd pairs).
 *  Falls back to the raw words when everything was a stopword. */
export function labelFromTitle(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const strip = (w: string) => w.replace(/[^\p{L}\p{N}-]/gu, "");
  const significant = words.filter((w) => {
    const s = strip(w).toLowerCase();
    return s.length > 1 && !STOPWORDS.has(s);
  });
  const pool = (significant.length > 0 ? significant : words).map(strip).filter(Boolean);
  if (pool.length === 0) return "";
  const pair = pool.slice(0, 2).join(" ");
  return pair.length > MAX_LABEL_CHARS ? pool[0] : pair;
}
