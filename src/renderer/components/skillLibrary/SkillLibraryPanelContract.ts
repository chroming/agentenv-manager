import type { RefObject } from "react";
import type {
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  LocalSkillSourceSelection,
  ManageTargetSkillInput,
  ProjectSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillAvailabilityInput,
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
  SkillCollectionMemberDecisionUpdate,
  SkillFileContent,
  SkillFileNode,
  SkillIconInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillMergeInput,
  SkillMergePreview,
  SkillSourceCandidateIgnoreInput,
  SkillSourceCollectionRef,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillSourceNameInput,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput,
  SkillUpstream,
  UnmanagedSkillLocationUpdate
} from "../../../shared/types";
import type { SkillCollectionLinkGroup } from "../../../shared/skillCleanup";
import type { SkillLibraryViewState } from "../../libraryViewState";
import type { SkillUpdateActivity } from "../../skillUpdateActivity";
import type { SkillUpdateRun } from "../../skillUpdateQueue";
import type { TargetNameIndex } from "../../targetPresentation";
import type {
  PreparedSkillTarget,
  SkillImportQueueOptions
} from "../../skillLibraryContracts";
import type { CollectionResolutionStrategy } from "../SkillCollectionCleanup";
import type {
  MoveSkillCollectionOptions,
  MoveSkillCollectionOutcome
} from "../../skillCollectionMigrationAction";

export interface SkillLibraryPanelModel {
  status: {
    isLoading?: boolean;
    isBusy?: boolean;
    isRefreshingInventory?: boolean;
  };
  catalog: {
    librarySkills: SkillLibraryEntry[];
    skillUpdates: SkillUpdateInfo[];
    skillUsage: Record<string, string[]>;
    installedTargetIds?: string[];
    targetNames?: TargetNameIndex;
    preparedTargetsBySkill?: Record<string, PreparedSkillTarget[]>;
  };
  sources: {
    sourceGroups: SkillSourceGroupView[];
    sourceGroupsLoading?: boolean;
    libraryMode: "skills" | "sources";
  };
  cleanup: {
    skillInventory: SkillInventoryEntry[];
    cleanupBackups: SkillCleanupBackupSummary[];
    cleanupScope?: "all" | "shared";
    focusCollectionPath?: string;
  };
  updates: {
    selectedUpdatePlan?: SkillUpdatePlan;
    bulkUpdatePlans?: SkillUpdatePlan[];
    bulkUpdateFailures?: SkillUpdatePreviewBatchResult["failed"];
    updateRun?: SkillUpdateRun;
    bulkUpdateStopRequested?: boolean;
    updateActivity?: SkillUpdateActivity;
  };
  workspace: {
    activeTool?: "import" | "discoveries";
    importConflictOpen?: boolean;
  };
  view: {
    viewState: SkillLibraryViewState;
    searchInputRef?: RefObject<HTMLInputElement | null>;
  };
}

