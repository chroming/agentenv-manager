export interface ProfileSummary {
  id: string;
  targetId: string;
  name: string;
  description: string;
}

export type { AssetPolicy, ProfileManifest } from "./schemas";
import type { AssetPolicy, ProfileManifest } from "./schemas";

export interface AgentEnvApi {
  listTargets(): Promise<TargetDescriptor[]>;
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  createProfile(targetId: string): Promise<ProfileDetail>;
  previewApply(profileId: string): Promise<ActivationPreview>;
  applyProfile(profileId: string, previewId: string): Promise<ApplyResult>;
  listBackups(): Promise<BackupSummary[]>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
}

export interface TargetDescriptor {
  id: string;
  name: string;
  description: string;
  instructionsLabel: string;
  configLabel: string;
  configLanguage: "jsonc" | "toml" | "text";
  realWritesEnabled: boolean;
}

export interface TargetPaths {
  targetId: string;
  configDir: string;
  instructionsPath: string;
  instructionsOverridePath?: string;
  configPath: string;
  agentsDir?: string;
  skillsDir?: string;
}

export interface TargetState {
  managedConfigKeys: string[];
  managedMcpNames: string[];
}

export interface TargetActivationPreview {
  changes: PlannedFileChange[];
  warnings: string[];
  errors: string[];
  liveFingerprints: Record<string, string>;
  targetState: TargetState;
}

export interface ProfileDetail {
  id: string;
  profileDir?: string;
  manifest: ProfileManifest;
  instructions: string;
  configText: string;
  assetPolicy: AssetPolicy;
}

export interface SaveProfileInput {
  manifest: ProfileManifest;
  instructions: string;
  configText: string;
  assetPolicy: AssetPolicy;
}

export interface PlannedFileChange {
  path: string;
  before: string;
  after: string;
  diff: string;
}

export interface ActivationPreview {
  id: string;
  profileId: string;
  createdAt: string;
  warnings: string[];
  errors: string[];
  changes: PlannedFileChange[];
  liveFingerprints: Record<string, string>;
  targetId: string;
  targetState: TargetState;
}

export interface BackupEntry {
  sourcePath: string;
  backupPath?: string;
  sha256?: string;
  missing: boolean;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  entries: BackupEntry[];
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  fileCount: number;
}

export type ApplyResult =
  | { ok: true; backupId: string }
  | { ok: false; errors: string[] };

export interface RollbackPreview {
  id: string;
  backupId: string;
  createdAt: string;
  warnings: string[];
  errors: string[];
  changes: PlannedFileChange[];
}

export type RollbackResult = { ok: true } | { ok: false; errors: string[] };
