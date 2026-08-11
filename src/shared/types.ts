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
import type {
  OneShotEvaluationPreview,
  OneShotEvaluationPreviewInput,
  OneShotEvaluationReadInput,
  OneShotEvaluationRun,
  OneShotEvaluationStartInput
} from "./evaluations";
import type { AppUpdateStatus } from "./appUpdates";
import type { TelemetryPreview } from "./telemetry";
import type { UiState, UiStateUpdate } from "./uiState";

export type { UiState, UiStateUpdate } from "./uiState";

export type {
  AppInstallChannel,
  AppUpdatePhase,
  AppUpdateRelease,
  AppUpdateStatus
} from "./appUpdates";
export type {
  TelemetryDailyStartupPayload,
  TelemetryPreview,
  TelemetrySendResult
} from "./telemetry";

export type {
  OneShotEvaluationFidelity,
  OneShotEvaluationFileDiff,
  OneShotEvaluationPreview,
  OneShotEvaluationPreviewInput,
  OneShotEvaluationReadInput,
  OneShotEvaluationResourceScope,
  OneShotEvaluationResult,
  OneShotEvaluationRun,
  OneShotEvaluationStartInput,
  OneShotEvaluationStatus,
  OneShotEvaluationUsage
} from "./evaluations";

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
  readDiagnosticIssue(reference: string): Promise<DiagnosticIssueDetail | undefined>;
  readLatestDiagnosticIssue(): Promise<DiagnosticIssueDetail | undefined>;
  exportDiagnostics(reference?: string): Promise<string | undefined>;
  openDiagnosticsFolder(): Promise<void>;
  readAppUpdateStatus(): Promise<AppUpdateStatus>;
  checkAppUpdate(): Promise<AppUpdateStatus>;
  downloadAppUpdate(): Promise<AppUpdateStatus>;
  installAppUpdate(): Promise<AppUpdateStatus>;
  onAppUpdateStatusChanged(callback: (status: AppUpdateStatus) => void): () => void;
  readTelemetryPreview(): Promise<TelemetryPreview>;
  decideTelemetry(enabled: boolean): Promise<AgentEnvSettings>;
  reportRendererError(input: RendererDiagnosticError): void;
  quitApp(): void;
  onOpenSettingsRequested(callback: () => void): () => void;
  onWindowCloseRequested(callback: () => void): () => void;
  setWindowCloseGuard(enabled: boolean): void;
  confirmWindowClose(): void;
  cancelWindowClose(): void;
  readWindowChromeState(): Promise<WindowChromeState>;
  onWindowChromeStateChanged(callback: (state: WindowChromeState) => void): () => void;
  openContextMenu(items: DesktopContextMenuItem[]): Promise<string | undefined>;
  copyText(text: string): Promise<void>;
  selectSkillFolder(): Promise<string | undefined>;
  selectLocalSkillSource(): Promise<LocalSkillSourceSelection | undefined>;
  releaseSkillArchive(token: string): Promise<void>;
  selectTargetConfigRoot(targetId: string): Promise<string | undefined>;
  selectComparisonWorkspace(): Promise<string | undefined>;
  selectProjectFolder(): Promise<string | undefined>;
  listProjects(): Promise<ProjectSummary[]>;
  findProjectByPath(rootPath: string): Promise<ProjectSummary | undefined>;
  addProject(rootPath: string): Promise<ProjectSummary>;
  updateProject(input: UpdateProjectInput): Promise<ProjectSummary>;
  removeProject(id: string): Promise<void>;
  inspectProject(id: string): Promise<ProjectEnvironmentSnapshot>;
  previewProject(projectId: string, agentId: string): Promise<ProjectEnvironmentPreview>;
  readProjectResource(projectId: string, resourceId: string): Promise<ProjectResourceFile>;
  prepareProjectInstruction(projectId: string, agentId: string): Promise<ProjectInstructionDraft>;
  saveProjectResource(input: SaveProjectResourceInput): Promise<ProjectMutationResult>;
  createProjectInstruction(input: CreateProjectInstructionInput): Promise<ProjectMutationResult>;
  addProjectSkill(input: AddProjectSkillInput): Promise<ProjectMutationResult>;
  removeProjectSkill(input: RemoveProjectSkillInput): Promise<ProjectMutationResult>;
  listProjectRecovery(projectId?: string): Promise<ProjectRecoverySummary[]>;
  restoreProjectRecovery(receiptId: string): Promise<ProjectMutationResult>;
  openProject(projectId: string, agentId: string): Promise<ProjectLaunchResult>;
  listSupportedTargets(): Promise<TargetDescriptor[]>;
  probeSupportedTargets(forceRefresh?: boolean): Promise<TargetInfo[]>;
  listTargets(forceRefresh?: boolean): Promise<TargetInfo[]>;
  listTargetStates(): Promise<TargetManagementState[]>;
  listConversations(input?: ConversationListInput): Promise<ConversationListResult>;
  searchConversations(input: ConversationSearchInput): Promise<ConversationSummary[]>;
  readConversation(id: string, input?: ConversationReadInput): Promise<ConversationDetail>;
  refreshConversations(): Promise<ConversationRefreshResult>;
  openOriginalConversation(id: string): Promise<ConversationLaunchResult>;
  previewConversationContinuation(
    input: ConversationContinueInput
  ): Promise<ConversationContinuationPreview>;
  continueConversation(previewId: string): Promise<ConversationLaunchResult>;
  listNativeMcpConnections(): Promise<NativeMcpInspection>;
  listNativeInstructions?(): Promise<NativeInstructionsInspection>;
  listSkillLibrary(): Promise<SkillLibraryEntry[]>;
  listSkillFiles(id: string): Promise<SkillFileNode[]>;
  readSkillFile(input: SkillFileReadInput): Promise<SkillFileContent>;
  scanSkillInventory(): Promise<SkillInventoryEntry[]>;
  listSkillCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  setUnmanagedSkillLocations(
    input: UnmanagedSkillLocationUpdate
  ): Promise<UnmanagedSkillLocation[]>;
  setSkillCollectionDecision(
    input: SkillCollectionMemberDecisionUpdate
  ): Promise<SkillCollectionMemberDecision[]>;
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
  setSkillSourceCandidateIgnored(
    input: SkillSourceCandidateIgnoreInput
  ): Promise<SkillSourceGroupView>;
  previewSkillSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  mergeSkillSources(previewId: string): Promise<SkillSourceMergeResult>;
  cancelRepositoryOperations(): Promise<void>;
  removeSkillFromLibrary(id: string): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillInput): Promise<void>;
  consolidateSkillGroup(input: SkillCleanupRequest): Promise<SkillCleanupResult>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  setSharedSkillRetention(input: SharedSkillRetentionInput): Promise<void>;
  retireSharedSkill(input: RetireSharedSkillInput): Promise<SkillCleanupResult>;
  retireSkillCollection(input: RetireSkillCollectionInput): Promise<SkillCleanupResult>;
  checkSkillLibraryUpdates(ids?: string[]): Promise<SkillUpdateInfo[]>;
  setSkillUpdateSettings(input: SkillUpdateSettingsInput): Promise<SkillLibraryEntry>;
  setSkillAvailability(input: SkillAvailabilityInput): Promise<SkillLibraryEntry>;
  setSkillIcon(input: SkillIconInput): Promise<SkillLibraryEntry>;
  previewLibrarySkillUpdate(id: string): Promise<SkillUpdatePlan>;
  previewLibrarySkillUpdates(ids: string[]): Promise<SkillUpdatePreviewBatchResult>;
  updateLibrarySkill(input: SkillUpdateConfirmation): Promise<SkillLibraryEntry>;
  readSettings(): Promise<AgentEnvSettings>;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings>;
  readUiState(): Promise<UiState>;
  updateUiState(input: UiStateUpdate): Promise<UiState>;
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
  listProfileRecovery(profileId: string): Promise<ProfileRecoverySummary[]>;
  restoreProfileRecovery(profileId: string, recoveryId: string): Promise<ProfileDetail>;
  restoreAppliedProfile(
    profileId: string,
    targetId: string,
    expectedContentHash: string
  ): Promise<ProfileDetail>;
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
  previewProfileComparison(
    input: OneShotEvaluationPreviewInput
  ): Promise<OneShotEvaluationPreview>;
  startProfileComparison(input: OneShotEvaluationStartInput): Promise<OneShotEvaluationRun>;
  readProfileComparison(input?: OneShotEvaluationReadInput): Promise<OneShotEvaluationRun | undefined>;
  cancelProfileComparison(runId: string): Promise<OneShotEvaluationRun>;
  listBackups(): Promise<BackupSummary[]>;
  listManagedBackups(): Promise<ManagedBackupInventory>;
  previewManagedBackup(input: DeleteManagedBackupInput): Promise<ManagedBackupPreview>;
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

