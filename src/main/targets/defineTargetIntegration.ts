import type { TargetDescriptor, TargetPaths } from "../../shared/types";
import type { AgentTargetIntegration } from "./contract";
import type { AgentTargetAdapter } from "./types";

const TARGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const validateDescriptor = (descriptor: TargetDescriptor): void => {
  if (!TARGET_ID_PATTERN.test(descriptor.id)) {
    throw new Error(
      `Invalid target id: ${descriptor.id}. Use lowercase letters, numbers, and hyphens.`
    );
  }
  if (!descriptor.name.trim()) {
    throw new Error(`Target ${descriptor.id} must have a name.`);
  }
  if (!descriptor.executableName?.trim()) {
    throw new Error(`Target ${descriptor.id} must declare an executable name.`);
  }
};

const validatePaths = (descriptor: TargetDescriptor, paths: TargetPaths): TargetPaths => {
  if (paths.targetId !== descriptor.id) {
    throw new Error(
      `Target ${descriptor.id} returned paths for ${paths.targetId || "an empty target id"}.`
    );
  }
  if (!paths.configDir || !paths.instructionsPath || !paths.configPath) {
    throw new Error(`Target ${descriptor.id} returned incomplete required paths.`);
  }
  return paths;
};

export const defineTargetIntegration = (
  integration: AgentTargetIntegration
): AgentTargetAdapter => {
  validateDescriptor(integration.descriptor);

  return {
    descriptor: integration.descriptor,
    createTargetPaths: (input) =>
      validatePaths(integration.descriptor, integration.paths.createTargetPaths(input)),
    createDefaultProfile: (id) => integration.profile.createDefaultProfile(id),
    captureProfile: (targetPaths) => integration.profile.captureProfile(targetPaths),
    readProfileFiles: (profileDir, manifest) =>
      integration.profile.readProfileFiles(profileDir, manifest),
    writeProfileFiles: (profileDir, profile) =>
      integration.profile.writeProfileFiles(profileDir, profile),
    materializeMcpRefs: (profile, mcpLibrary) =>
      integration.mcp.materializeMcpRefs(profile, mcpLibrary),
    createPreview: (input) => integration.config.createPreview(input),
    validateAssets: (input) => integration.assets.validateAssets(input),
    getAssetBackupPaths: (input) => integration.assets.getAssetBackupPaths(input),
    applyAssets: (input) => integration.assets.applyAssets(input)
  };
};
