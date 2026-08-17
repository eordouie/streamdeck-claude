import type { AgentProvider, ProviderId } from "./provider-types.js";

export class ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderId, AgentProvider>;

  constructor(adapters: readonly AgentProvider[]) {
    const providers = new Map<ProviderId, AgentProvider>();
    for (const adapter of adapters) {
      if (providers.has(adapter.id)) {
        throw new Error(`duplicate provider id: ${adapter.id}`);
      }
      providers.set(adapter.id, adapter);
    }
    this.providers = providers;
  }

  get(id: ProviderId): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`unknown provider id: ${id}`);
    return provider;
  }

  ids(): readonly ProviderId[] {
    return [...this.providers.keys()];
  }
}
