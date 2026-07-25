export interface ProfileSummary {
  id: string;
  preferredTargetId?: string;
  createdFromTargetId?: string;
  name: string;
  description: string;
  createdAt?: string;
  iconKey?: ResourceIconKey;
  contentHash?: string;
  targetContentHashes?: Record<string, string>;
  loadError?: string;
}

export type {
  ProfileManifest,
  ProfileMcpPolicy,
  ProfileMcpSelection,
  ProfileResourceMode,
  ProfileResources,
  ProfileSkill,
  ProfileTargetResourcePolicy,
  ResourceIconKey
} from "./schemas";
import type {
  ProfileManifest,
  ProfileResourceMode,
  ProfileResources,
  ProfileSkill,
  ResourceIconKey
} from "./schemas";
import type { DesktopContextMenuItem } from "./desktopContextMenu";
import type {
  WorkspaceSyncConnectInput,
  WorkspaceSyncOperationResult,
  WorkspaceSyncReview,
  WorkspaceSyncStatus,
  WorkspaceSyncUpdateInput
} from "./workspaceSync";

export type {
  WorkspaceSyncChange,
  WorkspaceSyncChangeAction,
  WorkspaceSyncChangeDirection,
  WorkspaceSyncConflictChoice,
  WorkspaceSyncConnection,
  WorkspaceSyncConnectInput,
  WorkspaceSyncOperationResult,
  WorkspaceSyncResourceKind,
  WorkspaceSyncReview,
  WorkspaceSyncStatus,
  WorkspaceSyncStatusKind,
  WorkspaceSyncUpdateInput,
  WorkspaceSyncWorkingState
} from "./workspaceSync";

