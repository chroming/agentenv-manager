import type {
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  ManagedBackupFile,
  ProjectSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  SharedSkillRetentionInput,
  SharedSkillAreaMode,
  SharedSkillAreaState,
  SkillAvailabilityInput,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillCollectionMemberDecision,
  SkillCollectionMemberDecisionUpdate,
  SkillIconInput,
  SkillImportInput,
  SkillImportPreview,
  SkillImportPreviewInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillMergeInput,
  SkillMergePreview,
  SkillMergeResult,
  SkillSourceCheckAllResult,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillSourceType,
  SkillUpdateConfirmation,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdatePolicyInput,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput,
  SkillUpdateSourceInput,
  TargetPaths,
  UnmanagedSkillEntry,
  UnmanagedSkillLocation,
  UnmanagedSkillLocationUpdate
} from "../shared/types";

export interface ImportSkillStoreInput extends SkillImportInput {
  sourceType?: SkillSourceType;
}

export interface ManageTargetSkillStoreInput {
  targetPaths: TargetPaths;
  targetName: string;
  libraryId: string;
}

export interface DeployLibrarySkillStoreInput extends ManageTargetSkillStoreInput {
  profileId: string;
}

export interface ConsolidateSkillGroupStoreInput {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  replaceLibrary?: boolean;
  locations: Array<{
    targetPaths: TargetPaths;
    targetDir: string;
    legacyOwnershipMarkerPaths?: string[];
  }>;
}

export interface ConsolidateSharedSkillGroupStoreInput {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  replaceLibrary?: boolean;
  sharedPaths: string[];
  duplicatePaths: string[];
}

export interface RemoveUnavailableSkillLinksStoreInput {
  skillKey: string;
  locations: Array<{ targetPaths: TargetPaths; targetDir: string }>;
}

export interface SkillLibraryStore {
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanInventory(targetPaths: TargetPaths[], librarySkills?: SkillLibraryEntry[]): Promise<SkillInventoryEntry[]>;
  findManagedInstallPaths(libraryId: string, targetPaths: TargetPaths[]): Promise<string[]>;
  listCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  previewCleanupBackup(id: string): Promise<ManagedBackupFile[]>;
  recoverInterruptedCleanupBackups(): Promise<import("./skillCleanupBackupStore").SkillCleanupRecoveryResult>;
  listPendingCleanupRecoveries(): Promise<string[]>;
  setUnmanagedSkillLocations(input: UnmanagedSkillLocationUpdate): Promise<UnmanagedSkillLocation[]>;
  setSkillCollectionDecision(input: SkillCollectionMemberDecisionUpdate): Promise<SkillCollectionMemberDecision[]>;
  scanUnmanaged(targetPaths: TargetPaths[]): Promise<UnmanagedSkillEntry[]>;
  scanLocalSkillSource(rootPath: string): Promise<ProjectSkillScanResult>;
  previewImport(input: SkillImportPreviewInput): Promise<SkillImportPreview>;
  previewMerge(id: string, targetPaths: TargetPaths[]): Promise<SkillMergePreview>;
  mergeSkills(input: SkillMergeInput, targetPaths: TargetPaths[]): Promise<SkillMergeResult>;
  importSkill(input: ImportSkillStoreInput): Promise<SkillLibraryEntry>;
  importGitHubSkill(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  scanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  importGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  scanRepositorySkills(input: RepositorySkillSourceInput): Promise<RepositorySkillScanResult>;
  importRepositorySkill(input: RepositorySkillImportInput): Promise<SkillLibraryEntry>;
  importRepositorySkills(inputs: RepositorySkillImportInput[]): Promise<RepositorySkillImportResult>;
  listSourceGroups(): Promise<SkillSourceGroupView[]>;
  checkSourceGroup(canonicalLink: string): Promise<SkillSourceGroupView>;
  checkMonitoredSourceGroups(): Promise<SkillSourceCheckAllResult>;
  setSourceName(input: import("../shared/types").SkillSourceNameInput): Promise<SkillSourceGroupView>;
  setSourceMonitored(input: import("../shared/types").SkillSourceMonitoringInput): Promise<SkillSourceGroupView>;
  setSourceCandidateIgnored(input: import("../shared/types").SkillSourceCandidateIgnoreInput): Promise<SkillSourceGroupView>;
  previewSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  mergeSources(previewId: string): Promise<SkillSourceMergeResult>;
  removeSkill(id: string, managedInstallPaths?: string[]): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillStoreInput): Promise<void>;
  deployLibrarySkill(input: DeployLibrarySkillStoreInput): Promise<void>;
  consolidateSkillGroup(input: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult>;
  removeUnavailableSkillLinks(input: RemoveUnavailableSkillLinksStoreInput): Promise<SkillCleanupResult>;
  consolidateSharedSkillGroup(input: ConsolidateSharedSkillGroupStoreInput): Promise<SkillCleanupResult>;
  setSharedSkillRetention(input: SharedSkillRetentionInput): Promise<void>;
  readSharedSkillAreaState(): Promise<SharedSkillAreaState>;
  setSharedSkillAreaMode(mode: SharedSkillAreaMode): Promise<SharedSkillAreaState>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  deleteCleanupBackup(backupId: string): Promise<void>;
  checkUpdates(ids?: string[]): Promise<SkillUpdateInfo[]>;
  setUpdateSource(input: SkillUpdateSourceInput): Promise<SkillLibraryEntry>;
  setUpdatePolicy(input: SkillUpdatePolicyInput): Promise<SkillLibraryEntry>;
  setUpdateSettings(input: SkillUpdateSettingsInput): Promise<SkillLibraryEntry>;
  setAvailability(input: SkillAvailabilityInput): Promise<SkillLibraryEntry>;
  setIcon(input: SkillIconInput): Promise<SkillLibraryEntry>;
  previewUpdate(id: string): Promise<SkillUpdatePlan>;
  previewUpdates(ids: string[]): Promise<SkillUpdatePreviewBatchResult>;
  updateSkill(input: SkillUpdateConfirmation): Promise<SkillLibraryEntry>;
}