export interface WindowChromeState {
  fullScreen: boolean;
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

export type StartupPhase =
  | "preparing-data"
  | "migrating-data"
  | "upgrading-skills"
  | "recovering-writes"
  | "recovering-sync";

export type StartupStatus =
  | { state: "initializing"; phase?: StartupPhase }
  | { state: "ready" }
  | {
      state: "failed";
      kind: StartupFailureKind;
      title: string;
      message: string;
      dataRoot?: string;
      canRetry: boolean;
    };

export type DiagnosticOutcome =
  | "completed"
  | "no-op"
  | "decision-required"
  | "blocked"
  | "partial"
  | "cancelled"
  | "failed"
  | "rolled-back";

export interface DiagnosticErrorDetail {
  name: string;
  message: string;
  code?: string;
  errno?: string | number;
  stack?: string;
  causes: Array<{
    name: string;
    message: string;
    code?: string;
    errno?: string | number;
    stack?: string;
  }>;
}

export interface DiagnosticEvent {
  schemaVersion: 1;
  at: string;
  reference: string;
  operationId?: string;
  parentOperationId?: string;
  action: string;
  category: string;
  phase: string;
  outcome?: DiagnosticOutcome;
  durationMs?: number;
  context?: Record<string, unknown>;
  error?: DiagnosticErrorDetail;
}

export interface DiagnosticIssueDetail {
  reference: string;
  action: string;
  category: string;
  occurredAt: string;
  durationMs?: number;
  context?: Record<string, unknown>;
  error: DiagnosticErrorDetail;
  events: DiagnosticEvent[];
}

export interface RendererDiagnosticError {
  kind: "error" | "unhandled-rejection" | "react-render-error";
  message: string;
  name?: string;
  stack?: string;
}

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
  delivery?: "context-file" | "clipboard";
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
  sizeBytes?: number;
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
  loadedMessageOffset?: number;
  matchedMessageId?: string;
  messages: ConversationMessage[];
}