export interface AgentEnvApi {
  readonly runtimeVersion: number;
  readonly platform: string;
  readStartupStatus(): Promise<StartupStatus>;
  onStartupStatusChanged(callback: (status: StartupStatus) => void): () => void;
  retryStartup(): Promise<void>;
  openStartupDataFolder(): Promise<void>;
  exportStartupDiagnostics(): Promise<string | undefined>;
  quitApp(): void;
  onWindowCloseRequested(callback: () => void): () => void;
  setWindowCloseGuard(enabled: boolean): void;
  confirmWindowClose(): void;
  cancelWindowClose(): void;
  openContextMenu(items: DesktopContextMenuItem[]): Promise<string | undefined>;
  copyText(text: string): Promise<void>;
  selectSkillFolder(): Promise<string | undefined>;
  selectLocalSkillSource(): Promise<LocalSkillSourceSelection | undefined>;
  releaseSkillArchive(token: string): Promise<void>;
  selectTargetConfigRoot(targetId: string): Promise<string | undefined>;
  listSupportedTargets(): Promise<TargetDescriptor[]>;
  listTargets(forceRefresh?: boolean): Promise<TargetInfo[]>;
  listTargetStates(): Promise<TargetManagementState[]>;
  listConversations(input?: ConversationListInput): Promise<ConversationListResult>;
  readConversation(id: string): Promise<ConversationDetail>;
  refreshConversations(): Promise<ConversationRefreshResult>;
  openOriginalConversation(id: string): Promise<ConversationLaunchResult>;
  previewConversationContinuation(
    input: ConversationContinueInput
  ): Promise<ConversationContinuationPreview>;
  continueConversation(previewId: string): Promise<ConversationLaunchResult>;
  listNativeMcpConnections(): Promise<NativeMcpInspection>;
  listSkillLibrary(): Promise<SkillLibraryEntry[]>;
  listSkillFiles(id: string): Promise<SkillFileNode[]>;
  readSkillFile(input: SkillFileReadInput): Promise<SkillFileContent>;
  scanSkillInventory(): Promise<SkillInventoryEntry[]>;
  listSkillCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  setSkillPathPolicies(input: SkillPathPolicyUpdate): Promise<SkillPathPolicy[]>;
  scanUnmanagedSkills(): Promise<UnmanagedSkillEntry[]>;
  scanLocalSkillSource(rootPath: string): Promise<ProjectSkillScanResult>;
  previewSkillImport(input: SkillImportPreviewInput): Promise<SkillImportPreview>;
  previewSkillMerge(id: string): Promise<SkillMergePreview>;
  mergeLibrarySkills(input: SkillMergeInput): Promise<SkillMergeResult>;
  importSkillToLibrary(input: SkillImportInput): Promise<SkillImportResult>;
  importGitHubSkillToLibrary(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  scanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  importGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  scanRepositorySkills(input: RepositorySkillSourceInput): Promise<RepositorySkillScanResult>;
  importRepositorySkillToLibrary(input: RepositorySkillImportInput): Promise<SkillLibraryEntry>;
  importRepositorySkills(inputs: RepositorySkillImportInput[]): Promise<RepositorySkillImportResult>;
  listSkillSourceGroups(): Promise<SkillSourceGroupView[]>;
  checkSkillSourceGroup(sourceId: string): Promise<SkillSourceGroupView>;
  checkMonitoredSkillSourceGroups(): Promise<SkillSourceCheckAllResult>;
  setSkillSourceName(input: SkillSourceNameInput): Promise<SkillSourceGroupView>;
  setSkillSourceMonitored(input: SkillSourceMonitoringInput): Promise<SkillSourceGroupView>;
  previewSkillSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  mergeSkillSources(previewId: string): Promise<SkillSourceMergeResult>;
  cancelRepositoryOperations(): Promise<void>;
  removeSkillFromLibrary(id: string): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillInput): Promise<void>;
  consolidateSkillGroup(input: SkillCleanupRequest): Promise<SkillCleanupResult>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  setSharedSkillRetention(input: SharedSkillRetentionInput): Promise<void>;
  retireSharedSkill(input: RetireSharedSkillInput): Promise<SkillCleanupResult>;
  checkSkillLibraryUpdates(ids?: string[]): Promise<SkillUpdateInfo[]>;
  setSkillUpdateSettings(input: SkillUpdateSettingsInput): Promise<SkillLibraryEntry>;
  setSkillAvailability(input: SkillAvailabilityInput): Promise<SkillLibraryEntry>;
  setSkillIcon(input: SkillIconInput): Promise<SkillLibraryEntry>;
  previewLibrarySkillUpdate(id: string): Promise<SkillUpdatePlan>;
  previewLibrarySkillUpdates(ids: string[]): Promise<SkillUpdatePreviewBatchResult>;
  updateLibrarySkill(input: SkillUpdateConfirmation): Promise<SkillLibraryEntry>;
  readSettings(): Promise<AgentEnvSettings>;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings>;
  readWorkspaceSyncStatus(): Promise<WorkspaceSyncStatus>;
  connectWorkspaceSync(input: WorkspaceSyncConnectInput): Promise<WorkspaceSyncStatus>;
  checkWorkspaceSync(): Promise<WorkspaceSyncStatus>;
  reviewWorkspaceSync(): Promise<WorkspaceSyncReview>;
  updateWorkspaceFromSync(input: WorkspaceSyncUpdateInput): Promise<WorkspaceSyncOperationResult>;
  publishWorkspaceSync(): Promise<WorkspaceSyncOperationResult>;
  recoverWorkspaceSync(): Promise<WorkspaceSyncStatus>;
  disconnectWorkspaceSync(): Promise<WorkspaceSyncStatus>;
  readGitHubAuthStatus(): Promise<GitHubAuthStatus>;
  startGitHubDeviceLogin(): Promise<GitHubDeviceLogin>;
  pollGitHubDeviceLogin(id: string): Promise<GitHubDeviceLoginResult>;
  signOutGitHub(): Promise<GitHubAuthStatus>;
  openGitHubDevicePage(url: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  updateProfileSkills(input: UpdateProfileSkillsInput): Promise<UpdateProfileSkillsResult>;
  forkProfileSkills(input: ForkProfileSkillsInput): Promise<UpdateProfileSkillsResult>;
  updateProfileMetadata(input: UpdateProfileMetadataInput): Promise<ProfileDetail>;
  createProfile(input: CreateProfileInput): Promise<ProfileDetail>;
  previewCreateProfileFromTarget(
    targetId: string,
    scope?: TargetCaptureScope
  ): Promise<TargetCapturePreview>;
  createProfileFromTarget(input: CreateProfileFromTargetInput): Promise<TargetCaptureResult>;
  duplicateProfile(id: string): Promise<ProfileDetail>;
  deleteProfile(id: string): Promise<void>;
  previewApply(profileId: string, targetId?: string): Promise<ActivationPreview>;
  applyProfile(
    profileId: string,
    previewId: string
  ): Promise<ApplyResult>;
  listBackups(): Promise<BackupSummary[]>;
  listManagedBackups(): Promise<ManagedBackupInventory>;
  deleteManagedBackup(input: DeleteManagedBackupInput): Promise<ManagedBackupDeleteResult>;
  cleanupManagedBackups(): Promise<ManagedBackupCleanupResult>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
  previewStopManaging(targetId: string, mode: StopManagingMode): Promise<StopManagingPreview>;
  stopManaging(previewId: string): Promise<StopManagingResult>;
  createDataBackup(): Promise<DataBackupResult | undefined>;
  readDataRoot(): Promise<string>;
  openDataFolder(): Promise<void>;
  selectDataRestore(): Promise<DataRestorePreview | undefined>;
  restoreDataBackup(path: string): Promise<{ safetyBackupPath: string }>;
  adoptTargetChanges(profileId: string, targetId: string): Promise<AdoptTargetChangesResult>;
}

export interface LocalSkillSourceSelection {
  kind: "folder" | "archive";
  path: string;
  rootPath: string;
  archiveToken?: string;
}

export interface SkillFileNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  sizeBytes?: number;
  children?: SkillFileNode[];
}

export interface SkillFileReadInput {
  id: string;
  path: string;
}

export interface SkillFileContent {
  path: string;
  kind: "text" | "binary" | "too-large";
  sizeBytes: number;
  content?: string;
}

