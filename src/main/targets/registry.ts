import type { TargetDescriptor } from "../../shared/types";
import { createClaudeCodeTargetAdapter } from "./claudeCodeTarget";
import { createCodexTargetAdapter } from "./codexTarget";
import { createOpenCodeTargetAdapter } from "./opencodeTarget";
import type { AgentTargetAdapter } from "./types";

export interface TargetRegistry {
  list(): TargetDescriptor[];
  listAdapters(): AgentTargetAdapter[];
  get(targetId: string): AgentTargetAdapter;
}

export const createTargetRegistry = (
  adapters: AgentTargetAdapter[] = [
    createOpenCodeTargetAdapter(),
    createClaudeCodeTargetAdapter(),
    createCodexTargetAdapter()
  ]
): TargetRegistry => {
  const byId = new Map(adapters.map((adapter) => [adapter.descriptor.id, adapter]));

  return {
    list: () => adapters.map((adapter) => adapter.descriptor),
    listAdapters: () => adapters,
    get: (targetId) => {
      const adapter = byId.get(targetId);
      if (!adapter) {
        throw new Error(`Unknown target: ${targetId}`);
      }
      return adapter;
    }
  };
};
