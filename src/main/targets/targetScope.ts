import type { TargetDescriptor } from "../../shared/types";
import type { SettingsStore } from "../settingsStore";
import type { TargetRegistry } from "./registry";
import type { AgentTargetAdapter } from "./types";

export interface TargetScope {
  listSupported(): TargetDescriptor[];
  listEnabledIds(): Promise<string[]>;
  listEnabledAdapters(): Promise<AgentTargetAdapter[]>;
  isEnabled(targetId: string): Promise<boolean>;
  assertEnabled(targetId: string): Promise<void>;
}

export const createTargetScope = (
  targetRegistry: TargetRegistry,
  settingsStore: SettingsStore
): TargetScope => {
  const listSupported = () => targetRegistry.list();

  const listEnabledIds = async () => {
    const supportedIds = new Set(listSupported().map((target) => target.id));
    const configuredIds = (await settingsStore.readSettings()).enabledTargetIds;
    return (configuredIds ?? [...supportedIds]).filter((targetId) => supportedIds.has(targetId));
  };

  const listEnabledAdapters = async () => {
    const enabledIds = new Set(await listEnabledIds());
    return targetRegistry.listAdapters().filter((adapter) => enabledIds.has(adapter.descriptor.id));
  };

  const isEnabled = async (targetId: string) => (await listEnabledIds()).includes(targetId);

  const assertEnabled = async (targetId: string) => {
    const target = targetRegistry.get(targetId);
    if (!(await isEnabled(targetId))) {
      throw new Error(`${target.descriptor.name} is turned off in Settings`);
    }
  };

  return {
    listSupported,
    listEnabledIds,
    listEnabledAdapters,
    isEnabled,
    assertEnabled
  };
};
