import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ProviderId } from "./provider-types.js";

/**
 * Which CLIs count as agents, and which one's tiles go untagged.
 *
 * A name list is irreducible. Nothing at the OS level separates "an LLM CLI"
 * from `vim` — both are interactive programs holding a terminal — so a deck that
 * discovered agents by shape alone would tile every editor and pager you open.
 * What IS avoidable is the list living in code: adding an agent belongs in
 * `~/.claude/streamdeck-agents.json` plus a `pnpm sd:reload`, never a code edit
 * and a release.
 *
 * The rule that keeps this honest: **nothing under `src/` may branch on a member
 * of this list.** Provider ids flow through as opaque strings. If you find
 * yourself writing `provider === "codex"`, either it is a genuinely mechanical
 * difference that belongs in that provider's adapter, or it is a preference that
 * belongs in this file.
 *
 * Node builtins only (same rule as naming-policy.ts) so `process-scan.ts` stays
 * importable under `tsx --test`. That is also why the path lives here and not in
 * `env.ts`: env.ts asserts its build-time sentinels at module load and throws
 * under tsx, which would take every importer's tests down with it. Same reason
 * `launch-tty.ts` computes its own dir. `homedir()` needs no platform branch —
 * it is the home of whoever runs the PLUGIN on every host, which is the right
 * home for a file that configures the reader rather than the agents read.
 */

/** Where the agent list lives. Symlink it from dotfiles to have it follow the
 *  machine; absent is normal and means DEFAULT_AGENT_CONFIG. */
export const AGENTS_CONFIG_FILE = join(homedir(), ".claude", "streamdeck-agents.json");
export interface AgentConfig {
  /** provider id → binary names `ps` may report for it, matched on basename. */
  agents: Readonly<Record<ProviderId, readonly string[]>>;
  /**
   * The one provider whose tiles carry NO agent tag.
   *
   * A display preference, not a mechanism: Ehsan's call (2026-08-17) that the
   * tag marks the EXCEPTION, because `claude` written across almost every tile
   * is noise on a 72px key. It defaults to `claude` because that is this deck's
   * overwhelming majority — set it to `""` to tag every provider evenly, or to
   * another id if the majority ever changes.
   */
  untaggedAgent: ProviderId;
}

/** Ships the behaviour this deck had before the config existed, so a machine
 *  with no config file is not a machine with no agents. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  agents: { claude: ["claude", "claude.exe"], codex: ["codex"] },
  untaggedAgent: "claude",
};

/** Last config read problem, surfaced in the tick log rather than thrown: a
 *  typo in the config must not take the whole deck down. */
export let lastAgentConfigError: string | undefined;

interface Cached {
  mtimeMs: number;
  size: number;
  value: AgentConfig;
}
let cached: Cached | undefined;

/** Keeps a hand-written config honest without letting it break the deck: bad
 *  entries are dropped, a bad file falls back whole. */
export function parseAgentConfig(json: string): { config: AgentConfig; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { config: DEFAULT_AGENT_CONFIG, error: `not valid JSON: ${err instanceof Error ? err.message : err}` };
  }
  if (typeof raw !== "object" || raw === null) return { config: DEFAULT_AGENT_CONFIG, error: "not an object" };
  const record = raw as Record<string, unknown>;
  const agents: Record<ProviderId, readonly string[]> = {};
  const dropped: string[] = [];
  const declared = record.agents;
  if (typeof declared === "object" && declared !== null) {
    for (const [id, binaries] of Object.entries(declared as Record<string, unknown>)) {
      const names = Array.isArray(binaries)
        ? binaries.filter((b): b is string => typeof b === "string" && b.trim() !== "")
        : [];
      // An agent with no binary name can never match a process, so it is a typo
      // rather than a preference. Default the list to the id itself, which is
      // what `{"gemini": []}` almost certainly meant.
      if (id.trim() === "") dropped.push(JSON.stringify(id));
      else agents[id] = names.length > 0 ? names : [id];
    }
  }
  if (Object.keys(agents).length === 0) {
    return { config: DEFAULT_AGENT_CONFIG, error: "no usable agents declared" };
  }
  const untagged = record.untaggedAgent;
  return {
    config: {
      agents,
      untaggedAgent: typeof untagged === "string" ? untagged : DEFAULT_AGENT_CONFIG.untaggedAgent,
    },
    error: dropped.length > 0 ? `ignored agent keys: ${dropped.join(", ")}` : undefined,
  };
}

/** Config as of now, re-read only when the file changes. */
export async function loadAgentConfig(): Promise<AgentConfig> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(AGENTS_CONFIG_FILE);
  } catch {
    // No file is the normal case, not an error.
    lastAgentConfigError = undefined;
    cached = undefined;
    return DEFAULT_AGENT_CONFIG;
  }
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.value;
  try {
    const { config, error } = parseAgentConfig(await readFile(AGENTS_CONFIG_FILE, "utf8"));
    lastAgentConfigError = error;
    cached = { mtimeMs: st.mtimeMs, size: st.size, value: config };
    return config;
  } catch (err) {
    lastAgentConfigError = `unreadable: ${err instanceof Error ? err.message : err}`;
    return DEFAULT_AGENT_CONFIG;
  }
}

/** binary basename → provider id, for judging a `ps` line. */
export function binaryIndex(config: AgentConfig): Map<string, ProviderId> {
  const index = new Map<string, ProviderId>();
  for (const [id, binaries] of Object.entries(config.agents)) {
    for (const binary of binaries) index.set(basename(binary), id);
  }
  return index;
}

/** Does `comm` belong to this provider? The kill path's identity guard.
 *
 *  Exact basename, or the declared name plus a platform suffix — npm ships
 *  per-arch binaries as `codex-darwin-arm64`, and a rule about npm's packaging
 *  convention is general where `comm.includes("codex")` was not: `includes`
 *  would have matched anything with the word in it, while the suffix rule still
 *  rejects `claudia` for `claude`. */
export function binaryBelongsTo(comm: string, provider: ProviderId, config: AgentConfig): boolean {
  const name = basename(comm);
  return (config.agents[provider] ?? []).some((binary) => {
    const declared = basename(binary);
    return name === declared || name.startsWith(`${declared}-`);
  });
}

/** The tile's bottom-line agent tag, or undefined for the untagged provider. */
export function providerTag(provider: ProviderId, config: AgentConfig): string | undefined {
  return provider === config.untaggedAgent ? undefined : provider;
}
