import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isNamingPrompt, MAX_NAMING_PROMPTS } from "./naming-policy.js";

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

/** The first `max` human prompts in a transcript-head chunk (isNamingPrompt).
 *  Filters the head's metadata entries (last-prompt/mode/attachment/...),
 *  isMeta user payloads (skill/command text), tool_result-only content arrays,
 *  command wrappers ("<command-name>...", "<system-reminder>..."), slash
 *  commands and trivial openers. Each clipped to 200 chars for parity with the
 *  hook's UserPromptSubmit clip. */
export function extractUserPrompts(text: string, max = MAX_NAMING_PROMPTS): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (out.length >= max) break;
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
    if (isNamingPrompt(promptText)) out.push(promptText.trim().slice(0, 200));
  }
  return out;
}

/** The conversation's original prompts, mined from the transcript head.
 *  Fallback naming context for RESUMED sessions: SessionStart truncates the
 *  events log, so a session driven only by trivial openers ("continue")
 *  after a resume never re-earns prompts from events — but the transcript
 *  still holds what it was originally asked. A full set is permanent per path
 *  (immutable history); a partial one is re-read only when the file changes. */
const promptCache = new Map<string, { size: number; mtimeMs: number; prompts: string[] }>();

export async function readUserPrompts(path: string): Promise<string[]> {
  if (!path) return [];
  let size: number, mtimeMs: number;
  const cached = promptCache.get(path);
  if (cached && cached.prompts.length >= MAX_NAMING_PROMPTS) return cached.prompts;
  try {
    const st = await stat(path);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return [];
  }
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.prompts;

  let prompts: string[] = [];
  try {
    const fh = await open(path, "r");
    try {
      const head = new Uint8Array(Math.min(CHUNK, size));
      await fh.read(head, 0, head.length, 0);
      prompts = extractUserPrompts(Buffer.from(head).toString("utf8"));
    } finally {
      await fh.close();
    }
  } catch {
    return [];
  }
  promptCache.set(path, { size, mtimeMs, prompts });
  return prompts;
}

