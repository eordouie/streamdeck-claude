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
      const tail = new Uint8Array(Math.min(CHUNK, size));
      await fh.read(tail, 0, tail.length, Math.max(0, size - tail.length));
      let text = Buffer.from(tail).toString("utf8");
      title = lastJsonString(text, "customTitle") || lastJsonString(text, "aiTitle");
      if (!title && size > CHUNK) {
        const head = new Uint8Array(CHUNK);
        await fh.read(head, 0, head.length, 0);
        text = Buffer.from(head).toString("utf8");
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

