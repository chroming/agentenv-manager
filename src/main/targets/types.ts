import type {
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
}

export interface TargetPreviewInput extends TargetAssetInput {
  state: {
    managedConfigKeys: string[];
    managedMcpNames: string[];
  };
}

export interface AgentTargetAdapter {
  descriptor: TargetDescriptor;
  createTargetPaths(input: TargetPathInput): TargetPaths;
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  readProfileFiles(profileDir: string, manifest: ProfileDetail["manifest"]): Promise<ProfileDetail>;
  writeProfileFiles(profileDir: string, profile: ProfileDetail): Promise<void>;
  createPreview(input: TargetPreviewInput): Promise<TargetActivationPreview>;
  validateAssets(input: TargetAssetInput): Promise<string[]>;
  applyAssets(input: TargetAssetInput): Promise<void>;
}
