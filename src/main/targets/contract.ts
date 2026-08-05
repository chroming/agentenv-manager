import type {
  ProfileDetail,
  SkillRuntimeNativeState,
  SkillRuntimeSnapshot,
  TargetDescriptor,
  TargetPaths
} from "../../shared/types";
import type {
  AgentConversationCapability,
  AgentEvaluationCapability,
  AgentProjectCapability,
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
}

export interface TargetPreviewDriver {
  createPreview(input: TargetPreviewInput): ReturnType<AgentTargetAdapter["createPreview"]>;
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
  preview: TargetPreviewDriver;
  skills: TargetSkillDriver;
  projects?: AgentProjectCapability;
  conversations?: AgentConversationCapability;
  evaluations?: AgentEvaluationCapability;
  assets: TargetAssetDriver;
}