export type StartupFailureKind =
  | "newer-data-format"
  | "invalid-data"
  | "permission"
  | "recovery"
  | "unknown";

export type StartupStatus =
  | { state: "initializing" }
  | { state: "ready" }
  | {
      state: "failed";
      kind: StartupFailureKind;
      title: string;
      message: string;
      dataRoot?: string;
      canRetry: boolean;
    };

export type ConversationRole = "user" | "assistant";
export type ConversationDetailState = "full" | "summary-only";
export type ConversationCapabilityState =
  | "available"
  | "degraded"
  | "unavailable"
  | "unsupported";

export interface ConversationCapabilityStatus {
  state: ConversationCapabilityState;
  evidence: string[];
}

export interface TargetConversationCapabilities {
  history: ConversationCapabilityStatus;
  openOriginal: ConversationCapabilityStatus;
  continue: ConversationCapabilityStatus;
}

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  sourceId: string;
  title: string;
  snippet: string;
  matchSnippet?: string;
  workspacePath?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  detailState: ConversationDetailState;
  archived?: boolean;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt?: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface ConversationListInput {
  query?: string;
  agentIds?: string[];
  workspacePaths?: string[];
  limit?: number;
  offset?: number;
}

export interface ConversationListResult {
  items: ConversationSummary[];
  total: number;
  workspacePaths?: string[];
}

export interface ConversationRefreshFailure {
  agentId: string;
  message: string;
}

export interface ConversationRefreshResult {
  indexed: number;
  unchanged: number;
  removed: number;
  failures: ConversationRefreshFailure[];
}

export interface ConversationContinueInput {
  conversationId: string;
  targetId: string;
}

export type ConversationLaunchMode = "native" | "context-file" | "clipboard";

export interface ConversationContinuationPreview {
  previewId: string;
  conversationId: string;
  targetId: string;
  targetName: string;
  mode: ConversationLaunchMode;
  portableMessageCount: number;
  totalMessageCount: number;
  omittedMessageCount: number;
  sensitiveValuesRedacted: boolean;
  warnings: string[];
  requiresReview: boolean;
}

export interface ConversationLaunchResult {
  mode: ConversationLaunchMode;
  message: string;
}

export type AdoptedTargetResource = "instructions" | "mcp";

export interface AdoptTargetChangesResult {
  profile: ProfileDetail;
  adopted: AdoptedTargetResource[];
  skipped: string[];
}

export interface SkillLibraryEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  versionSource?: "version" | "metadata.version";
  iconKey?: ResourceIconKey;
  path: string;
  sourceType: SkillSourceType;
  source?: string;
  globallyEnabled?: boolean;
  updatePolicy: SkillUpdatePolicy;
  remoteRef?: string;
  remoteRevision?: string;
  contentHash: string;
  updatedAt: string;
  upstream?: SkillUpstream;
  provenance?: SkillProvenance;
  sourceCollection?: SkillSourceCollectionRef;
}

export interface SkillUpstream {
  kind: "github" | "gitlab" | "git" | "local" | "well-known";
  locator: string;
  ref?: string;
  subpath?: string;
  revision?: string;
  updatedAt?: string;
}

export interface SkillProvenance {
  importedVia: "agentenv" | "local-scan";
  externalManager?: "skills-cli";
  externalLockPath?: string;
}

export interface SkillExternalEvidence {
  manager: "skills-cli" | "claude-plugin" | "agent-builtin";
  displayName?: string;
  importable?: boolean;
  lockPath?: string;
  lockVersion?: number;
  canonicalPath: string;
  confidence: "confirmed" | "inferred";
  state: "healthy" | "broken-link" | "unknown";
  upstream?: SkillUpstream;
}

export interface SkillImportInput {
  sourcePath: string;
  id?: string;
  sourceHandling?: "copy-only";
  provenance?: SkillProvenance;
  upstream?: SkillUpstream;
  expectedContentHash?: string;
  conflictResolution?: SkillImportConflictResolution;
  sourceCollection?: SkillSourceCollectionRef;
}

export type SkillImportPreviewInput =
  | { kind: "local"; input: SkillImportInput }
  | { kind: "github"; input: GitHubSkillImportInput }
  | { kind: "repository"; input: RepositorySkillImportInput };

export interface SkillImportSnapshot {
  id: string;
  name: string;
  description: string;
  version?: string;
  versionSource?: "version" | "metadata.version";
  contentHash: string;
  modifiedAt?: string;
  sourceType: SkillSourceType;
  source: string;
  upstream?: SkillUpstream;
  skillMarkdown: string;
}

export interface SkillImportConflict {
  existing: SkillImportSnapshot;
  match: "name" | "id" | "name-and-id";
  contentIdentical: boolean;
  sourceUpdateAvailable: boolean;
  identical: boolean;
  changes: PlannedFileChange[];
}

export interface SkillImportPreview {
  source: SkillImportPreviewInput;
  incoming: SkillImportSnapshot;
  conflicts: SkillImportConflict[];
}

export type SkillImportConflictResolution =
  | { action: "reuse"; existingId: string }
  | { action: "update-source"; existingId: string }
  | { action: "replace"; existingId: string }
  | { action: "keep-both"; id: string };