export interface ConversationReadInput {
  limit?: number;
  offset?: number;
  tail?: boolean;
  query?: string;
}

export interface ConversationListInput {
  query?: string;
  agentIds?: string[];
  workspacePaths?: string[];
  sort?: ConversationSortOrder;
  limit?: number;
  offset?: number;
}

export type ConversationSortOrder = "recent" | "size-desc" | "messages-desc";

export interface ConversationSearchInput {
  query: string;
  limit?: number;
}

export interface ConversationListResult {
  items: ConversationSummary[];
  total: number;
  workspacePaths?: string[];
  agentCounts?: Record<string, number>;
  refreshRequired?: boolean;
  lastRefreshedAt?: string;
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
  refreshedAt: string;
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
  workspacePath?: string;
  workspacePreservation?: "preserved" | "best-effort";
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
  suggestedDuplicateId: string;
}

export type SkillImportConflictResolution =
  | { action: "reuse"; existingId: string }
  | { action: "keep-existing"; existingId: string }
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
  indexManifest?: SkillIndexManifestResolution;
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
  indexManifestPath?: string;
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
  indexManifest?: SkillIndexManifestResolution;
  truncated: boolean;
  candidates: RepositorySkillCandidate[];
}

export interface SkillIndexManifestResolution {
  path: string;
  requestedDirectory: string;
  resolvedDirectory: string;
}

export interface SkillSourceScope {
  formatVersion: 1;
  kind?: "repository" | "local";
  canonicalLink: string;
  repository: string;
  ref: string;
  directory: string;
  indexManifestPath?: string;
}

export interface SkillSourceCollectionRef extends SkillSourceScope {
  sourceId?: string;
  sourceSubpath: string;
}

