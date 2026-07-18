import type {
  McpLibraryEntry,
  ProfileDetail,
  TargetActivationPreview,
  TargetDescriptor,
  TargetPaths
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
  allowMatchingUnmanagedSkills?: boolean;
  allowMatchingUnmanagedAssets?: boolean;
  replaceableManagedPaths?: ReadonlySet<string>;
  isolateSkillRoot?: boolean;
}

export interface TargetPreviewInput extends TargetAssetInput {
  state: {
    managedConfigKeys: string[];
    managedMcpNames: string[];
  };
  allowMatchingUnmanagedConfig?: boolean;
}

export interface CapturedTargetProfile {
  instructions: string;
  configText: string;
  mcpServers: McpLibraryEntry[];
  disabledSkillPaths: string[];
  warnings: string[];
  excluded: string[];
}

export interface AgentTargetAdapter {
  descriptor: TargetDescriptor;
  createTargetPaths(input: TargetPathInput): TargetPaths;
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  captureProfile(targetPaths: TargetPaths): Promise<CapturedTargetProfile>;
  readProfileFiles(profileDir: string, manifest: ProfileDetail["manifest"]): Promise<ProfileDetail>;
  writeProfileFiles(profileDir: string, profile: ProfileDetail): Promise<void>;
  materializeMcpRefs(
    profile: ProfileDetail,
    mcpLibrary: McpLibraryEntry[]
  ): ProfileDetail;
  createPreview(input: TargetPreviewInput): Promise<TargetActivationPreview>;
  validateAssets(input: TargetAssetInput): Promise<string[]>;
  getAssetBackupPaths(input: TargetAssetInput): Promise<string[]>;
  applyAssets(input: TargetAssetInput): Promise<void>;
}
