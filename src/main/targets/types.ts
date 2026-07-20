import type {
  NativeMcpConnection,
  ProfileDetail,
  TargetActivationPreview,
  TargetDescriptor,
  TargetInstallationEvidence,
  TargetPaths,
  SkillRuntimeNativeState,
  SkillRuntimeSnapshot
} from "../../shared/types";

export interface TargetPathInput {
  homeDir: string;
  fakeHomeRoot?: string;
}

export interface TargetAssetInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  skillLibraryDir?: string;
  skillSyncMethod?: "symlink" | "copy" | "auto";
  approvedUnmanagedSkillHashes?: ReadonlyMap<string, string>;
  replaceablePaths?: ReadonlySet<string>;
  isolateSkillRoot?: boolean;
}

export interface TargetPreviewInput extends TargetAssetInput {
  state: {
    managedMcpNames: string[];
  };
}

export interface CapturedTargetProfile {
  instructions: string;
  mcpConnections?: NativeMcpConnection[];
  warnings: string[];
  excluded: string[];
}

export interface TargetInstallationInput {
  platform: NodeJS.Platform;
  homeDir: string;
  allowSystemApplicationLookup: boolean;
  findExecutable(name: string): Promise<string | undefined>;
  pathExists(path: string): Promise<boolean>;
}

export interface TargetInstallationResult {
  found: boolean;
  evidence: TargetInstallationEvidence[];
}

export interface AgentTargetAdapter {
  descriptor: TargetDescriptor;
  detectInstallation(input: TargetInstallationInput): Promise<TargetInstallationResult>;
  createTargetPaths(input: TargetPathInput): TargetPaths;
  skills: {
    readNativeState(targetPaths: TargetPaths): Promise<SkillRuntimeNativeState>;
    inspectRuntime(targetPaths: TargetPaths): Promise<SkillRuntimeSnapshot>;
  };
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  captureProfile(targetPaths: TargetPaths): Promise<CapturedTargetProfile>;
  createPreview(input: TargetPreviewInput): Promise<TargetActivationPreview>;
  validateAssets(input: TargetAssetInput): Promise<string[]>;
  getAssetBackupPaths(input: TargetAssetInput): Promise<string[]>;
  applyAssets(input: TargetAssetInput): Promise<void>;
}
