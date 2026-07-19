import type {
  ProfileDetail,
  SkillRuntimeNativeState,
  SkillRuntimeSnapshot,
  TargetDescriptor,
  TargetPaths
} from "../../shared/types";
import type {
  AgentTargetAdapter,
  CapturedTargetProfile,
  TargetAssetInput,
  TargetInstallationInput,
  TargetInstallationResult,
  TargetPathInput,
  TargetPreviewInput
} from "./types";

export interface TargetDiscoveryDriver {
  detectInstallation(input: TargetInstallationInput): Promise<TargetInstallationResult>;
}

export interface TargetPathDriver {
  createTargetPaths(input: TargetPathInput): ReturnType<AgentTargetAdapter["createTargetPaths"]>;
}

export interface TargetProfileDriver {
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  captureProfile(
    targetPaths: ReturnType<AgentTargetAdapter["createTargetPaths"]>
  ): Promise<CapturedTargetProfile>;
  readProfileFiles(
    profileDir: string,
    manifest: ProfileDetail["manifest"]
  ): Promise<ProfileDetail>;
  writeProfileFiles(profileDir: string, profile: ProfileDetail): Promise<void>;
}

export interface TargetConfigDriver {
  hasMeaningfulNativeConfig(configText: string): boolean;
  createPreview(input: TargetPreviewInput): ReturnType<AgentTargetAdapter["createPreview"]>;
}

export interface TargetMcpDriver {
  materializeMcpRefs(
    profile: ProfileDetail,
    mcpLibrary: Parameters<AgentTargetAdapter["materializeMcpRefs"]>[1]
  ): ProfileDetail;
}

/** Read-only facts about how an Agent discovers and identifies Skills. */
export interface TargetSkillDriver {
  readNativeState(targetPaths: TargetPaths): Promise<SkillRuntimeNativeState>;
  inspectRuntime(targetPaths: TargetPaths): Promise<SkillRuntimeSnapshot>;
}

export interface TargetAssetDriver {
  validateAssets(input: TargetAssetInput): ReturnType<AgentTargetAdapter["validateAssets"]>;
  getAssetBackupPaths(
    input: TargetAssetInput
  ): ReturnType<AgentTargetAdapter["getAssetBackupPaths"]>;
  applyAssets(input: TargetAssetInput): ReturnType<AgentTargetAdapter["applyAssets"]>;
}

/**
 * The extension contract for a supported local agent.
 *
 * Drivers separate target-specific knowledge by responsibility while the flat
 * AgentTargetAdapter remains the stable facade used by existing services.
 */
export interface AgentTargetIntegration {
  descriptor: TargetDescriptor;
  discovery: TargetDiscoveryDriver;
  paths: TargetPathDriver;
  profile: TargetProfileDriver;
  config: TargetConfigDriver;
  mcp: TargetMcpDriver;
  skills: TargetSkillDriver;
  assets: TargetAssetDriver;
}