export interface SkillImportResult {
  skill: SkillLibraryEntry;
  managedLocations: string[];
  backupId?: string;
  reused?: boolean;
  sourceUpdated?: boolean;
}

export interface SkillMergePreviewEntry extends SkillImportSnapshot {
  iconKey?: ResourceIconKey;
  globallyEnabled: boolean;
  updatePolicy: SkillUpdatePolicy;
  profileNames: string[];
  installCount: number;
}

export interface SkillMergeComparison {
  leftId: string;
  rightId: string;
  identical: boolean;
  changes: PlannedFileChange[];
}

export interface SkillMergePreview {
  name: string;
  entries: SkillMergePreviewEntry[];
  comparisons: SkillMergeComparison[];
  profileCount: number;
  installCount: number;
}

export interface SkillMergeInput {
  ids: string[];
  keepId: string;
  sourceId: string;
  expectedContentHashes: Record<string, string>;
}

export interface SkillMergeResult {
  backupId: string;
  skill: SkillLibraryEntry;
  removedIds: string[];
  profilesUpdated: number;
  installsUpdated: number;
}

export interface GitHubSkillImportInput {
  url: string;
  id?: string;
  ref?: string;
  remotePath?: string;
  sourceCollection?: SkillSourceCollectionRef;
  expectedContentHash?: string;
  conflictResolution?: SkillImportConflictResolution;
}

export type GitHubSkillCandidateStatus =
  | "ready"
  | "already-imported"
  | "duplicate"
  | "invalid";

export interface GitHubSkillCandidate {
  id: string;
  name: string;
  description: string;
  version?: string;
  remotePath: string;
  sourceUrl: string;
  ref: string;
  revision: string;
  compatibleRevisions?: string[];
  status: GitHubSkillCandidateStatus;
  existingLibraryId?: string;
  error?: string;
}

