export interface ProfileSummary {
  id: string;
  name: string;
  description: string;
}

export type { ProfileManifest, SkillsPolicy } from "./schemas";
import type { ProfileManifest, SkillsPolicy } from "./schemas";

export interface AgentEnvApi {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  previewApply(profileId: string): Promise<ActivationPreview>;
  applyProfile(profileId: string, previewId: string): Promise<ApplyResult>;
  listBackups(): Promise<BackupSummary[]>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
}

export interface ProfileDetail {
  id: string;
  profileDir?: string;
  manifest: ProfileManifest;
  agentsMd: string;
  mcpToml: string;
  skillsPolicy: SkillsPolicy;
}

export interface SaveProfileInput {
  manifest: ProfileManifest;
  agentsMd: string;
  mcpToml: string;
  skillsPolicy: SkillsPolicy;
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