export interface SkillSourceRecord extends SkillSourceScope {
  id: string;
  displayName?: string;
  automaticChecks?: boolean;
  ignoredSubpaths?: string[];
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

export interface SkillSourceCandidateIgnoreInput {
  sourceId: string;
  sourceSubpath: string;
  ignored: boolean;
}

export type SkillSourceCandidateState =
  | "current"
  | "update"
  | "new"
  | "ignored"
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
  sourceStatus?: "removed";
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
  sourceStatus?: "removed";
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
  syncCopiedInstalls?: boolean;
}

export type SkillInventoryStatus =
  | "managed"
  | "library"
  | "outside"
  | "left-unmanaged";

export interface SkillInventoryEntry extends UnmanagedSkillEntry {
  status: SkillInventoryStatus;
  canonicalPath?: string;
  version?: string;
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
  unmanagedLocationId?: string;
  unmanagedCoverage?: UnmanagedSkillLocationCoverage;
  collectionDecision?: SkillCollectionMemberDecision["decision"];
  installMethod?: "linked" | "copied";
  contentMatchesLibrary?: boolean;
  externalEvidence?: SkillExternalEvidence;
  locationRole?: TargetSkillLocationRole;
  sharedLocation?: boolean;
  sharedLocationId?: SharedSkillLocationId;
  legacyLocation?: boolean;
  locationManagement?: TargetSkillLocation["management"];
  collectionLink?: SkillCollectionLink;
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
    | "collection-link"
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
  sharedLocationId?: SharedSkillLocationId;
  legacy: boolean;
  externalEvidence?: SkillExternalEvidence;
  collectionLink?: SkillCollectionLink;
  issues: SkillRuntimeIssue[];
}

