import type { TargetRegistry } from "./registry";

const LEGACY_DEFAULT_TARGET_ID = "codex";
const LEGACY_NATIVE_CONFIG_ALIASES = [
  "opencode.json",
  "mcp.toml",
  "claude-code.json"
];

export interface LegacyProfileMigrationCatalog {
  resolveTargetId(targetId?: string): string;
  instructionFileFor(targetId: string): string;
  mcpActivationTargetIds: string[];
  nativeConfigFiles: string[];
}

export const createLegacyProfileMigrationCatalog = (
  registry: TargetRegistry
): LegacyProfileMigrationCatalog => {
  const defaultTargetId = registry.get(LEGACY_DEFAULT_TARGET_ID).descriptor.id;
  const adapters = registry.listAdapters();

  return {
    resolveTargetId: (targetId) =>
      registry.get(targetId ?? defaultTargetId).descriptor.id,
    instructionFileFor: (targetId) =>
      registry.get(targetId).descriptor.instructionsLabel,
    mcpActivationTargetIds: adapters
      .filter((adapter) => adapter.descriptor.capabilities.mcpActivation)
      .map((adapter) => adapter.descriptor.id),
    nativeConfigFiles: [
      ...new Set(
        adapters
          .map((adapter) => adapter.descriptor.configLabel)
          .concat(LEGACY_NATIVE_CONFIG_ALIASES)
      )
    ]
  };
};
