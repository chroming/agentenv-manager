import type { TargetDescriptor } from "../../shared/types";
import { createBuiltInTargetAdapters } from "./integrations";
import type { AgentTargetAdapter } from "./types";

export interface TargetRegistry {
  list(): TargetDescriptor[];
  listAdapters(): AgentTargetAdapter[];
  get(targetId: string): AgentTargetAdapter;
}

export const createTargetRegistry = (
  adapters: AgentTargetAdapter[] = createBuiltInTargetAdapters()
): TargetRegistry => {
  const registeredAdapters = [...adapters];
  const byId = new Map<string, AgentTargetAdapter>();
  for (const adapter of registeredAdapters) {
    const targetId = adapter.descriptor.id;
    if (byId.has(targetId)) {
      throw new Error(`Duplicate target id: ${targetId}`);
    }
    byId.set(targetId, adapter);
  }

  return {
    list: () => registeredAdapters.map((adapter) => adapter.descriptor),
    listAdapters: () => [...registeredAdapters],
    get: (targetId) => {
      const adapter = byId.get(targetId);
      if (!adapter) {
        throw new Error(`Unknown target: ${targetId}`);
      }
      return adapter;
    }
  };
};