export interface GitHubSkillScanResult {
  owner: string;
  repo: string;
  ref: string;
  rootPath: string;
  sourceScope: SkillSourceScope;
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

export type RepositorySkillTransport = "github-api" | "system-git";

export interface RepositorySkillSourceInput {
  repository: string;
  ref?: string;
  directory?: string;
  transport?: RepositorySkillTransport;
}

export interface RepositorySkillImportInput extends RepositorySkillSourceInput {
  id?: string;
  sourceCollection?: SkillSourceCollectionRef;
  expectedContentHash?: string;
  conflictResolution?: SkillImportConflictResolution;
}

export interface RepositorySkillCandidate {
  id: string;
  name: string;
  description: string;
  version?: string;
  directory: string;
  source: SkillUpstream;
  contentRevision: string;
  compatibleRevisions?: string[];
  resolvedCommit: string;
  upstreamUpdatedAt?: string;
  status: GitHubSkillCandidateStatus;
  existingLibraryId?: string;
  error?: string;
}

export interface RepositorySkillScanResult {
  repository: string;
  ref: string;
  directory: string;
  transport: RepositorySkillTransport;
  accessTransport?: "https" | "ssh" | "file";
  sourceScope: SkillSourceScope;
  truncated: boolean;
  candidates: RepositorySkillCandidate[];
}

export interface SkillSourceScope {
  formatVersion: 1;
  kind?: "repository" | "local";
  canonicalLink: string;
  repository: string;
  ref: string;
  directory: string;
}

export interface SkillSourceCollectionRef extends SkillSourceScope {
  sourceId?: string;
  sourceSubpath: string;
}

export interface SkillSourceRecord extends SkillSourceScope {
  id: string;
  displayName?: string;
  automaticChecks?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSourceNameInput {
  sourceId: string;
  name?: string;
}

export interface SkillSourceMonitoringInput {
  sourceId: string;
  enabled: boolean;
}

export type SkillSourceCandidateState =
  | "current"
  | "update"
  | "new"
  | "removed"
  | "invalid"
  | "conflict"
  | "missing"
  | "unchecked";

export interface SkillSourceGroupCandidate {
  sourceSubpath: string;
  directory: string;
  name: string;
  description: string;
  version?: string;
  contentRevision?: string;
  compatibleRevisions?: string[];
  upstreamUpdatedAt?: string;
  libraryId?: string;
  libraryName?: string;
  libraryVersion?: string;
  libraryUpdatedAt?: string;
  globallyEnabled?: boolean;
  updatePolicy?: SkillUpdatePolicy;
  state: SkillSourceCandidateState;
  detail?: string;
}

export interface SkillSourceGroupCounts {
  total: number;
  updates: number;
  new: number;
  removed: number;
}

export interface SkillSourceGroupView extends SkillSourceScope {
  sourceId: string;
  sourceKind?: "repository" | "local";
  automaticChecks?: boolean;
  displayName?: string;
  checkedAt?: string;
  observationState: "unchecked" | "ready" | "error";
  error?: string;
  counts: SkillSourceGroupCounts;
  candidates: SkillSourceGroupCandidate[];
}

export interface SkillSourceMergePreviewInput {
  sourceIds: string[];
  directory?: string;
  rootPath?: string;
}

export interface SkillSourceMergePreview {
  id: string;
  sourceIds: string[];
  sources: SkillSourceGroupView[];
  mergedSource: SkillSourceScope;
  automaticChecks: boolean;
  affectedSkillCount: number;
  discoveredSkillCount: number;
  mergesIntoExistingSource: boolean;
  warnings: string[];
  blockers: string[];
}

export interface SkillSourceMergeResult {
  source: SkillSourceGroupView;
  mergedSourceCount: number;
  affectedSkillCount: number;
  backupPath: string;
}

export interface SkillSourceCheckAllResult {
  groups: SkillSourceGroupView[];
  checked: number;
  failed: number;
}

export interface RepositorySkillImportFailure {
  id: string;
  repository: string;
  ref?: string;
  directory?: string;
  error: string;
}

export interface RepositorySkillImportResult {
  imported: SkillLibraryEntry[];
  failed: RepositorySkillImportFailure[];
}

export interface SkillUpdateInfo {
  id: string;
  name: string;
  sourceType: SkillSourceType;
  currentRevision?: string;
  latestRevision?: string;
  latestUpdatedAt?: string;
  updateAvailable: boolean;
  error?: string;
}

export interface SkillUpdateSourceInput {
  id: string;
  sourceType: SkillSourceType;
  source: string;
  ref?: string;
  directory?: string;
}

export interface SkillUpdatePolicyInput {
  id: string;
  policy: SkillUpdatePolicy;
}

export interface SkillUpdateSettingsInput {
  source?: SkillUpdateSourceInput;
  policy: SkillUpdatePolicyInput;
}

export interface SkillAvailabilityInput {
  id: string;
  enabled: boolean;
}

export interface SkillIconInput {
  id: string;
  iconKey?: ResourceIconKey;
}

export interface ManageTargetSkillInput {
  targetId: string;
  targetName: string;
  libraryId: string;
}

export interface SkillUpdatePlan {
  id: string;
  previewId?: string;
  name: string;
  sourceType: SkillSourceType;
  source?: string;
  currentRevision?: string;
  latestRevision?: string;
  updateAvailable: boolean;
  changes: PlannedFileChange[];
  errors: string[];
  impact: SkillUpdateImpact;
}

export interface SkillUpdatePreviewBatchResult {
  plans: SkillUpdatePlan[];
  failed: Array<{ id: string; error: string }>;
}

export interface SkillUpdateImpact {
  profileNames: string[];
  linkedInstallCount: number;
  linkedTargetIds: string[];
  copiedInstallCount: number;
  copiedTargetIds: string[];
}

export interface SkillUpdateConfirmation {
  id: string;
  previewId: string;
}

export type SkillInventoryStatus = "managed" | "library" | "outside" | "kept-outside";

export interface SkillInventoryEntry extends UnmanagedSkillEntry {
  status: SkillInventoryStatus;
  libraryId?: string;
  skillKey: string;
  runtimeName?: string;
  deploymentName?: string;
  runtimeScope?: SkillRuntimeScope;
  runtimeOwner?: SkillRuntimeOwner;
  managedByTarget?: boolean;
  runtimeAvailability?: SkillRuntimeAvailability;
  runtimeConfidence?: SkillRuntimeConfidence;
  runtimeIssues?: SkillRuntimeIssue[];
  runtimeStates?: SkillRuntimeTargetState[];
  contentHash: string;
  pathPolicyId?: string;
  pathPolicy?: SkillPathPolicyMode;
  installMethod?: "linked" | "copied";
  contentMatchesLibrary?: boolean;
  externalEvidence?: SkillExternalEvidence;
  locationRole?: TargetSkillLocationRole;
  sharedLocation?: boolean;
  legacyLocation?: boolean;
  locationManagement?: TargetSkillLocation["management"];
}

export type SkillScanDepth = "direct" | "recursive";
export type SkillRuntimeScope = "user" | "workspace" | "shared" | "builtin";
export type SkillRuntimeOwner = "agentenv" | "user" | "agent" | "external";
export type SkillRuntimeAvailability = "enabled" | "disabled" | "shadowed" | "unknown";
export type SkillRuntimeConfidence = "verified" | "inferred";

export interface SkillRuntimeIssue {
  code:
    | "missing-runtime-name"
    | "invalid-runtime-name"
    | "duplicate-runtime-name"
    | "external-owner"
    | "unreadable-skill"
    | "unreadable-native-state";
  severity: "info" | "warning" | "error";
  message: string;
}

export interface SkillRuntimeTargetState {
  targetId: string;
  availability: SkillRuntimeAvailability;
  confidence: SkillRuntimeConfidence;
  issues: SkillRuntimeIssue[];
}

export interface SkillRuntimeObservation {
  targetId: string;
  locationPath: string;
  path: string;
  runtimeName: string;
  deploymentName: string;
  version?: string;
  scope: SkillRuntimeScope;
  owner: SkillRuntimeOwner;
  availability: SkillRuntimeAvailability;
  confidence: SkillRuntimeConfidence;
  locationRole: TargetSkillLocationRole;
  shared: boolean;
  legacy: boolean;
  externalEvidence?: SkillExternalEvidence;
  issues: SkillRuntimeIssue[];
}

export interface SkillRuntimeSnapshot {
  targetId: string;
  observations: SkillRuntimeObservation[];
  issues: SkillRuntimeIssue[];
  nativeDisabledRuntimeNames?: string[];
}

export interface SkillRuntimeNativeState {
  disabledRuntimeNames: string[];
  issues: SkillRuntimeIssue[];
}

export interface SkillCleanupLocationInput {
  targetId: string;
  path: string;
  contentHash: string;
}

export interface SkillCleanupRequest {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  libraryAction?: "create" | "keep" | "replace";
  locations: SkillCleanupLocationInput[];
  mode?: "target-copies" | "shared-compatibility";
  sharedLocations?: Array<{ path: string; contentHash: string }>;
}

export interface SharedSkillRetentionInput {
  skillKey: string;
  paths: string[];
  retained: boolean;
}

export interface RetireSharedSkillInput {
  skillKey: string;
  libraryId: string;
  paths: string[];
}

export interface SkillCleanupResult {
  backupId: string;
  libraryId: string;
  managedLocations: string[];
  operation?: "cleanup" | "remove" | "retire" | "update" | "merge";
  libraryCreated?: boolean;
  profilesUpdated?: number;
  installsUpdated?: number;
}

export interface SkillCleanupBackupSummary {
  id: string;
  libraryId: string;
  createdAt: string;
  locationCount: number;
  operation?: "cleanup" | "remove" | "retire" | "update" | "merge";
}

export interface UnmanagedSkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  foundIn: string[];
  modifiedAt?: string;
}

export type SkillSourceType = "local" | "github" | "git";
export type SkillUpdatePolicy = "tracked" | "untracked";
export type SkillSyncMethod = "symlink" | "copy" | "auto";
export type SkillStorageLocation = "appData" | "agents";

export type SkillPathPolicyMode = "keep-outside" | "keep-shared";

export interface SkillPathPolicy {
  id: string;
  path: string;
  skillKey: string;
  targetId?: string;
  mode: SkillPathPolicyMode;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPathPolicyInput {
  path: string;
  skillKey: string;
  targetId?: string;
}

export interface SkillPathPolicyUpdate {
  items: SkillPathPolicyInput[];
  mode?: SkillPathPolicyMode;
}

export type McpTransport = "stdio" | "http" | "sse";

export type NativeMcpScope =
  "user" | "project" | "plugin" | "managed" | "unknown";

export interface NativeMcpConnection {
  targetId: string;
  name: string;
  scope: NativeMcpScope;
  transport?: McpTransport;
  enabled: boolean;
  controllable: boolean;
  sourcePath: string;
  detail?: string;
}

export interface NativeMcpInspectionIssue {
  targetId: string;
  targetName: string;
  sourcePath: string;
  message: string;
}

export interface NativeMcpInspection {
  connections: NativeMcpConnection[];
  issues: NativeMcpInspectionIssue[];
}

export interface AgentEnvSettings {
  locale: AppLocale;
  skillSyncMethod: SkillSyncMethod;
  skillStorageLocation: SkillStorageLocation;
  skillAutoCheckEnabled: boolean;
  skillAutoCheckIntervalMinutes: number;
  backupRetentionDays: BackupRetentionDays;
  enabledTargetIds?: string[];
  targetConfigRoots?: Record<string, string>;
}

export type ProjectSkillCandidateStatus = "ready" | "in-library" | "changed" | "invalid";

export interface ProjectSkillCandidate {
  id: string;
  name: string;
  description: string;
  version?: string;
  rootPath: string;
  path: string;
  relativePath: string;
  contentHash: string;
  modifiedAt?: string;
  status: ProjectSkillCandidateStatus;
  existingLibraryId?: string;
  error?: string;
}

export interface ProjectSkillScanResult {
  roots: string[];
  sourceScope?: SkillSourceScope;
  candidates: ProjectSkillCandidate[];
  issues: Array<{ rootPath: string; message: string }>;
  scannedDirectories: number;
  truncated: boolean;
}

export type BackupRetentionDays = 7 | 30 | 90 | null;

export type ManagedBackupKind = "target-recovery" | "skill-cleanup" | "workspace-sync";
export type ManagedBackupCleanupStatus = "required" | "retained" | "kept" | "eligible";
export type ManagedBackupRequiredReason = "recovery-required" | "takeover-baseline" | "workspace-sync-recovery";

export interface ManagedBackupItem {
  id: string;
  kind: ManagedBackupKind;
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
  operation?: BackupManifest["operation"] | SkillCleanupBackupSummary["operation"];
  targetId?: string;
  profileName?: string;
  libraryId?: string;
  restored?: boolean;
  cleanupStatus: ManagedBackupCleanupStatus;
  requiredReason?: ManagedBackupRequiredReason;
  deletable: boolean;
}

export interface ManagedBackupInventory {
  items: ManagedBackupItem[];
  totalBytes: number;
  eligibleBytes: number;
  eligibleCount: number;
  retentionDays: BackupRetentionDays;
}

export interface DeleteManagedBackupInput {
  id: string;
  kind: ManagedBackupKind;
}

export interface ManagedBackupDeleteResult {
  deletedCount: number;
  freedBytes: number;
}

export interface ManagedBackupCleanupFailure extends DeleteManagedBackupInput {
  message: string;
}

export interface ManagedBackupCleanupResult extends ManagedBackupDeleteResult {
  failures: ManagedBackupCleanupFailure[];
}

export type AppLocale = "system" | "en" | "zh_CN" | "zh_TW";

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
  verification?: "verified" | "unavailable";
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
  state: "pending" | "expired" | "denied" | "signed-in";
  message?: string;
  retryAfterSeconds?: number;
  status?: GitHubAuthStatus;
}

export interface CreateProfileInput {
  preferredTargetId?: string;
  name?: string;
  description?: string;
}

export interface CreateProfileFromTargetInput {
  previewId: string;
  name: string;
}

export type TargetCaptureScope = "all" | "skills";

export interface TargetCaptureResource {
  kind: "instructions" | "skill" | "mcp";
  id: string;
  name: string;
  sourcePath?: string;
  libraryId?: string;
  action: "include" | "reuse" | "import" | "exclude";
  detail?: string;
}

export interface TargetCapturePreview {
  id: string;
  targetId: string;
  targetName: string;
  scope: TargetCaptureScope;
  suggestedName: string;
  createdAt: string;
  resources: TargetCaptureResource[];
  warnings: string[];
  errors: string[];
}

export interface TargetCaptureResult {
  profile: ProfileDetail;
  targetId: string;
  importedSkillCount: number;
  importedMcpCount: number;
  warnings: string[];
}

export interface TargetDescriptor {
  id: string;
  name: string;
  description: string;
  iconKey?: string;
  displayOrder?: number;
  defaultProfileId?: string;
  instructionsLabel: string;
  configLabel: string;
  configLanguage: "json" | "jsonc" | "toml" | "yaml" | "text";
  mcpConfigKey?: string;
  realWritesEnabled: boolean;
  executableName?: string;
  capabilities: TargetCapabilities;
}

export interface TargetCapabilities {
  instructions: boolean;
  skills: boolean;
  mcpTransports: McpTransport[];
  agentFormat?: "opencode" | "claude-code" | "codex" | "trae-cli";
  disabledSkillPaths: boolean;
  nativeConfig?: boolean;
  mcpEnvironmentReferences?: boolean;
  mcpActivation?: boolean;
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
  scope?: SkillRuntimeScope;
  scanDepth?: SkillScanDepth;
  management?: "managed" | "observed" | "legacy";
  externalContainerMarkers?: TargetSkillExternalContainerMarker[];
}

export interface TargetSkillExternalContainerMarker {
  relativePath: string;
  manager: SkillExternalEvidence["manager"];
  displayName: string;
  importable: boolean;
}

export interface TargetState {
  formatVersion?: 2;
  managedMcpNames: string[];
  activeProfileId?: string;
  appliedProfileHash?: string;
  appliedLibraryVersions?: LibraryResourceVersions;
  lastAppliedAt?: string;
  managedResources?: ManagedResourceSnapshot[];
  keptOutsideSkills?: TargetKeptOutsideSkill[];
  sharedSkillPreparations?: SharedSkillPreparation[];
  recoveryRequired?: TargetRecoveryState;
}

export interface TargetKeptOutsideSkill {
  path: string;
  skillKey: string;
  libraryId: string;
  targetName: string;
}

export interface SharedSkillPreparation {
  skillKey: string;
  libraryId: string;
  sharedPaths: string[];
  targetName: string;
  disposition: "install" | "omit";
  profileId: string;
  profileHash: string;
}

export type TargetManagementStatus = "unmanaged" | "managed";
export type TargetLifecycleStatus =
  | "unmanaged"
  | "applied"
  | "applied-with-outside"
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
  keptOutsideSkills?: TargetKeptOutsideSkill[];
  sharedSkillPreparations?: SharedSkillPreparation[];
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
  paused?: boolean;
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
  installationFound: boolean;
  installationEvidence: TargetInstallationEvidence[];
  executableName?: string;
  executablePath?: string;
  executableFound: boolean;
  canWrite: boolean;
  summary: string;
  checks: TargetPathCheck[];
}

