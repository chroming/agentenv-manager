export interface ProfileSummary {
  id: string;
  targetId: string;
  name: string;
  description: string;
}

export type { AssetPolicy, ProfileManifest } from "./schemas";
import type { AssetPolicy, ProfileManifest } from "./schemas";

export interface AgentEnvApi {
  listTargets(): Promise<TargetInfo[]>;
  listSkillLibrary(): Promise<SkillLibraryEntry[]>;
  listMcpLibrary(): Promise<McpLibraryEntry[]>;
  saveMcpServer(input: SaveMcpServerInput): Promise<McpLibraryEntry>;
  removeMcpServer(id: string): Promise<void>;
  scanUnmanagedSkills(): Promise<UnmanagedSkillEntry[]>;
  importSkillToLibrary(sourcePath: string): Promise<SkillLibraryEntry>;
  importGitHubSkillToLibrary(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  checkSkillLibraryUpdates(): Promise<SkillUpdateInfo[]>;
  updateLibrarySkill(id: string): Promise<SkillLibraryEntry>;
  readSettings(): Promise<AgentEnvSettings>;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings>;
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

export interface SkillLibraryEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  sourceType: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remoteRevision?: string;
  contentHash: string;
  updatedAt: string;
}

export interface GitHubSkillImportInput {
  url: string;
  id?: string;
}

export interface SkillUpdateInfo {
  id: string;
  name: string;
  sourceType: SkillSourceType;
  currentRevision?: string;
  latestRevision?: string;
  updateAvailable: boolean;
  error?: string;
}

export interface UnmanagedSkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  foundIn: string[];
}

export type SkillSourceType = "local" | "github" | "zip";
export type SkillSyncMethod = "symlink" | "copy" | "auto";
export type SkillStorageLocation = "appData" | "agents";

export type McpTransport = "stdio" | "http" | "sse";

export interface McpLibraryEntry {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface SaveMcpServerInput {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface AgentEnvSettings {
  skillSyncMethod: SkillSyncMethod;
  skillStorageLocation: SkillStorageLocation;
}

export interface TargetDescriptor {
  id: string;
  name: string;
  description: string;
  instructionsLabel: string;
  configLabel: string;
  configLanguage: "jsonc" | "toml" | "text";
  realWritesEnabled: boolean;
  executableName?: string;
}

export interface TargetPaths {
  targetId: string;
  configDir: string;
  instructionsPath: string;
  instructionsOverridePath?: string;
  configPath: string;
  mcpConfigPath?: string;
  agentsDir?: string;
  skillsDir?: string;
}

export interface TargetState {
  managedConfigKeys: string[];
  managedMcpNames: string[];
}

export type TargetHealthStatus = "ready" | "needs-setup" | "missing" | "guarded";

export interface TargetPathCheck {
  id:
    | "configDir"
    | "instructions"
    | "config"
    | "mcpConfig"
    | "agentsDir"
    | "skillsDir";
  label: string;
  path: string;
  exists: boolean;
  writable: boolean;
  required: boolean;
}

export interface TargetHealth {
  status: TargetHealthStatus;
  executableName?: string;
  executablePath?: string;
  executableFound: boolean;
  canWrite: boolean;
  summary: string;
  checks: TargetPathCheck[];
}

export interface TargetInfo extends TargetDescriptor {
  paths: TargetPaths;
  health: TargetHealth;
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
  kind?: "file" | "directory";
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
