export interface ProfileSummary {
  id: string;
  targetId: string;
  name: string;
  description: string;
  iconKey?: ResourceIconKey;
  contentHash?: string;
  targetContentHashes?: Record<string, string>;
}

export type { AssetPolicy, ProfileManifest, ResourceIconKey } from "./schemas";
import type { AssetPolicy, ProfileManifest, ResourceIconKey } from "./schemas";

export interface AgentEnvApi {
  onWindowCloseRequested(callback: () => void): () => void;
  confirmWindowClose(): void;
  copyText(text: string): Promise<void>;
  selectSkillFolder(): Promise<string | undefined>;
  listTargets(): Promise<TargetInfo[]>;
  listTargetStates(): Promise<TargetManagementState[]>;
  listSkillLibrary(): Promise<SkillLibraryEntry[]>;
  scanSkillInventory(): Promise<SkillInventoryEntry[]>;
  listSkillCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  ignoreSkillGroup(skillKey: string): Promise<SkillCleanupIgnoreRule>;
  unignoreSkillGroup(skillKey: string): Promise<void>;
  listMcpLibrary(): Promise<McpLibraryEntry[]>;
  saveMcpServer(input: SaveMcpServerInput): Promise<McpLibraryEntry>;
  removeMcpServer(id: string): Promise<void>;
  scanUnmanagedSkills(): Promise<UnmanagedSkillEntry[]>;
  importSkillToLibrary(sourcePath: string): Promise<SkillLibraryEntry>;
  importGitHubSkillToLibrary(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  scanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  importGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  removeSkillFromLibrary(id: string): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillInput): Promise<void>;
  consolidateSkillGroup(input: SkillCleanupRequest): Promise<SkillCleanupResult>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  checkSkillLibraryUpdates(): Promise<SkillUpdateInfo[]>;
  setSkillUpdateSource(input: SkillUpdateSourceInput): Promise<SkillLibraryEntry>;
  setSkillUpdatePolicy(input: SkillUpdatePolicyInput): Promise<SkillLibraryEntry>;
  setSkillIcon(input: SkillIconInput): Promise<SkillLibraryEntry>;
  previewLibrarySkillUpdate(id: string): Promise<SkillUpdatePlan>;
  updateLibrarySkill(id: string): Promise<SkillLibraryEntry>;
  readSettings(): Promise<AgentEnvSettings>;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings>;
  readGitHubAuthStatus(): Promise<GitHubAuthStatus>;
  startGitHubDeviceLogin(): Promise<GitHubDeviceLogin>;
  pollGitHubDeviceLogin(id: string): Promise<GitHubDeviceLoginResult>;
  signOutGitHub(): Promise<GitHubAuthStatus>;
  openGitHubDevicePage(url: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  createProfile(input: CreateProfileInput): Promise<ProfileDetail>;
  previewCreateProfileFromTarget(targetId: string): Promise<TargetCapturePreview>;
  createProfileFromTarget(input: CreateProfileFromTargetInput): Promise<TargetCaptureResult>;
  duplicateProfile(id: string): Promise<ProfileDetail>;
  deleteProfile(id: string): Promise<void>;
  previewApply(profileId: string, targetId?: string): Promise<ActivationPreview>;
  applyProfile(
    profileId: string,
    previewId: string,
    options?: ApplyProfileOptions
  ): Promise<ApplyResult>;
  listBackups(): Promise<BackupSummary[]>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
  previewStopManaging(targetId: string, mode: StopManagingMode): Promise<StopManagingPreview>;
  stopManaging(previewId: string): Promise<StopManagingResult>;
  createDataBackup(): Promise<DataBackupResult | undefined>;
  openDataFolder(): Promise<void>;
  selectDataRestore(): Promise<DataRestorePreview | undefined>;
  restoreDataBackup(path: string): Promise<{ safetyBackupPath: string }>;
  adoptTargetInstructions(profileId: string, targetId: string): Promise<ProfileDetail>;
}

export interface ApplyProfileOptions {
  allowManagedDrift?: boolean;
  allowOmissions?: boolean;
}

export interface SkillLibraryEntry {
  id: string;
  name: string;
  description: string;
  iconKey?: ResourceIconKey;
  path: string;
  sourceType: SkillSourceType;
  source?: string;
  updatePolicy: SkillUpdatePolicy;
  remoteRef?: string;
  remoteRevision?: string;
  contentHash: string;
  updatedAt: string;
}

export interface GitHubSkillImportInput {
  url: string;
  id?: string;
  ref?: string;
  remotePath?: string;
}

export type GitHubSkillCandidateStatus = "ready" | "already-imported" | "duplicate";

export interface GitHubSkillCandidate {
  id: string;
  name: string;
  description: string;
  remotePath: string;
  sourceUrl: string;
  ref: string;
  revision: string;
  status: GitHubSkillCandidateStatus;
  existingLibraryId?: string;
}

export interface GitHubSkillScanResult {
  owner: string;
  repo: string;
  ref: string;
  rootPath: string;
  truncated: boolean;
  candidates: GitHubSkillCandidate[];
}

export interface GitHubSkillImportFailure {
  id: string;
  sourceUrl: string;
  error: string;
}

export interface GitHubSkillImportResult {
  imported: SkillLibraryEntry[];
  failed: GitHubSkillImportFailure[];
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

export interface SkillUpdateSourceInput {
  id: string;
  sourceType: SkillSourceType;
  source: string;
}

export interface SkillUpdatePolicyInput {
  id: string;
  policy: SkillUpdatePolicy;
}

export interface SkillIconInput {
  id: string;
  iconKey: ResourceIconKey;
}

export interface ManageTargetSkillInput {
  targetId: string;
  targetName: string;
  libraryId: string;
}

export interface SkillUpdatePlan {
  id: string;
  name: string;
  sourceType: SkillSourceType;
  source?: string;
  currentRevision?: string;
  latestRevision?: string;
  updateAvailable: boolean;
  changes: PlannedFileChange[];
  errors: string[];
}

export type SkillInventoryStatus = "managed" | "library" | "unmanaged" | "ignored";

export interface SkillInventoryEntry extends UnmanagedSkillEntry {
  status: SkillInventoryStatus;
  libraryId?: string;
  skillKey: string;
  contentHash: string;
  ignoreRuleId?: string;
  installMethod?: "linked" | "copied";
  contentMatchesLibrary?: boolean;
}

export interface SkillCleanupLocationInput {
  targetId: string;
  path: string;
}

export interface SkillCleanupRequest {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  locations: SkillCleanupLocationInput[];
}

export interface SkillCleanupResult {
  backupId: string;
  libraryId: string;
  managedLocations: string[];
  operation?: "cleanup" | "remove";
}

export interface SkillCleanupBackupSummary {
  id: string;
  libraryId: string;
  createdAt: string;
  locationCount: number;
  operation?: "cleanup" | "remove";
}

export interface UnmanagedSkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  foundIn: string[];
}

export type SkillSourceType = "local" | "github" | "zip";
export type SkillUpdatePolicy = "tracked" | "untracked";
export type SkillSyncMethod = "symlink" | "copy" | "auto";
export type SkillStorageLocation = "appData" | "agents";

export interface SkillCleanupIgnoreRule {
  id: string;
  scope: "group" | "location";
  skillKey?: string;
  path?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

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
  existingId?: string;
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
  skillAutoCheckEnabled: boolean;
  skillAutoCheckIntervalMinutes: number;
}

export interface GitHubAuthUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface GitHubAuthStatus {
  state: "signed-out" | "configured" | "signed-in";
  clientId?: string;
  user?: GitHubAuthUser;
  rateLimit?: GitHubRateLimit;
  error?: string;
}

export interface GitHubDeviceLogin {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface GitHubDeviceLoginResult {
  state: "pending" | "slow-down" | "expired" | "denied" | "signed-in";
  message?: string;
  status?: GitHubAuthStatus;
}

export interface CreateProfileInput {
  targetId: string;
  name?: string;
  description?: string;
}

export interface CreateProfileFromTargetInput {
  previewId: string;
  name: string;
}

export interface TargetCaptureResource {
  kind: "instructions" | "config" | "skill" | "mcp" | "agent";
  id: string;
  name: string;
  sourcePath?: string;
  libraryId?: string;
  action: "include" | "reuse" | "import" | "consolidate" | "exclude";
  detail?: string;
}

export interface TargetCapturePreview {
  id: string;
  targetId: string;
  targetName: string;
  suggestedName: string;
  createdAt: string;
  resources: TargetCaptureResource[];
  cleanupPaths: string[];
  warnings: string[];
  errors: string[];
}

export interface TargetCaptureResult {
  profile: ProfileDetail;
  targetId: string;
  backupId: string;
  importedSkillCount: number;
  importedMcpCount: number;
  cleanedPathCount: number;
  warnings: string[];
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
  capabilities: TargetCapabilities;
}

export interface TargetCapabilities {
  instructions: boolean;
  skills: boolean;
  mcpTransports: McpTransport[];
  agentFormat?: "opencode" | "claude-code" | "codex";
  disabledSkillPaths: boolean;
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
  skillScanDirs?: string[];
  skillLocations?: TargetSkillLocation[];
}

export type TargetSkillLocationRole =
  | "preferred-runtime"
  | "alternate-runtime"
  | "compatibility-runtime"
  | "discovery-only";

export interface TargetSkillLocation {
  path: string;
  role: TargetSkillLocationRole;
  shared: boolean;
}

export interface TargetState {
  managedConfigKeys: string[];
  managedMcpNames: string[];
  activeProfileId?: string;
  appliedProfileHash?: string;
  appliedLibraryVersions?: LibraryResourceVersions;
  lastAppliedAt?: string;
  managedResources?: ManagedResourceSnapshot[];
  recoveryRequired?: TargetRecoveryState;
}

export type TargetManagementStatus = "unmanaged" | "managed";
export type TargetLifecycleStatus =
  | "unmanaged"
  | "applied"
  | "pending"
  | "drifted"
  | "recovery-required";

export interface TargetRecoveryState {
  operation: "apply" | "rollback";
  error: string;
  backupId?: string;
  occurredAt: string;
}

export interface TargetManagementState {
  targetId: string;
  activeProfileId?: string;
  activeProfileName?: string;
  appliedProfileHash?: string;
  appliedLibraryVersions?: LibraryResourceVersions;
  status: TargetManagementStatus;
  lifecycleStatus: TargetLifecycleStatus;
  lifecycleReason?: string;
  lastAppliedAt?: string;
  managedResourceCount: number;
  warningCount: number;
  errorCount: number;
}

export type ManagedResourceKind =
  | "instructions"
  | "config"
  | "mcp"
  | "skill"
  | "agent"
  | "file"
  | "directory";

export interface ManagedResourceSnapshot {
  kind: ManagedResourceKind;
  id: string;
  path: string;
  contentHash: string;
  source?: string;
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
  contentHash?: string;
  targetContentHashes?: Record<string, string>;
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

export interface PlannedResourceChange {
  kind: "skill" | "agent" | "file" | "directory";
  action: "install" | "replace" | "remove";
  name: string;
  path: string;
  source?: string;
}

export interface ActivationPreview {
  id: string;
  profileId: string;
  profileContentHash: string;
  libraryVersions: LibraryResourceVersions;
  createdAt: string;
  warnings: string[];
  errors: string[];
  changes: PlannedFileChange[];
  resourceChanges: PlannedResourceChange[];
  liveFingerprints: Record<string, string>;
  resourceFingerprints: Record<string, string>;
  sourceFingerprints: Record<string, string>;
  targetId: string;
  targetState: TargetState;
  effectivePayload?: EffectiveProfilePayload;
  omissions?: PlannedOmission[];
  requiresOmissionAcknowledgement?: boolean;
  operation?: "apply" | "takeover";
}

export interface EffectiveProfilePayload {
  instructions: number;
  skills: number;
  mcpServers: number;
  agents: number;
  nativeConfig: number;
  total: number;
}

export interface PlannedOmission {
  kind: "config" | "agent" | "setting";
  name: string;
  reason: string;
}

export interface LibraryResourceVersions {
  skills: Record<string, string>;
  mcp: Record<string, string>;
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
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift";
  targetId?: string;
  profileId?: string;
  profileName?: string;
  entries: BackupEntry[];
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  fileCount: number;
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift";
  targetId?: string;
  profileId?: string;
  profileName?: string;
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

export type StopManagingMode = "keep-current" | "restore-pre-takeover";

export interface StopManagingPreview extends RollbackPreview {
  targetId: string;
  targetName: string;
  mode: StopManagingMode;
  takeoverBackupId?: string;
  managedResourceCount: number;
  stateFingerprint: string;
}

export type StopManagingResult =
  | { ok: true; backupId: string }
  | { ok: false; errors: string[] };

export interface DataBackupResult {
  path: string;
  createdAt: string;
}

export interface DataRestorePreview {
  path: string;
  createdAt: string;
  formatVersion: number;
  topLevelItemCount: number;
}