export type TargetInstallationEvidenceKind = "command" | "desktop-app";

export interface TargetInstallationEvidence {
  kind: TargetInstallationEvidenceKind;
  label: string;
  path: string;
}

export interface TargetInfo extends TargetDescriptor {
  paths: TargetPaths;
  health: TargetHealth;
  conversationCapabilities: TargetConversationCapabilities;
}

export interface TargetActivationPreview {
  changes: PlannedFileChange[];
  issues: ApplyIssue[];
  liveFingerprints: Record<string, string>;
  targetState: TargetState;
}

export interface ProfileDetail {
  id: string;
  profileDir?: string;
  manifest: ProfileManifest;
  instructions: string;
  resources: ProfileResources;
  contentHash?: string;
  targetContentHashes?: Record<string, string>;
}

export interface SaveProfileInput {
  manifest: ProfileManifest;
  instructions: string;
  resources: ProfileResources;
}

export interface UpdateProfileSkillsInput {
  profileId: string;
  targetId: string;
  expectedContentHash: string;
  skills: ProfileSkill[];
  managementMode?: ProfileResourceMode;
}

export interface UpdateProfileSkillsResult {
  profile: ProfileDetail;
  changed: boolean;
}

export interface ForkProfileSkillsInput extends UpdateProfileSkillsInput {
  name: string;
}