export interface SkillCollectionLink {
  path: string;
  canonicalPath: string;
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

export interface RetireSkillCollectionInput {
  path: string;
  profileReceipts: Record<string, {
    profileId: string;
    contentHash: string;
  }>;
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
  recoveryRequired?: boolean;
  safetyBackupId?: string;
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

export type UnmanagedSkillLocationCoverage = "exact" | "collection";

export interface UnmanagedSkillLocation {
  id: string;
  path: string;
  targetId?: string;
  coverage: UnmanagedSkillLocationCoverage;
  createdAt: string;
  updatedAt: string;
}

export interface UnmanagedSkillLocationInput {
  path: string;
  targetId?: string;
  coverage?: UnmanagedSkillLocationCoverage;
}

export interface UnmanagedSkillLocationUpdate {
  items: UnmanagedSkillLocationInput[];
  unmanaged: boolean;
}

export interface SkillCollectionMemberDecision {
  id: string;
  path: string;
  decision: "use-library";
  sourceContentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillCollectionMemberDecisionUpdate {
  path: string;
  useLibrary: boolean;
  sourceContentHash?: string;
}

export type SkillDesiredState = "install" | "omit";
export type SkillObservedState = "missing" | "managed" | "external" | "unavailable";
export type SkillManagementAuthority = "agentenv" | "leave-unmanaged";
export type SkillReconciliationAction =
  | "none"
  | "install"
  | "adopt"
  | "replace"
  | "remove"
  | "preserve";
export type SkillReconciliationOutcome =
  | "managed-active"
  | "absent"
  | "external-active"
  | "external-remains";

export interface SkillReconciliationResult {
  libraryId: string;
  targetName: string;
  path?: string;
  desired: SkillDesiredState;
  observed: SkillObservedState;
  authority: SkillManagementAuthority;
  action: SkillReconciliationAction;
  outcome: SkillReconciliationOutcome;
  requiresReview: boolean;
  localOverride: boolean;
  policyId?: string;
  contentHash?: string;
}

export interface AppliedSkillReceipt {
  libraryId: string;
  targetName: string;
  path?: string;
  desired: SkillDesiredState;
  observed: SkillObservedState;
  authority: SkillManagementAuthority;
  action: SkillReconciliationAction;
  outcome: SkillReconciliationOutcome;
  requiresReview: boolean;
  localOverride: boolean;
  policyId?: string;
  contentHash?: string;
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

export interface NativeInstructionSnapshot {
  targetId: string;
  targetName: string;
  path: string;
  content: string;
}

export interface NativeInstructionsInspectionIssue {
  targetId: string;
  targetName: string;
  path: string;
  message: string;
}

export interface NativeInstructionsInspection {
  snapshots: NativeInstructionSnapshot[];
  issues: NativeInstructionsInspectionIssue[];
}

export interface AgentEnvSettings {
  locale: AppLocale;
  conversationTerminal: "default" | "ghostty";
  skillSyncMethod: SkillSyncMethod;
  skillDeploymentPreferenceVersion?: 1;
  skillDeploymentReviewPending?: boolean;
  skillStorageLocation: SkillStorageLocation;
  skillAutoCheckEnabled: boolean;
  skillAutoCheckIntervalMinutes: number;
  appUpdateAutoCheckEnabled?: boolean;
  appUpdateAutoDownloadEnabled?: boolean;
  appUpdateInstallOnQuit?: boolean;
  telemetryEnabled?: boolean;
  telemetryConsentVersion?: 1;
  backupRetentionDays: BackupRetentionDays;
  enabledTargetIds?: string[];
  agentDiscoveryVersion?: number;
  agentDiscoveryReviewedIds?: string[];
  suppressedAgentSuggestionIds?: string[];
  targetConfigRoots?: Record<string, string>;
  targetCommandOverrides?: Record<string, string>;
}

export interface ProjectReference {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt?: string;
  lastAgentId?: string;
}

export interface ProjectSummary extends ProjectReference {
  exists: boolean;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  lastAgentId?: string;
  markOpened?: boolean;
}

export type ProjectResourceKind = "instructions" | "skill" | "mcp";
export type ProjectResourceState = "ready" | "partial" | "unsafe" | "unreadable";
export type ProjectGitPathState =
  | "tracked-clean"
  | "tracked-modified"
  | "untracked"
  | "ignored"
  | "unavailable";

export interface ProjectGitObservation {
  repository: "git" | "not-git" | "unavailable";
  rootRelation?: "workspace-root" | "workspace-inside-repository" | "repository-inside-workspace";
  pathStates: Record<string, ProjectGitPathState>;
  issue?: string;
}

export interface ProjectResourceSummary {
  id: string;
  kind: ProjectResourceKind;
  name: string;
  relativePath: string;
  absolutePath: string;
  consumerAgentIds: string[];
  state: ProjectResourceState;
  editable: boolean;
  description?: string;
  version?: string;
  contentHash?: string;
  modifiedAt?: string;
  issue?: string;
  gitState?: ProjectGitPathState;
}

export interface ProjectEnvironmentSnapshot {
  projectId: string;
  projectRoot: string;
  resources: ProjectResourceSummary[];
  skillLocations: ProjectSkillLocationSummary[];
  agentSupport: Array<{
    agentId: string;
    agentName: string;
    instructions: { inspect: string; mutate: string };
    instructionCreateFile?: string;
    skills: { inspect: string; mutate: string };
    mcp: { inspect: string; mutate: string };
    effectivePreview: string;
    cliLaunch: string;
  }>;
  issues: string[];
  partial: boolean;
  git: ProjectGitObservation;
}

export interface ProjectSkillLocationSummary {
  id: string;
  relativePath: string;
  scope: "shared" | "agent-specific";
  consumerAgentIds: string[];
  writable: boolean;
  recommended: boolean;
}

export interface ProjectEnvironmentPreview {
  projectId: string;
  agentId: string;
  agentName: string;
  fidelity: "full" | "partial";
  loadOrder: "known" | "unknown";
  projectResources: ProjectResourceSummary[];
  globalResources: Array<{
    kind: ProjectResourceKind;
    name: string;
    path: string;
    state: ProjectResourceState;
    detail?: string;
  }>;
  issues: string[];
}

export interface ProjectLaunchResult {
  agentId: string;
  agentName: string;
  message: string;
}

export interface ProjectResourceFile {
  resourceId: string;
  name: string;
  path: string;
  content: string;
  contentHash: string;
  modifiedAt: string;
  editable: boolean;
  gitState?: ProjectGitPathState;
}

export interface ProjectInstructionDraft {
  agentId: string;
  name: string;
  path: string;
  content: "";
  contentHash: "absent";
  modifiedAt?: undefined;
  editable: true;
}

export interface SaveProjectResourceInput {
  projectId: string;
  resourceId: string;
  expectedHash: string;
  content: string;
}

export interface CreateProjectInstructionInput {
  projectId: string;
  agentId: string;
  content: string;
}

export interface AddProjectSkillInput {
  projectId: string;
  locationId: string;
  libraryId: string;
  conflictResolution?: "replace";
}

export interface RemoveProjectSkillInput {
  projectId: string;
  resourceId: string;
  expectedHash: string;
}

export interface ProjectMutationResult {
  status: "saved" | "restored" | "no-op";
  contentHash: string;
  receiptId?: string;
}

export interface ProjectRecoverySummary {
  id: string;
  projectId: string;
  resourceId: string;
  path: string;
  createdAt: string;
  status: "committed" | "failed-restored" | "recovery-required" | "restored";
  kind: "instructions" | "skill";
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

export interface ManagedBackupFile {
  kind?: "directory" | "file";
  path: string;
  state: "saved" | "missing";
}

export interface ManagedBackupPreview {
  id: string;
  kind: ManagedBackupKind;
  files: ManagedBackupFile[];
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
  decisions?: TargetCaptureDecision[];
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

export interface TargetCaptureSkillCandidate {
  id: string;
  path: string;
  canonicalPath: string;
  version?: string;
  contentHash: string;
  modifiedAt?: string;
  locationRole?: TargetSkillLocationRole;
  shared: boolean;
  sharedLocationId?: SharedSkillLocationId;
  collectionPath?: string;
  libraryId?: string;
  libraryMatch?: "identical" | "same-name";
  comparisonBaseId?: string;
  comparisonChanges?: PlannedFileChange[];
}

export interface TargetCaptureIssue {
  id: string;
  code: "conflicting-skill-copies";
  severity: "decision";
  skillName: string;
  message: string;
  diagnosticReference?: string;
  candidates: TargetCaptureSkillCandidate[];
}

export type TargetCaptureDecision =
  | {
      issueId: string;
      action: "use-copy";
      candidateId: string;
    }
  | {
      issueId: string;
      action: "keep-outside";
    };

export interface TargetCapturePreview {
  id: string;
  targetId: string;
  targetName: string;
  scope: TargetCaptureScope;
  suggestedName: string;
  createdAt: string;
  resources: TargetCaptureResource[];
  issues: TargetCaptureIssue[];
  warnings: string[];
  errors: string[];
  blockingDiagnosticReference?: string;
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
  instructionsLabel: string;
  configLabel: string;
  configLanguage: "json" | "jsonc" | "toml" | "yaml" | "text";
  mcpConfigKey?: string;
  realWritesEnabled: boolean;
  executableName?: string;
  executableCandidates: string[];
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
  evaluation?: boolean;
  evaluationUnavailableReason?: string;
}

export interface TargetPaths {
  targetId: string;
  configDir: string;
  runtimeDir?: string;
  instructionsPath: string;
  instructionsOverridePath?: string;
  configPath: string;
  mcpConfigPath?: string;
  agentsDir?: string;
  skillsDir?: string;
  skillScanDirs?: string[];
  skillLocations?: TargetSkillLocation[];
  sharedSkillLocationIds?: SharedSkillLocationId[];
}

export type SharedSkillLocationId = "agents-skills";

export type TargetSkillLocationRole =
  | "preferred-runtime"
  | "alternate-runtime"
  | "compatibility-runtime"
  | "discovery-only";

export interface TargetSkillLocation {
  path: string;
  role: TargetSkillLocationRole;
  shared: boolean;
  sharedLocationId?: SharedSkillLocationId;
  scope?: SkillRuntimeScope;
  scanDepth?: SkillScanDepth;
  management?: "managed" | "observed" | "legacy" | "migration-only";
  externalContainerMarkers?: TargetSkillExternalContainerMarker[];
}

export interface TargetSkillExternalContainerMarker {
  relativePath: string;
  manager: SkillExternalEvidence["manager"];
  displayName: string;
  importable: boolean;
}

export interface TargetState {
  formatVersion?: 2 | 3;
  managedMcpNames: string[];
  activeProfileId?: string;
  appliedProfileHash?: string;
  appliedProfileSnapshot?: AppliedProfileSnapshot;
  appliedLibraryVersions?: LibraryResourceVersions;
  lastAppliedAt?: string;
  managedResources?: ManagedResourceSnapshot[];
  skillReceipts?: AppliedSkillReceipt[];
  /** Read-only migration input from Target State v2. */
  keptOutsideSkills?: LegacyTargetKeptOutsideSkill[];
  sharedSkillPreparations?: SharedSkillPreparation[];
  recoveryRequired?: TargetRecoveryState;
}

export interface AppliedProfileSnapshot {
  profileId: string;
  profileName: string;
  capturedAt: string;
  contentHash: string;
  snapshotHash: string;
  manifest: ProfileManifest;
  instructions: string;
  resources: ProfileResources;
}

export interface LegacyTargetKeptOutsideSkill {
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
  | "applied-with-local-override"
  | "pending"
  | "drifted"
  | "recovery-required";

export interface TargetRecoveryState {
  operation: "apply" | "rollback";
  error: string;
  backupId?: string;
  safetyBackupId?: string;
  occurredAt: string;
}

export interface TargetManagementState {
  targetId: string;
  activeProfileId?: string;
  activeProfileName?: string;
  appliedProfileHash?: string;
  appliedProfileSnapshot?: AppliedProfileSnapshotSummary;
  appliedLibraryVersions?: LibraryResourceVersions;
  status: TargetManagementStatus;
  lifecycleStatus: TargetLifecycleStatus;
  lifecycleReason?: string;
  lastAppliedAt?: string;
  managedResourceCount: number;
  skillReceipts?: AppliedSkillReceipt[];
  localOverrideCount?: number;
  sharedSkillPreparations?: SharedSkillPreparation[];
  warningCount: number;
  errorCount: number;
}

export interface AppliedProfileSnapshotSummary {
  profileId: string;
  profileName: string;
  capturedAt: string;
  contentHash: string;
  instructionsLength: number;
  skillCount: number;
  mcpCount: number;
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
  /** How the resource is materialized at the Agent path. */
  materialization?: "copy" | "link";
  /** How AgentEnv first obtained authority over the Agent path. */
  origin?: "adopted" | "created" | "replaced" | "unknown";
  /** @deprecated Read-only compatibility with Target state written before 0.1.7. */
  deploymentMode?: "adopted" | "linked" | "copied";
  /** @deprecated Read-only compatibility with Target state written before 0.1.7. */
  createdByAgentEnv?: boolean;
}

export type TargetHealthStatus = "ready" | "needs-setup" | "missing" | "guarded" | "unknown";

export type TargetExecutableStatus = "found" | "missing" | "unknown";

export interface TargetPathCheck {
  id:
    | "configDir"
    | "runtimeDir"
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
  executableCandidates: string[];
  executableStatus: TargetExecutableStatus;
  executableCandidate?: string;
  executableOverride?: string;
  executableError?: string;
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
  expectedContentHash?: string;
}

export interface ProfileRecoverySummary {
  id: string;
  profileId: string;
  profileName: string;
  createdAt: string;
  contentHash: string;
  instructionsLength: number;
  skillCount: number;
  mcpCount: number;
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
  expectedContentHash: string;
  name?: string;
  description?: string;
  iconKey?: ResourceIconKey;
}

export interface PlannedFileChange {
  path: string;
  before: string;
  after: string;
  diff: string;
  action?: "write" | "remove";
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
  | "preserve"
  | "review-local-skills";

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
  | "runtime-reload-required"
  | "duplicate-native-mcp"
  | "agent-owned-native-mcp"
  | "unsafe-native-mcp-update"
  | "globally-disabled-skill"
  | "missing-library-skill"
  | "outside-skill-replacement"
  | "outside-skill-removal"
  | "unmanaged-skill-location"
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
  skillReceipts?: AppliedSkillReceipt[];
  sharedSkillPreparationChanged?: boolean;
  targetStateChanged?: boolean;
  targetId: string;
  targetState: TargetState;
  effectivePayload?: EffectiveProfilePayload;
  localFootprint?: {
    adopted: number;
    modified: number;
    created: number;
    removed: number;
    liveLinks: number;
  };
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
  linkTarget?: string;
  linkType?: "file" | "dir" | "junction";
  sha256?: string;
  mode?: number;
  missing: boolean;
  kind?: "file" | "directory" | "symlink";
}

export interface BackupManifest {
  formatVersion: 2;
  id: string;
  createdAt: string;
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift" | "shared-skill-migration" | "workspace-sync" | "rollback-safety";
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
  operation?: "apply" | "stop-managing" | "data-import" | "adopt-drift" | "shared-skill-migration" | "workspace-sync" | "rollback-safety";
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
