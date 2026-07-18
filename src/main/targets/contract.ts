import type { ProfileDetail, TargetDescriptor } from "../../shared/types";
import type {
  AgentTargetAdapter,
  CapturedTargetProfile,
  TargetAssetInput,
  TargetPathInput,
  TargetPreviewInput
} from "./types";

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
  createPreview(input: TargetPreviewInput): ReturnType<AgentTargetAdapter["createPreview"]>;
}

export interface TargetMcpDriver {
  materializeMcpRefs(
    profile: ProfileDetail,
    mcpLibrary: Parameters<AgentTargetAdapter["materializeMcpRefs"]>[1]
  ): ProfileDetail;
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
  paths: TargetPathDriver;
  profile: TargetProfileDriver;
  config: TargetConfigDriver;
  mcp: TargetMcpDriver;
  assets: TargetAssetDriver;
}
