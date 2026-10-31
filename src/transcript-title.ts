import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isNamingPrompt,
  MAX_NAMING_PROMPTS,
  NAMING_FIRST_PROMPT_CHARS,
  NAMING_LATER_PROMPT_CHARS,
  NAMING_REPLY_CHARS,
  type NamingContext,
} from "./naming-policy.js";

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

/** The text of a transcript entry: a plain string body, or its `text`
 *  blocks joined (tool_result / tool_use / thinking blocks carry none). */
function entryText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
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

type MinedContext = NamingContext & { prompts: string[] };

/** Line-by-line accumulator for one transcript: the first `max` human
 *  prompts (isNamingPrompt — filters the head's metadata entries, isMeta
 *  user payloads, tool_result-only arrays, command wrappers, slash commands
 *  and trivial openers), the assistant's first text reply after the first
 *  prompt, and that prompt's timestamp. The first prompt is kept to
 *  NAMING_FIRST_PROMPT_CHARS (the hook's 200-char events are the "a prompt
 *  exists" signal, not the namer's text), later ones to
 *  NAMING_LATER_PROMPT_CHARS, the reply to NAMING_REPLY_CHARS. */
function namingScanner(max: number): { ctx: MinedContext; done: () => boolean; feed: (line: string) => void } {
  const ctx: MinedContext = { prompts: [], reply: "", firstPromptAt: 0 };
  const done = (): boolean => ctx.prompts.length >= max && ctx.reply !== "";
  const feed = (line: string): void => {
    if (done()) return;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return; // partial line at a chunk edge, or junk
    }
    const e = entry as { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: unknown } };
    if (e.isMeta === true) return;
    if (e.type === "user") {
      if (ctx.prompts.length >= max) return;
      const promptText = entryText(e.message?.content);
      if (!isNamingPrompt(promptText)) return;
      ctx.prompts.push(promptText.trim().slice(0, ctx.prompts.length === 0 ? NAMING_FIRST_PROMPT_CHARS : NAMING_LATER_PROMPT_CHARS));
      if (ctx.prompts.length === 1) ctx.firstPromptAt = Date.parse(e.timestamp ?? "") || 0;
    } else if (e.type === "assistant" && ctx.prompts.length > 0 && !ctx.reply) {
      const replyText = entryText(e.message?.content).trim();
      if (replyText) ctx.reply = replyText.slice(0, NAMING_REPLY_CHARS);
    }
  };
  return { ctx, done, feed };
}

/** Naming context from transcript text (tests, and small files). */
export function extractNamingContext(text: string, max = MAX_NAMING_PROMPTS): MinedContext {
  const scanner = namingScanner(max);
  for (const line of text.split("\n")) {
    if (scanner.done()) break;
    scanner.feed(line);
  }
  return scanner.ctx;
}

/** Per-transcript scan position. The transcript is append-only, so each
 *  read resumes at `offset` — the first reply sits 240–560 KB into every
 *  session here (the CLAUDE.md and memory attachments land between the
 *  prompt and the reply; measured 2026-10-31 over twelve transcripts), and a
 *  fixed head chunk never reached it. `carry` holds the partial last line
 *  until the next append completes it; a line longer than MAX_LINE_CHARS
 *  (a giant tool result) is skipped whole. */
interface TranscriptScan {
  scanner: ReturnType<typeof namingScanner>;
  offset: number;
  carry: string;
  skipping: boolean;
  size: number;
  mtimeMs: number;
  decoder: StringDecoder;
}
const scans = new Map<string, TranscriptScan>();
const PIECE_BYTES = 1 << 20;
const MAX_LINE_CHARS = 512 * 1024;
const EMPTY_CONTEXT: MinedContext = { prompts: [], reply: "", firstPromptAt: 0 };

function newScan(): TranscriptScan {
  return { scanner: namingScanner(MAX_NAMING_PROMPTS), offset: 0, carry: "", skipping: false, size: 0, mtimeMs: 0, decoder: new StringDecoder("utf8") };
}

/** The conversation's naming context, mined from the transcript. The
 *  namer's source of record: the hook's events hold only a 200-char clip
 *  of each prompt and no reply, and a RESUMED session's events log was
 *  truncated at SessionStart, so a session driven by trivial openers
 *  ("continue") after a resume still has what it was originally asked.
 *  Unchanged files (size + mtime) cost one stat; a grown file is read from
 *  where the last read stopped; a complete context (max prompts and a
 *  reply) is final. */
export async function readNamingContext(path: string): Promise<MinedContext> {
  if (!path) return EMPTY_CONTEXT;
  let scan = scans.get(path);
  if (scan && scan.scanner.done()) return scan.scanner.ctx;
  let size: number, mtimeMs: number;
  try {
    const st = await stat(path);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return scan?.scanner.ctx ?? EMPTY_CONTEXT;
  }
  if (scan && scan.size === size && scan.mtimeMs === mtimeMs) return scan.scanner.ctx;
  if (!scan || size < scan.offset) {
    scan = newScan(); // first sight, or a rewritten file: start over
    scans.set(path, scan);
  }
  scan.size = size;
  scan.mtimeMs = mtimeMs;
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return scan.scanner.ctx;
  }
  try {
    const buf = new Uint8Array(PIECE_BYTES);
    while (scan.offset < size && !scan.scanner.done()) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(PIECE_BYTES, size - scan.offset), scan.offset);
      if (bytesRead <= 0) break;
      scan.offset += bytesRead;
      const lines = (scan.carry + scan.decoder.write(Buffer.from(buf.subarray(0, bytesRead)))).split("\n");
      scan.carry = lines.pop() ?? "";
      for (const line of lines) {
        if (scan.skipping) {
          scan.skipping = false; // the tail of a line too long to keep
          continue;
        }
        scan.scanner.feed(line);
        if (scan.scanner.done()) break;
      }
      if (scan.carry.length > MAX_LINE_CHARS) {
        scan.carry = "";
        scan.skipping = true;
      }
    }
  } catch {
    // a read error mid-file: keep what was mined, retry on the next change
  } finally {
    await fh.close();
  }
  return scan.scanner.ctx;
}