export interface UpdateProfileMetadataInput {
  id: string;
  name?: string;
  description?: string;
  iconKey?: ResourceIconKey;
}

export interface PlannedFileChange {
  path: string;
  before: string;
  after: string;
  diff: string;
  category?: "instructions" | "mcp" | "configuration";
}

export interface PlannedResourceChange {
  kind: "skill" | "agent" | "file" | "directory";
  action: "install" | "replace" | "remove";
  name: string;
  path: string;
  source?: string;
}

export type ApplyIssueDisposition = "notice" | "review" | "block";

export type ApplyIssueResolution =
  | "automatic"
  | "backup-replace"
  | "edit-profile"
  | "external-action"
  | "open-recovery"
  | "preserve";

export type ApplyIssueResourceKind =
  | "profile"
  | "target"
  | "instructions"
  | "skill"
  | "mcp"
  | "configuration"
  | "skills-root";

export type ApplyIssueCode =
  | "target-unavailable"
  | "profile-validation"
  | "secret-warning"
  | "native-setting-preserved"
  | "instruction-alias"
  | "invalid-native-config"
  | "missing-native-mcp"
  | "unsupported-mcp-management"
  | "target-instruction-limit"
  | "duplicate-native-mcp"
  | "agent-owned-native-mcp"
  | "unsafe-native-mcp-update"
  | "globally-disabled-skill"
  | "missing-library-skill"
  | "outside-skill-replacement"
  | "outside-skill-removal"
  | "kept-outside-skill"
  | "managed-resource-drift"
  | "managed-resource-missing"
  | "duplicate-runtime-skill"
  | "native-disabled-skill"
  | "runtime-observation"
  | "runtime-state-unavailable"
  | "runtime-skill-conflict"
  | "unsupported-skill-management"
  | "shared-skill-conflict"
  | "shared-skill-deferred"
  | "skill-root-isolation"
  | "invalid-skill-root"
  | "recovery-required"
  | "operation-precondition"
  | "operation-notice";

