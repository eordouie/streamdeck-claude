import type { AgentProvider } from "../provider-types.js";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";

export function createBuiltinProviders(): AgentProvider[] {
  return [claudeProvider, codexProvider];
}