export interface SkillLibraryPanelActions {
  navigation: {
    onCloseTool?(): void;
    onFocusCollectionHandled?(): void;
    onLibraryModeChange(mode: "skills" | "sources"): void;
    onViewStateChange(next: SkillLibraryViewState): void;
    scrollOwnerRef?(node: HTMLDivElement | null): void;
  };
  inventory: {
    onRefreshInventory(announce?: boolean): Promise<void>;
    onSelectLocalSkillSource(): Promise<LocalSkillSourceSelection | undefined>;
    onReleaseSkillArchive(token: string): Promise<void>;
    onScanLocalSkillSource?(rootPath: string): Promise<ProjectSkillScanResult>;
    onImportUnmanaged(
      sourcePath: string,
      sourceHandling?: "copy-only",
      deferFullRefresh?: boolean
    ): Promise<boolean>;
    onResolveCollectionConflict?(
      item: SkillInventoryEntry,
      strategy?: CollectionResolutionStrategy,
      deferFullRefresh?: boolean
    ): Promise<boolean>;
    onImportLocalSourceSkill?(
      sourcePath: string,
      sourceCollection?: SkillSourceCollectionRef,
      upstream?: SkillUpstream
    ): Promise<boolean>;
    onImportExternal(skill: SkillInventoryEntry): Promise<boolean>;
    onManageTargetSkill(input: ManageTargetSkillInput): void;
    onConsolidateSkillGroup(input: SkillCleanupRequest): Promise<boolean>;
    onAutoConsolidateSkillGroups(inputs: SkillCleanupRequest[]): Promise<string[]>;
    onCopyCleanupDetails(details: string): Promise<boolean>;
    onLeaveSkillGroupUnmanaged(skillKey: string): void;
    onManageSkillGroupWithAgentEnv(skillKey: string): void;
    onSetUnmanagedSkillLocations?(
      input: UnmanagedSkillLocationUpdate
    ): Promise<boolean>;
    onSetSkillCollectionDecision?(
      input: SkillCollectionMemberDecisionUpdate
    ): Promise<boolean>;
    onSetSharedSkillRetention(input: SharedSkillRetentionInput): Promise<boolean>;
    onRetireSharedSkill(input: RetireSharedSkillInput): Promise<boolean>;
    onMoveSharedSkillToAgents(
      input: RetireSharedSkillInput,
      targetIds: string[]
    ): Promise<boolean>;
    onMoveSkillCollection?(
      collection: SkillCollectionLinkGroup,
      options?: MoveSkillCollectionOptions
    ): Promise<MoveSkillCollectionOutcome>;
    onRestoreCleanup(backupId: string): void;
  };
  files: {
    onListSkillFiles(id: string): Promise<SkillFileNode[]>;
    onReadSkillFile(id: string, path: string): Promise<SkillFileContent>;
  };
  repository: {
    onScanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
    onImportGitHubSkills(
      inputs: GitHubSkillImportInput[],
      options?: SkillImportQueueOptions
    ): Promise<GitHubSkillImportResult>;
    onScanRepositorySkills(input: RepositorySkillSourceInput): Promise<RepositorySkillScanResult>;
    onImportRepositorySkills(
      inputs: RepositorySkillImportInput[],
      options?: SkillImportQueueOptions
    ): Promise<RepositorySkillImportResult>;
    onCancelRepositoryOperations(): Promise<void>;
  };
  sources: {
    onCheckSourceGroup(sourceId: string): Promise<void>;
    onCheckMonitoredSourceGroups(): Promise<void>;
    onSetSourceName(input: SkillSourceNameInput): Promise<void>;
    onSetSourceMonitored?(sourceId: string, enabled: boolean): Promise<void>;
    onSetSourceCandidateIgnored?(
      input: SkillSourceCandidateIgnoreInput
    ): Promise<void>;
    onPreviewSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
    onMergeSources(previewId: string): Promise<SkillSourceMergeResult>;
  };
  catalog: {
    onSaveUpdateSettings(change: SkillUpdateSettingsInput): Promise<boolean>;
    onSetAvailability(input: SkillAvailabilityInput): Promise<boolean>;
    onSetIcon(input: SkillIconInput): void;
    onSyncSkillInstalls(id: string): void;
    onRemoveLibrarySkill(id: string): void;
    onPreviewSkillMerge(id: string): Promise<SkillMergePreview>;
    onMergeLibrarySkills(input: SkillMergeInput): Promise<boolean>;
    onReviewSkillUsage(id: string): void;
    onOpenSource(url: string): void;
    onCopySource(source: string): void;
  };
  updates: {
    onPreviewLibrarySkillUpdate(id: string): Promise<void>;
    onCloseUpdatePreview(): void;
    onUpdateLibrarySkill(plan: SkillUpdatePlan): void;
    onUpdateAllLibrarySkills(plans: SkillUpdatePlan[]): void;
    onStopBulkLibrarySkillUpdates?(): void;
    onPreviewAllLibrarySkillUpdates(ids: string[]): Promise<void>;
    onCloseBulkUpdatePreview(): void;
    onCheckUpdates(): void;
  };
}