export interface ApplyIssue {
  id: string;
  code: ApplyIssueCode;
  disposition: ApplyIssueDisposition;
  resolution: ApplyIssueResolution;
  resourceKind: ApplyIssueResourceKind;
  resourceId?: string;
  path?: string;
  message: string;
  detail?: string;
}

export interface ActivationPreview {
  id: string;
  profileId: string;
  profileContentHash: string;
  libraryVersions: LibraryResourceVersions;
  createdAt: string;
  issues: ApplyIssue[];
  changes: PlannedFileChange[];
  resourceChanges: PlannedResourceChange[];
  liveFingerprints: Record<string, string>;
  resourceFingerprints: Record<string, string>;
  sourceFingerprints: Record<string, string>;
  sharedSkillPreparations?: SharedSkillPreparation[];
  keptOutsideSkills?: TargetKeptOutsideSkill[];
  sharedSkillPreparationChanged?: boolean;
  targetStateChanged?: boolean;
  targetId: string;
  targetState: TargetState;
  effectivePayload?: EffectiveProfilePayload;
  operation?: "apply" | "takeover";
  skillRootTransition?: {
    path: string;
    linkTarget: string;
    resolvedPath?: string;
  };
  legacySkillPaths?: string[];
}

export interface EffectiveProfilePayload {
  instructions: number;
  skills: number;
  mcpServers: number;
  total: number;
}

export interface LibraryResourceVersions {
  skills: Record<string, string>;
}

export interface BackupEntry {
  sourcePath: string;
  backupPath?: string;
  sha256?: string;
  missing: boolean;
  kind?: "file" | "directory" | "symlink";
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift" | "shared-skill-migration" | "workspace-sync";
  targetId?: string;
  targetIds?: string[];
  profileId?: string;
  profileName?: string;
  entries: BackupEntry[];
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  fileCount: number;
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift" | "shared-skill-migration" | "workspace-sync";
  targetId?: string;
  targetIds?: string[];
  profileId?: string;
  profileName?: string;
}

export type ApplyFailureKind =
  | "blocked"
  | "stale"
  | "busy"
  | "no-op"
  | "failed"
  | "recovery-required";

export type ApplyResult =
  | { ok: true; backupId: string }
  | { ok: false; kind: ApplyFailureKind; errors: string[] };

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
