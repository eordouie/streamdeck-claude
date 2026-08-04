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

/** First substantial HUMAN prompt in a transcript-head chunk. Filters the
 *  head's metadata entries (last-prompt/mode/attachment/...), isMeta user
 *  payloads (skill/command text), tool_result-only content arrays, command
 *  wrappers ("<command-name>...", "<system-reminder>..."), and trivial
 *  openers under the same ≥3-word bar the events reducer uses. Clipped to
 *  200 chars for parity with the hook's UserPromptSubmit clip. */
export function extractFirstUserPrompt(text: string): string {
  for (const line of text.split("\n")) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // partial line at the chunk edge, or junk
    }
    const e = entry as { type?: string; isMeta?: boolean; message?: { content?: unknown } };
    if (e.type !== "user" || e.isMeta === true) continue;
    const content = e.message?.content;
    let promptText = "";
    if (typeof content === "string") {
      promptText = content;
    } else if (Array.isArray(content)) {
      promptText = content
        .filter(
          (b): b is { type: string; text: string } =>
            typeof b === "object" &&
            b !== null &&
            (b as { type?: unknown }).type === "text" &&
            typeof (b as { text?: unknown }).text === "string",
        )
        .map((b) => b.text)
        .join(" ");
    }
    const prompt = promptText.trim();
    if (!prompt || prompt.startsWith("<")) continue;
    if (prompt.split(/\s+/).length < 3) continue;
    return prompt.slice(0, 200);
  }
  return "";
}

/** The conversation's original first prompt, mined from the transcript head.
 *  Fallback naming context for RESUMED sessions: SessionStart truncates the
 *  events log, so a session driven only by trivial openers ("continue")
 *  after a resume never re-earns a firstPrompt from events — but the
 *  transcript still holds the one it was originally asked. Positive results
 *  are permanent per path (the first prompt is immutable history); misses
 *  are re-checked only when the file changes. */
const firstPromptCache = new Map<string, string>();
const firstPromptMiss = new Map<string, { size: number; mtimeMs: number }>();

export async function readFirstUserPrompt(path: string): Promise<string> {
  if (!path) return "";
  const known = firstPromptCache.get(path);
  if (known !== undefined) return known;
  let size: number, mtimeMs: number;
  try {
    const st = await stat(path);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return "";
  }
  const miss = firstPromptMiss.get(path);
  if (miss && miss.size === size && miss.mtimeMs === mtimeMs) return "";

  let prompt = "";
  try {
    const fh = await open(path, "r");
    try {
      const head = new Uint8Array(Math.min(CHUNK, size));
      await fh.read(head, 0, head.length, 0);
      prompt = extractFirstUserPrompt(Buffer.from(head).toString("utf8"));
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
  if (prompt) firstPromptCache.set(path, prompt);
  else firstPromptMiss.set(path, { size, mtimeMs });
  return prompt;
}

