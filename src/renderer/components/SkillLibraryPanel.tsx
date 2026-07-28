import {
  Fragment,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleArrowUp,
  CircleSlash2,
  Combine,
  Copy,
  Download,
  ExternalLink,
  Folder,
  GitBranch,
  Link2Off,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  SearchCheck,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
  XCircle
} from "lucide-react";
import { createPortal } from "react-dom";
import { useModalDialog } from "../hooks/useModalDialog";
import { useRepositoryImportDraft } from "../hooks/useRepositoryImportDraft";
import type {
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  LocalSkillSourceSelection,
  ProjectSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
  SkillFileContent,
  SkillFileNode,
  SkillAvailabilityInput,
  SkillInventoryEntry,
  SkillIconInput,
  SkillLibraryEntry,
  SkillSourceGroupCandidate,
  SkillSourceCandidateIgnoreInput,
  SkillSourceGroupView,
  SkillSourceCollectionRef,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillMergeInput,
  SkillMergePreview,
  SkillPathPolicyUpdate,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput
} from "../../shared/types";
import { InfoTip } from "./InfoTip";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { ResourceIconPicker } from "./ResourceIconPicker";
import { SkillUpdateDialog } from "./SkillUpdateDialog";
import { DiffViewer } from "./DiffViewer";
import {
  matchesSkillStatusFilter,
  matchesSkillUsageFilter,
  type SkillLibraryViewState,
  type SkillSourceResultFilter,
  type SkillSourceScopeFilter,
  updateSkillLibraryControls
} from "../libraryViewState";
import {
  automaticSkillCleanupRequest,
  buildSkillCleanupGroups,
  isSkillCleanupPreparationCurrent,
  type SkillCleanupAutomaticEffect,
  type SkillCleanupDisplayState,
  type SkillCleanupRecommendedAction
} from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { ActionMenu, Button, IconButton, ModalFrame, Switch } from "./ui";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { isExternalSkillImportable } from "../../shared/skillIdentity";
import { sourceSubpathFor } from "../../shared/skillSourceGrouping";
import { SkillSourceView } from "./SkillSourceView";
import { ProjectSkillDiscoveryPanel } from "./ProjectSkillDiscoveryPanel";
import type { SkillUpdateActivity } from "../skillUpdateActivity";
import type { SkillUpdateRun } from "../skillUpdateQueue";
import { SkillFileBrowserDialog } from "./SkillFileBrowserDialog";
import {
  SkillUpdateSettingsDialog
} from "./SkillUpdateSettingsDialog";
import { CleanupBucketHeader } from "./CleanupBucketHeader";
import { BulkSkillUpdateDialog } from "./BulkSkillUpdateDialog";

export type SkillUpdateCheckStatus = {
  state: "checking" | "success" | "error" | "info";
  message: string;
};

export type GitHubSkillImportItemStatus =
  | "waiting"
  | "reviewing"
  | "importing"
  | "imported"
  | "failed"
  | "skipped";

export interface GitHubSkillImportProgress {
  sourceUrl: string;
  status: GitHubSkillImportItemStatus;
  error?: string;
}

export interface SkillImportQueueOptions {
  onProgress?: (progress: GitHubSkillImportProgress) => void;
  shouldStop?: () => boolean;
}

export const repositoryImportProgressKey = (
  input: Pick<RepositorySkillImportInput, "repository" | "ref" | "directory">
) => `${input.repository}\0${input.ref ?? ""}\0${input.directory ?? ""}`;

export interface PreparedSkillTarget {
  targetId: string;
  targetName: string;
  disposition: "install" | "omit";
  libraryId: string;
  sharedPaths: string[];
}

type SkillMenuAction = "update" | "availability" | "settings" | "merge" | "remove";

interface SkillLibraryPanelProps {
  isLoading?: boolean;
  isBusy?: boolean;
  librarySkills: SkillLibraryEntry[];
  sourceGroups: SkillSourceGroupView[];
  sourceGroupsLoading?: boolean;
  libraryMode: "skills" | "sources";
  skillUpdates: SkillUpdateInfo[];
  skillInventory: SkillInventoryEntry[];
  cleanupBackups: SkillCleanupBackupSummary[];
  selectedUpdatePlan?: SkillUpdatePlan;
  bulkUpdatePlans?: SkillUpdatePlan[];
  bulkUpdateFailures?: SkillUpdatePreviewBatchResult["failed"];
  updateRun?: SkillUpdateRun;
  skillUsage: Record<string, string[]>;
  installedTargetIds?: string[];
  targetNames?: TargetNameIndex;
  preparedTargetsBySkill?: Record<string, PreparedSkillTarget[]>;
  activeTool?: "import" | "discoveries";
  isRefreshingInventory?: boolean;
  onCloseTool?(): void;
  onRefreshInventory(announce?: boolean): Promise<void>;
  onSelectLocalSkillSource(): Promise<LocalSkillSourceSelection | undefined>;
  onReleaseSkillArchive(token: string): Promise<void>;
  onScanLocalSkillSource?(rootPath: string): Promise<ProjectSkillScanResult>;
  onImportUnmanaged(sourcePath: string): Promise<boolean>;
  onImportLocalSourceSkill?(
    sourcePath: string,
    sourceCollection?: SkillSourceCollectionRef,
    upstream?: import("../../shared/types").SkillUpstream
  ): Promise<boolean>;
  onListSkillFiles(id: string): Promise<SkillFileNode[]>;
  onReadSkillFile(id: string, path: string): Promise<SkillFileContent>;
  onImportExternal(skill: SkillInventoryEntry): Promise<boolean>;
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
  onLibraryModeChange(mode: "skills" | "sources"): void;
  onCheckSourceGroup(sourceId: string): Promise<void>;
  onCheckMonitoredSourceGroups(): Promise<void>;
  onSetSourceName(input: SkillSourceNameInput): Promise<void>;
  onSetSourceMonitored?(sourceId: string, enabled: boolean): Promise<void>;
  onSetSourceCandidateIgnored?(
    input: SkillSourceCandidateIgnoreInput
  ): Promise<void>;
  onPreviewSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  onMergeSources(previewId: string): Promise<SkillSourceMergeResult>;
  onCancelRepositoryOperations(): Promise<void>;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onConsolidateSkillGroup(input: SkillCleanupRequest): Promise<boolean>;
  onAutoConsolidateSkillGroups(inputs: SkillCleanupRequest[]): Promise<void>;
  onSaveUpdateSettings(change: SkillUpdateSettingsInput): Promise<boolean>;
  onSetAvailability(input: SkillAvailabilityInput): Promise<boolean>;
  onSetIcon(input: SkillIconInput): void;
  onPreviewLibrarySkillUpdate(id: string): Promise<void>;
  onCloseUpdatePreview(): void;
  onUpdateLibrarySkill(plan: SkillUpdatePlan): void;
  onUpdateAllLibrarySkills(plans: SkillUpdatePlan[]): void;
  onPreviewAllLibrarySkillUpdates(ids: string[]): Promise<void>;
  onCloseBulkUpdatePreview(): void;
  onSyncSkillInstalls(id: string): void;
  onRemoveLibrarySkill(id: string): void;
  onPreviewSkillMerge(id: string): Promise<SkillMergePreview>;
  onMergeLibrarySkills(input: SkillMergeInput): Promise<boolean>;
  onReviewSkillUsage(id: string): void;
  onCheckUpdates(): void;
  onOpenSource(url: string): void;
  onCopySource(source: string): void;
  onKeepSkillGroupOutside(skillKey: string): void;
  onReviewSkillGroupAgain(skillKey: string): void;
  onSetSkillPathPolicies?(input: SkillPathPolicyUpdate): Promise<boolean>;
  onSetSharedSkillRetention(input: SharedSkillRetentionInput): Promise<boolean>;
  onRetireSharedSkill(input: RetireSharedSkillInput): Promise<boolean>;
  onOpenProfiles(): void;
  onRestoreCleanup(backupId: string): void;
  updateActivity?: SkillUpdateActivity;
  viewState: SkillLibraryViewState;
  onViewStateChange(next: SkillLibraryViewState): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  scrollOwnerRef?(node: HTMLDivElement | null): void;
  importConflictOpen?: boolean;
}

const sourceLabel = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "github") {
    return skill.source ?? "GitHub source";
  }
  if (skill.sourceType === "local") {
    return skill.source ?? skill.path;
  }
  if (skill.sourceType === "git" && skill.source) {
    const scope = [skill.remoteRef, skill.upstream?.subpath].filter(Boolean).join(":");
    return scope ? `${skill.source}#${scope}` : skill.source;
  }
  return skill.source ?? skill.sourceType;
};

const shortRevision = (skill: SkillLibraryEntry) =>
  (skill.remoteRevision ?? skill.contentHash ?? "local").slice(0, 7);

const sourceName = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "local" && !skill.source) {
    return "Local import";
  }
  if (skill.sourceType === "local") {
    return "Local folder";
  }
  const source = sourceLabel(skill);
  if (source.startsWith("https://github.com/")) {
    return source.replace("https://github.com/", "").replace("/tree/", "/");
  }
  if (skill.sourceType === "git" && skill.source) {
    let repository = skill.source;
    try {
      const url = new URL(repository);
      repository = `${url.hostname}${url.pathname}`;
    } catch {
      const scpLike = repository.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
      if (scpLike) {
        repository = `${scpLike[1]}/${scpLike[2]}`;
      }
    }
    repository = repository.replace(/\.git$/, "").replace(/^\/+/, "");
    return [repository, skill.upstream?.subpath].filter(Boolean).join("/");
  }
  return source;
};

const cleanupLocationLabel = (
  item: SkillInventoryEntry,
  targetNames: TargetNameIndex
) => {
  const names = item.foundIn.map((targetId) =>
    targetNameFor(targetId, targetNames, "Unknown Agent")
  );
  if (names.length > 1) {
    return `Shared: ${names.join(" + ")}`;
  }
  return names[0] ?? "Unknown Agent";
};

const inventoryStatusLabel = (status: SkillInventoryEntry["status"]) => {
  if (status === "library") return "Imported";
  if (status === "outside") return "Outside AgentEnv";
  if (status === "kept-outside") return "Kept outside";
  return "Managed";
};

const cleanupInventoryStatusLabel = (item: SkillInventoryEntry) =>
  item.externalEvidence?.state === "broken-link"
    ? "Unavailable"
    : inventoryStatusLabel(item.status);

const cleanupInventoryStatusClass = (item: SkillInventoryEntry) =>
  item.externalEvidence?.state === "broken-link" ? "stale" : item.status;

const externalManagerLabel = (skill: SkillInventoryEntry | undefined) =>
  skill?.externalEvidence?.displayName ??
  (skill?.externalEvidence?.manager === "skills-cli"
    ? "Skills CLI"
    : skill?.externalEvidence?.manager ?? "Detected source");

const isCleanupManageable = (item: SkillInventoryEntry) =>
  item.status !== "kept-outside" &&
  item.locationRole !== "discovery-only" &&
  (item.locationManagement !== "observed" || item.sharedLocation === true);

const cleanupPresentationLabel = (state: SkillCleanupDisplayState) => {
  if (state === "not-in-library") return "Not in Library";
  if (state === "duplicate-copies") return "Duplicate copies";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "copies-not-managed") return "Copies not managed";
  if (state === "local-changes-found") return "Local changes found";
  if (state === "managed-copy-changed") return "Managed copy changed";
  if (state === "outside-agentenv") return "Outside AgentEnv";
  if (state === "shared-copy-needs-decisions") return "Needs Agent choices";
  if (state === "shared-copy-ready-to-move") return "Ready to move out of shared folder";
  if (state === "kept-shared") return "Kept shared";
  if (state === "kept-outside") return "Kept outside";
  if (state === "unavailable") return "Unavailable";
  return "Managed";
};

const cleanupPresentationCompactLabel = (state: SkillCleanupDisplayState) => {
  if (state === "duplicate-copies") return "Duplicate";
  if (state === "unavailable") return "Unavailable";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "local-changes-found" || state === "managed-copy-changed") return "Changed";
  if (state === "outside-agentenv") return "Outside";
  if (state === "shared-copy-needs-decisions") return "Needs choice";
  if (state === "shared-copy-ready-to-move") return "Ready";
  if (state === "kept-shared") return "Kept";
  if (state === "kept-outside") return "Kept";
  if (state === "managed") return "Managed";
  return "Unmanaged";
};

const cleanupPresentationChipClass = (state: SkillCleanupDisplayState) => {
  if (state === "managed" || state === "shared-copy-ready-to-move") return "managed";
  if (state === "kept-outside" || state === "kept-shared") return "kept-outside";
  if (state === "outside-agentenv") return "outside";
  if (state === "multiple-versions" || state === "local-changes-found") return "conflict";
  if (state === "managed-copy-changed") return "stale";
  if (state === "shared-copy-needs-decisions") return "pending";
  if (state === "duplicate-copies") return "library";
  if (state === "unavailable") return "stale";
  return "outside";
};

const cleanupActionLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "add-to-library") return "Add to Library";
  if (action === "manage-copies") return "Manage copies";
  if (action === "review-differences") return "Review differences";
  if (action === "review-drift") return "Review drift";
  if (action === "review-paths") return "Review paths";
  if (action === "review-agents") return "Review Agents";
  if (action === "move-from-shared") return "Move out of shared folder";
  if (action === "review-details") return "Review details";
  return "";
};

const cleanupActionDisplayLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "review-agents") {
    return "Review Agents";
  }
  if (action === "move-from-shared") {
    return "Move";
  }
  if (
    action === "review-differences" ||
    action === "review-drift" ||
    action === "review-paths" ||
    action === "review-details"
  ) {
    return "Review";
  }
  return cleanupActionLabel(action);
};

const cleanupEffectLabel = (effect: SkillCleanupAutomaticEffect) => {
  if (effect === "import-and-link") return "Add to Library and link copies";
  if (effect === "import-shared") return "Add shared copy to Library and remove duplicates";
  if (effect === "link-to-library") return "Link copies to Library";
  if (effect === "archive-and-link") return "Back up local changes and link to Library";
  if (effect === "repair-link") return "Repair managed links";
  return "Remove unavailable links";
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const SkillLibraryPanel = ({
  isLoading = false,
  isBusy = false,
  librarySkills,
  sourceGroups,
  sourceGroupsLoading = false,
  libraryMode,
  skillUpdates,
  skillInventory,
  cleanupBackups,
  selectedUpdatePlan,
  bulkUpdatePlans,
  bulkUpdateFailures = [],
  updateRun = {},
  skillUsage,
  installedTargetIds = [],
  targetNames = {},
  preparedTargetsBySkill = {},
  activeTool,
  isRefreshingInventory = false,
  onCloseTool,
  onRefreshInventory,
  onSelectLocalSkillSource,
  onReleaseSkillArchive,
  onScanLocalSkillSource,
  onImportUnmanaged,
  onImportLocalSourceSkill,
  onListSkillFiles,
  onReadSkillFile,
  onImportExternal,
  onScanGitHubSkills,
  onImportGitHubSkills,
  onScanRepositorySkills,
  onImportRepositorySkills,
  onLibraryModeChange,
  onCheckSourceGroup,
  onCheckMonitoredSourceGroups,
  onSetSourceName,
  onSetSourceMonitored,
  onSetSourceCandidateIgnored,
  onPreviewSourceMerge,
  onMergeSources,
  onCancelRepositoryOperations,
  onManageTargetSkill,
  onConsolidateSkillGroup,
  onAutoConsolidateSkillGroups,
  onSaveUpdateSettings,
  onSetAvailability,
  onSetIcon,
  onPreviewLibrarySkillUpdate,
  onCloseUpdatePreview,
  onUpdateLibrarySkill,
  onUpdateAllLibrarySkills,
  onPreviewAllLibrarySkillUpdates,
  onCloseBulkUpdatePreview,
  onSyncSkillInstalls,
  onRemoveLibrarySkill,
  onPreviewSkillMerge,
  onMergeLibrarySkills,
  onReviewSkillUsage,
  onCheckUpdates,
  onOpenSource,
  onCopySource,
  onKeepSkillGroupOutside,
  onReviewSkillGroupAgain,
  onSetSkillPathPolicies,
  onSetSharedSkillRetention,
  onRetireSharedSkill,
  onOpenProfiles,
  onRestoreCleanup,
  updateActivity,
  viewState,
  onViewStateChange,
  searchInputRef,
  scrollOwnerRef,
  importConflictOpen = false
}: SkillLibraryPanelProps) => {
  const { formatDate, localeTag, t } = useI18n();
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScanResult, setGithubScanResult] = useState<GitHubSkillScanResult>();
  const {
    selectedSources: githubSelectedSources,
    candidateIds: githubCandidateIds,
    reconcileCandidates: reconcileRepositoryCandidates,
    selectAll: selectAllRepositoryCandidates,
    selectSource: selectRepositoryCandidate,
    setCandidateId: setRepositoryCandidateId,
    reset: resetRepositoryImportDraft
  } = useRepositoryImportDraft();
  const [githubImportResult, setGithubImportResult] = useState<GitHubSkillImportResult>();
  const [githubImportProgress, setGithubImportProgress] = useState<
    Record<string, GitHubSkillImportProgress>
  >({});
  const [githubOperation, setGithubOperation] = useState<"scanning" | "importing">();
  const [githubRetrySourceUrl, setGithubRetrySourceUrl] = useState<string>();
  const [localImportOperation, setLocalImportOperation] = useState(false);
  const [automaticCleanupKey, setAutomaticCleanupKey] = useState<string>();
  const [cleanupOperationKey, setCleanupOperationKey] = useState<string>();
  const [autoCleanupReviewOpen, setAutoCleanupReviewOpen] = useState(false);
  const [expandedCleanupBuckets, setExpandedCleanupBuckets] = useState<
    Record<"managed" | "kept", boolean>
  >({ managed: false, kept: false });
  const [sharedOperation, setSharedOperation] = useState<{
    skillKey: string;
    action: "keep" | "review" | "retire";
  }>();
  const [githubOperationError, setGithubOperationError] = useState("");
  const [localSkillSource, setLocalSkillSource] = useState<LocalSkillSourceSelection>();
  const [importSource, setImportSource] = useState<"local" | "github">("local");
  const [browsingSkill, setBrowsingSkill] = useState<SkillLibraryEntry>();
  const [repositoryRef, setRepositoryRef] = useState("");
  const [repositoryDirectory, setRepositoryDirectory] = useState("");
  const [repositoryConnection, setRepositoryConnection] = useState<"auto" | "system-git">("auto");
  const [repositoryScanKind, setRepositoryScanKind] = useState<"github-api" | "system-git">();
  const [repositoryOperationCancelable, setRepositoryOperationCancelable] = useState(false);
  const [importStopRequested, setImportStopRequested] = useState(false);
  const importStopRequestedRef = useRef(false);
  const [repositoryScanSummary, setRepositoryScanSummary] = useState("");
  const [repositoryCandidateInputs, setRepositoryCandidateInputs] = useState<
    Record<string, RepositorySkillImportInput>
  >({});
  const [githubApiRetryAvailable, setGithubApiRetryAvailable] = useState(false);
  const { search, sourceFilter, statusFilter, targetFilter, usageFilter } = viewState;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceScopeFilter, setSourceScopeFilter] =
    useState<SkillSourceScopeFilter>("monitored");
  const [sourceResultFilter, setSourceResultFilter] =
    useState<SkillSourceResultFilter>("all");
  const updateControls = (
    patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>
  ) => onViewStateChange(updateSkillLibraryControls(viewState, patch));
  const [openAction, setOpenAction] = useState<{ id: string; left: number; top: number }>();
  const openActionId = openAction?.id;
  const [deleteCandidate, setDeleteCandidate] = useState<SkillLibraryEntry>();
  const [disableCandidate, setDisableCandidate] = useState<SkillLibraryEntry>();
  const [sourceCandidate, setSourceCandidate] = useState<SkillLibraryEntry>();
  const [mergePreview, setMergePreview] = useState<SkillMergePreview>();
  const [mergeKeepId, setMergeKeepId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeCompareId, setMergeCompareId] = useState("");
  const [mergeOperation, setMergeOperation] = useState<"loading" | "merging">();
  const [availabilityOperation, setAvailabilityOperation] = useState<SkillAvailabilityInput>();
  const [localPreviewingSkillId, setLocalPreviewingSkillId] = useState<string>();
  const [cleanupDetailsKey, setCleanupDetailsKey] = useState<string>();
  const [sharedTargetReviewKey, setSharedTargetReviewKey] = useState<string>();
  const [sharedRetireKey, setSharedRetireKey] = useState<string>();
  const [cleanupDraft, setCleanupDraft] = useState<{
    skillKey: string;
    libraryId: string;
    canonicalPath: string;
    libraryAction: "create" | "keep" | "replace";
    selectedPaths: string[];
  }>();
  const [externalImport, setExternalImport] = useState<{
    skillKey: string;
    sourcePath: string;
  }>();
  const [pathPolicyOperationPath, setPathPolicyOperationPath] = useState<string>();
  const previewingSkillId =
    updateActivity?.kind === "preview-skill"
      ? updateActivity.skillId
      : localPreviewingSkillId;
  const checkingAllUpdates = updateActivity?.kind === "check-library";
  const previewingAllUpdates = updateActivity?.kind === "preview-skills";
  const updateActivityBusy = Boolean(updateActivity);
  useEffect(() => {
    if (importConflictOpen) {
      setExternalImport(undefined);
    }
  }, [importConflictOpen]);
  const modalDialogRef = useRef<HTMLElement>(null);
  const importDialogRef = useRef<HTMLElement>(null);
  const importFallbackFocusRef = useRef<HTMLElement>(null);
  const modalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const modalFallbackFocusRef = useRef<HTMLElement>(null);
  const actionReturnFocusRef = useRef<HTMLElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const skillsById = new Map(librarySkills.map((skill) => [skill.id, skill]));
  const skillNameCounts = librarySkills.reduce((counts, skill) => {
    const key = skill.name.normalize("NFKC").trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const enabledSkillIds = new Set(
    librarySkills.filter((skill) => skill.globallyEnabled !== false).map((skill) => skill.id)
  );
  const updateableSkillIds = skillUpdates
    .filter((update) => update.updateAvailable && !update.error)
    .filter((update) => enabledSkillIds.has(update.id))
    .filter((update) => skillsById.get(update.id)?.updatePolicy === "tracked")
    .map((update) => update.id);
  const availableUpdateCount = updateableSkillIds.length;
  const githubReadyCandidateSources = githubScanResult?.candidates
    .filter((candidate) => candidate.status === "ready")
    .map((candidate) => candidate.sourceUrl) ?? [];
  const githubSelectedReadyCount = githubReadyCandidateSources.filter((sourceUrl) =>
    githubSelectedSources.includes(sourceUrl)
  ).length;
  const githubAllReadySelected =
    githubReadyCandidateSources.length > 0 &&
    githubSelectedReadyCount === githubReadyCandidateSources.length;
  const githubSomeReadySelected =
    githubSelectedReadyCount > 0 && !githubAllReadySelected;
  const githubImportProgressItems = Object.values(githubImportProgress);
  const githubImportedProgressCount = githubImportProgressItems.filter(
    (progress) => progress.status === "imported"
  ).length;
  const githubFailedImportCount = githubImportProgressItems.filter(
    (progress) => progress.status === "failed"
  ).length;
  const githubSkippedImportCount = githubImportProgressItems.filter(
    (progress) => progress.status === "skipped"
  ).length;
  const dismissModal = () => {
    if (browsingSkill) {
      setBrowsingSkill(undefined);
    } else if (selectedUpdatePlan) {
      onCloseUpdatePreview();
    } else if (deleteCandidate) {
      setDeleteCandidate(undefined);
    } else if (disableCandidate) {
      setDisableCandidate(undefined);
    } else if (sourceCandidate) {
      setSourceCandidate(undefined);
    } else if (mergePreview) {
      setMergePreview(undefined);
    } else if (cleanupDetailsKey) {
      setCleanupDetailsKey(undefined);
    } else if (sharedTargetReviewKey) {
      setSharedTargetReviewKey(undefined);
    } else if (sharedRetireKey) {
      setSharedRetireKey(undefined);
    } else if (autoCleanupReviewOpen) {
      setAutoCleanupReviewOpen(false);
    } else if (externalImport) {
      setExternalImport(undefined);
    } else {
      setCleanupDraft(undefined);
    }
  };
  const modalOpen = Boolean(
    (selectedUpdatePlan && selectedUpdatePlan.changes.length > 0) ||
      deleteCandidate ||
      disableCandidate ||
      sourceCandidate ||
      mergePreview ||
      browsingSkill ||
      externalImport ||
      cleanupDetailsKey ||
      sharedTargetReviewKey ||
      sharedRetireKey ||
      autoCleanupReviewOpen ||
      cleanupDraft
  );
  const requestImportStop = async () => {
    if (githubOperation !== "importing" || importStopRequestedRef.current) return;
    importStopRequestedRef.current = true;
    setImportStopRequested(true);
    if (repositoryScanKind === "system-git") {
      await onCancelRepositoryOperations();
    }
  };
  const closeImportTool = async () => {
    if (githubOperation === "importing") {
      await requestImportStop();
      return;
    }
    if (githubOperation && repositoryOperationCancelable) {
      await onCancelRepositoryOperations();
    }
    if (localSkillSource?.archiveToken) {
      await onReleaseSkillArchive(localSkillSource.archiveToken);
    }
    setLocalSkillSource(undefined);
    onCloseTool?.();
  };
  const openMergePreview = async (skill: SkillLibraryEntry) => {
    setOpenAction(undefined);
    setMergeOperation("loading");
    try {
      const preview = await onPreviewSkillMerge(skill.id);
      const preferredSource =
        preview.entries.find(
          (entry) => entry.id === skill.id && entry.updatePolicy === "tracked"
        ) ??
        preview.entries.find(
          (entry) => entry.sourceType === "github" && entry.updatePolicy === "tracked"
        ) ??
        preview.entries.find((entry) => entry.id === skill.id) ??
        preview.entries[0];
      setMergePreview(preview);
      setMergeKeepId(skill.id);
      setMergeSourceId(preferredSource.id);
      setMergeCompareId(preview.entries.find((entry) => entry.id !== skill.id)?.id ?? "");
    } finally {
      setMergeOperation(undefined);
    }
  };
  useLayoutEffect(() => {
    if (!openActionId) {
      return;
    }
    const popover = document.querySelector<HTMLElement>(
      `[data-skill-action-popover="${CSS.escape(openActionId)}"]`
    );
    if (!popover) {
      return;
    }
    const rect = popover.getBoundingClientRect();
    const margin = 16;
    const nextLeft = clamp(
      rect.left,
      margin,
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const nextTop = clamp(
      rect.top,
      margin,
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    if (Math.abs(nextLeft - rect.left) > 0.5 || Math.abs(nextTop - rect.top) > 0.5) {
      setOpenAction((current) =>
        current?.id === openActionId ? { ...current, left: nextLeft, top: nextTop } : current
      );
      return;
    }
    popover.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [openAction?.left, openAction?.top, openActionId]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (modalOpen) {
        return;
      }
      if (openActionId) {
        setOpenAction(undefined);
        window.requestAnimationFrame(() => actionReturnFocusRef.current?.focus());
        return;
      }
      if (filtersOpen) {
        setFiltersOpen(false);
        window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
        return;
      }
      if (activeTool) {
        if (activeTool === "import" && githubOperation && !repositoryOperationCancelable) {
          return;
        }
        if (activeTool === "import") {
          void closeImportTool();
        } else {
          onCloseTool?.();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, filtersOpen, githubOperation, modalOpen, onCloseTool, openActionId, repositoryOperationCancelable]);
  useModalDialog({
    open: modalOpen,
    dialogRef: modalDialogRef,
    initialFocusRef: modalInitialFocusRef,
    fallbackFocusRef: modalFallbackFocusRef,
    dismissDisabled: Boolean(
      availabilityOperation ||
      sharedOperation ||
      cleanupOperationKey ||
      mergeOperation
    ),
    onDismiss: dismissModal
  });
  useModalDialog({
    open: activeTool === "import",
    dialogRef: importDialogRef,
    fallbackFocusRef: importFallbackFocusRef,
    dismissDisabled: Boolean(githubOperation) && !repositoryOperationCancelable,
    onDismiss: () => void closeImportTool()
  });

  useEffect(() => {
    if (!openActionId && !activeTool) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        openActionId &&
        !target.closest(".row-action-menu") &&
        !target.closest(".row-action-popover")
      ) {
        setOpenAction(undefined);
      }
      if (
        activeTool &&
        activeTool !== "import" &&
        !githubOperation &&
        !modalOpen &&
        !target.closest(".library-drawer") &&
        !target.closest(".row-action-popover") &&
        !target.closest('[data-ui-hover-detail="true"]')
      ) {
        onCloseTool?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeTool, githubOperation, modalOpen, onCloseTool, openActionId]);

  useEffect(() => {
    if (activeTool === "import") {
      return;
    }
    setImportSource("local");
    setGithubScanResult(undefined);
    resetRepositoryImportDraft();
    setGithubImportResult(undefined);
    setGithubImportProgress({});
    setGithubOperationError("");
    setGithubOperation(undefined);
    importStopRequestedRef.current = false;
    setImportStopRequested(false);
    setRepositoryRef("");
    setRepositoryDirectory("");
    setRepositoryConnection("auto");
    setRepositoryScanKind(undefined);
    setRepositoryScanSummary("");
    setRepositoryCandidateInputs({});
    setGithubApiRetryAvailable(false);
  }, [activeTool]);

  const installsFor = (libraryId: string) =>
    skillInventory.filter((skill) => skill.libraryId === libraryId || skill.id === libraryId);
  const filteredSkills = librarySkills.filter((skill) => {
    const installs = installsFor(skill.id);
    const usage = skillUsage[skill.id] ?? [];
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      [skill.id, skill.name, skill.description, sourceLabel(skill)]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    const matchesSource =
      sourceFilter === "all" ||
      (sourceFilter === "local"
        ? skill.sourceType === "local"
        : skill.sourceType === "github" || skill.sourceType === "git");
    const matchesTarget =
      targetFilter === "all" ||
      (targetFilter === "not-installed"
        ? installs.length === 0
        : installs.some((install) => install.status === targetFilter));
    return (
      matchesSearch &&
      matchesSource &&
      matchesSkillStatusFilter(
        statusFilter,
        skill,
        updatesById.get(skill.id)
      ) &&
      (statusFilter === "disabled" || matchesSkillUsageFilter(
        usageFilter,
        usage.length > 0,
        skill.globallyEnabled !== false
      )) &&
      matchesTarget
    );
  });
  const resetAdvancedFilters = () => {
    updateControls({
      sourceFilter: "all",
      targetFilter: "all",
      usageFilter: "all"
    });
  };

  const toggleActionMenu = (skillId: string, button: HTMLButtonElement) => {
    if (openActionId === skillId) {
      setOpenAction(undefined);
      return;
    }

    actionReturnFocusRef.current = button;
    const rect = button.getBoundingClientRect();
    const popoverWidth = Math.min(220, window.innerWidth - 32);
    const estimatedHeight = 190;
    const left = Math.min(window.innerWidth - popoverWidth - 16, Math.max(16, rect.right - popoverWidth));
    const belowTop = rect.bottom + 8;
    const top =
      belowTop + estimatedHeight > window.innerHeight - 16
        ? Math.max(16, rect.top - estimatedHeight - 8)
        : belowTop;
    setOpenAction({ id: skillId, left, top });
  };
  const openActionMenuAt = (
    skillId: string,
    left: number,
    top: number,
    returnFocus: HTMLElement
  ) => {
    actionReturnFocusRef.current = returnFocus;
    setOpenAction({ id: skillId, left, top });
  };
  const advancedFilterCount = [sourceFilter, targetFilter, usageFilter].filter(
    (value) => value !== "all"
  ).length;
  const disabledSkillCount = librarySkills.filter(
    (skill) => skill.globallyEnabled === false
  ).length;
  const monitoredSourceCount = sourceGroups.filter(
    (group) => group.automaticChecks !== false
  ).length;
  const manualSourceCount = sourceGroups.length - monitoredSourceCount;
  const runAvailabilityChange = async (input: SkillAvailabilityInput) => {
    if (availabilityOperation) return;
    setAvailabilityOperation(input);
    try {
      const succeeded = await onSetAvailability(input);
      if (succeeded && !input.enabled) {
        setDisableCandidate(undefined);
      }
    } finally {
      setAvailabilityOperation(undefined);
    }
  };
  const runSkillUpdatePreview = async (id: string) => {
    if (previewingSkillId) return;
    setLocalPreviewingSkillId(id);
    try {
      await onPreviewLibrarySkillUpdate(id);
    } finally {
      setLocalPreviewingSkillId(undefined);
    }
  };
  const runSkillMenuAction = (
    skill: SkillLibraryEntry,
    action: SkillMenuAction,
    returnFocus?: HTMLElement | null
  ) => {
    const fallback = returnFocus ?? document.querySelector<HTMLElement>(
      `[aria-label="More actions for ${CSS.escape(skill.id)}"]`
    );
    actionReturnFocusRef.current = fallback;
    modalFallbackFocusRef.current = fallback;
    setOpenAction(undefined);

    if (action === "update") {
      void runSkillUpdatePreview(skill.id);
    } else if (action === "availability") {
      if (skill.globallyEnabled !== false) {
        setDisableCandidate(skill);
      } else {
        void runAvailabilityChange({ id: skill.id, enabled: true });
      }
    } else if (action === "settings") {
      setSourceCandidate(skill);
    } else if (action === "merge") {
      void openMergePreview(skill);
    } else {
      setDeleteCandidate(skill);
    }
  };
  const cleanupGroups = useMemo(
    () => buildSkillCleanupGroups(skillInventory, {
      installedTargetIds,
      preparedTargetsBySkill
    }),
    [installedTargetIds, preparedTargetsBySkill, skillInventory]
  );
  const automaticCleanupRequests = useMemo(
    () =>
      cleanupGroups
        .map(automaticSkillCleanupRequest)
        .filter((request): request is SkillCleanupRequest => Boolean(request)),
    [cleanupGroups]
  );
  const cleanupGroupsByBucket = useMemo(
    () => ({
      decision: cleanupGroups.filter((group) => group.bucket === "decision"),
      ready: cleanupGroups.filter((group) => group.bucket === "ready"),
      managed: cleanupGroups.filter((group) => group.bucket === "managed"),
      kept: cleanupGroups.filter((group) => group.bucket === "kept")
    }),
    [cleanupGroups]
  );
  const cleanupRequestsByEffect = useMemo(() => {
    const requests = new Map<
      SkillCleanupAutomaticEffect,
      Array<{ request: SkillCleanupRequest; name: string }>
    >();
    for (const request of automaticCleanupRequests) {
      const group = cleanupGroups.find((item) => item.skillKey === request.skillKey);
      if (!group?.automaticEffect) continue;
      requests.set(group.automaticEffect, [
        ...(requests.get(group.automaticEffect) ?? []),
        { request, name: group.primary?.name ?? group.skillKey }
      ]);
    }
    return requests;
  }, [automaticCleanupRequests, cleanupGroups]);
  const manualCleanupCount = cleanupGroupsByBucket.decision.length;
  const sharedReplacementCandidates = cleanupGroupsByBucket.ready.filter(
    (group) =>
      group.sharedMigration?.state === "ready" &&
      Boolean(group.sharedMigration.libraryId)
  );
  const readyCleanupCount =
    automaticCleanupRequests.length + sharedReplacementCandidates.length;
  const migrationSummary = [
    manualCleanupCount > 0
      ? t(manualCleanupCount === 1 ? "1 needs your decision" : "{{count}} need your decision", { count: manualCleanupCount })
      : "",
    readyCleanupCount > 0
      ? t(readyCleanupCount === 1 ? "1 ready to clean up" : "{{count}} ready to clean up", { count: readyCleanupCount })
      : ""
  ].filter(Boolean).join(" · ");
  const localSkillPath = localSkillSource?.path ?? "";
  const normalizedLocalSkillPath = localSkillSource?.kind === "folder"
    ? localSkillPath.trim().replace(/\/+$/, "")
    : "";
  const selectedLocalInventory = skillInventory.find(
    (item) => item.path.replace(/\/+$/, "") === normalizedLocalSkillPath
  );
  const selectedLocalCanImport = Boolean(
    selectedLocalInventory &&
      (!selectedLocalInventory.externalEvidence ||
        isExternalSkillImportable(selectedLocalInventory.externalEvidence))
  );
  const localImportBlocked = Boolean(
    selectedLocalInventory &&
      (selectedLocalInventory.status === "managed" ||
        !selectedLocalCanImport)
  );
  const localImportImpact = !selectedLocalInventory
    ? undefined
    : selectedLocalInventory.status === "managed"
      ? { message: "This Agent copy is already managed by AgentEnv and is present in Library." }
      : selectedLocalInventory.status === "kept-outside"
        ? { message: "This path stays outside AgentEnv. Import creates an independent Library copy and does not change that policy." }
        : selectedLocalInventory.status === "library" &&
            selectedLocalInventory.contentMatchesLibrary !== true
          ? {
              message:
                "This folder differs from the existing Library version. Import will open a comparison before making changes."
            }
          : selectedLocalInventory.status === "outside"
            ? selectedLocalInventory.externalEvidence?.importable === false
              ? {
                  message: "This Skill is provided by {{manager}} and remains read-only here.",
                  values: { manager: externalManagerLabel(selectedLocalInventory) }
                }
              : selectedLocalInventory.externalEvidence
                ? {
                  message:
                    "AgentEnv found {{manager}} metadata. Import creates an independent Library copy and leaves this path unchanged.",
                  values: { manager: externalManagerLabel(selectedLocalInventory) }
                }
                : {
                  message:
                    "Import creates an independent Library copy and leaves this Agent path unchanged."
                }
            : undefined;
  const localImportLabel = "Import copy";
  const cleanupCandidate = cleanupDraft
    ? cleanupGroups.find((group) => group.skillKey === cleanupDraft.skillKey)
    : undefined;
  const cleanupDetails = cleanupDetailsKey
    ? cleanupGroups.find((group) => group.skillKey === cleanupDetailsKey)
    : undefined;
  const cleanupDetailVersions = cleanupDetails
    ? [...cleanupDetails.items.reduce((groups, item) => {
        const unavailable = !item.contentHash || item.runtimeIssues?.some(
          (issue) => issue.code === "unreadable-skill"
        );
        const key = unavailable ? "unavailable" : item.contentHash;
        groups.set(key, [...(groups.get(key) ?? []), item]);
        return groups;
      }, new Map<string, SkillInventoryEntry[]>()).entries()]
        .map(([key, items]) => ({ key, items }))
        .sort((left, right) =>
          left.key === "unavailable" ? 1 : right.key === "unavailable" ? -1 : left.key.localeCompare(right.key)
        )
    : [];
  const sharedTargetReview = sharedTargetReviewKey
    ? cleanupGroups.find((group) => group.skillKey === sharedTargetReviewKey)
    : undefined;
  const sharedRetireCandidate = sharedRetireKey
    ? cleanupGroups.find((group) => group.skillKey === sharedRetireKey)
    : undefined;
  const preparedTargetsForCleanupGroup = (group: (typeof cleanupGroups)[number]) =>
    (preparedTargetsBySkill[group.skillKey] ?? []).filter((preparation) =>
        isSkillCleanupPreparationCurrent(
          preparation,
          group.sharedMigration?.libraryId,
          group.sharedMigration?.paths ?? []
        )
      );
  const sharedRetireTargets = sharedRetireCandidate?.sharedMigration
    ? preparedTargetsForCleanupGroup(sharedRetireCandidate)
    : [];
  const externalImportGroup = externalImport
    ? cleanupGroups.find((group) => group.skillKey === externalImport.skillKey)
    : undefined;
  const externalImportItems =
    externalImportGroup?.activeItems.filter(
      (item) =>
        item.status === "outside" &&
        isExternalSkillImportable(item.externalEvidence)
    ) ?? [];
  const selectedExternalImport = externalImportItems.find(
    (item) => item.path === externalImport?.sourcePath
  );
  const cleanupUsesExistingLibrary = Boolean(
    cleanupCandidate?.items.some((item) => item.status === "library" || item.status === "managed") ||
      (cleanupDraft && librarySkills.some((skill) => skill.id === cleanupDraft.libraryId))
  );
  const cleanupLibrarySkill = cleanupDraft
    ? librarySkills.find((skill) => skill.id === cleanupDraft.libraryId)
    : undefined;

  const changePathPolicy = async (
    item: SkillInventoryEntry,
    mode?: "keep-outside"
  ) => {
    if (!onSetSkillPathPolicies || pathPolicyOperationPath) return;
    setPathPolicyOperationPath(item.path);
    try {
      await onSetSkillPathPolicies({
        items:
          item.sharedLocation || item.foundIn.length === 0
            ? [{ path: item.path, skillKey: item.skillKey }]
            : item.foundIn.map((targetId) => ({
                path: item.path,
                skillKey: item.skillKey,
                targetId
              })),
        mode
      });
    } finally {
      setPathPolicyOperationPath(undefined);
    }
  };

  const openCleanupReview = (group: (typeof cleanupGroups)[number]) => {
    const libraryId = group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey;
    const manageableItems = group.activeItems.filter(
      isCleanupManageable
    );
    const canonical =
      manageableItems.find((item) => item.status === "library") ?? manageableItems[0];
    if (!canonical) {
      return;
    }
    setCleanupDraft({
      skillKey: group.skillKey,
      libraryId,
      canonicalPath: canonical.path,
      libraryAction: librarySkills.some((skill) => skill.id === libraryId)
        ? "keep"
        : "create",
      selectedPaths: manageableItems.map((item) => item.path)
    });
  };

  const scanRepository = async (forceSystemGit = false) => {
    const url = githubUrl.trim();
    if (!url) {
      return;
    }
    setGithubOperation("scanning");
    setRepositoryOperationCancelable(false);
    setGithubOperationError("");
    setGithubImportResult(undefined);
    setGithubImportProgress({});
    setGithubApiRetryAvailable(false);
    try {
      const scanWithSystemGit = async (): Promise<GitHubSkillScanResult> => {
        setRepositoryOperationCancelable(true);
        const repositoryResult = await onScanRepositorySkills({
          repository: url,
          ref: repositoryRef.trim() || undefined,
          directory: repositoryDirectory.trim() || undefined,
          transport: "system-git"
        });
        const inputs = Object.fromEntries(
          repositoryResult.candidates.map((candidate) => {
            const input: RepositorySkillImportInput = {
              repository: repositoryResult.repository,
              ref: repositoryResult.ref,
              directory: candidate.directory,
              transport: "system-git",
              sourceCollection: {
                ...repositoryResult.sourceScope,
                sourceSubpath: sourceSubpathFor(
                  repositoryResult.sourceScope.directory,
                  candidate.directory
                )
              }
            };
            return [repositoryImportProgressKey(input), input];
          })
        );
        setRepositoryScanKind("system-git");
        setRepositoryScanSummary([
          repositoryResult.repository,
          repositoryResult.ref,
          repositoryResult.accessTransport === "ssh" && /^https:\/\//i.test(url)
            ? t("SSH fallback")
            : t("System Git")
        ].join(" · "));
        setRepositoryCandidateInputs(inputs);
        return {
          owner: "Repository",
          repo: repositoryResult.repository,
          ref: repositoryResult.ref,
          rootPath: repositoryResult.directory,
          sourceScope: repositoryResult.sourceScope,
          truncated: repositoryResult.truncated,
          candidates: repositoryResult.candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            description: candidate.description,
            version: candidate.version,
            remotePath: candidate.directory,
            sourceUrl: repositoryImportProgressKey({
              repository: repositoryResult.repository,
              ref: repositoryResult.ref,
              directory: candidate.directory
            }),
            ref: repositoryResult.ref,
            revision: candidate.contentRevision,
            status: candidate.status,
            existingLibraryId: candidate.existingLibraryId,
            error: candidate.error
          }))
        };
      };
      let useGitHubApi = false;
      if (!forceSystemGit && repositoryConnection === "auto" && !repositoryRef.trim() && !repositoryDirectory.trim()) {
        try {
          const parsed = new URL(url);
          const [, owner, repo] = parsed.pathname.split("/");
          useGitHubApi =
            parsed.protocol === "https:" &&
            parsed.hostname.toLowerCase() === "github.com" &&
            Boolean(owner && repo) &&
            !repo.toLowerCase().endsWith(".git");
        } catch {
          useGitHubApi = false;
        }
      }

      let result: GitHubSkillScanResult;
      if (useGitHubApi) {
        setRepositoryOperationCancelable(false);
        try {
          const githubResult = await onScanGitHubSkills(url);
          result = githubResult;
          setRepositoryScanKind("github-api");
          setRepositoryScanSummary(`${githubResult.owner}/${githubResult.repo} · ${githubResult.ref}`);
          setRepositoryCandidateInputs({});
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/GitHub request failed \((?:401|403|404)\b|GitHub branch or commit could not be resolved/i.test(message)) {
            throw error;
          }
          result = await scanWithSystemGit();
        }
      } else {
        result = await scanWithSystemGit();
      }
      setGithubScanResult(result);
      reconcileRepositoryCandidates(result.candidates);
    } catch (error) {
      setGithubOperationError(error instanceof Error ? error.message : String(error));
      setGithubApiRetryAvailable(
        !forceSystemGit && repositoryConnection === "auto" && /^https:\/\/github\.com\//i.test(url)
      );
    } finally {
      setGithubOperation(undefined);
      setRepositoryOperationCancelable(false);
      importStopRequestedRef.current = false;
      setImportStopRequested(false);
    }
  };

  const importSelectedGitHubSkills = async () => {
    if (!githubScanResult || githubSelectedSources.length === 0) {
      return;
    }
    const selected = githubScanResult.candidates.filter(
      (candidate) => candidate.status === "ready" && githubSelectedSources.includes(candidate.sourceUrl)
    );
    setGithubOperation("importing");
    setRepositoryOperationCancelable(true);
    importStopRequestedRef.current = false;
    setImportStopRequested(false);
    setGithubOperationError("");
    setGithubImportResult(undefined);
    setGithubImportProgress(
      Object.fromEntries(
        selected.map((candidate) => [
          candidate.sourceUrl,
          { sourceUrl: candidate.sourceUrl, status: "waiting" }
        ])
      )
    );
    const latestProgress = new Map<string, GitHubSkillImportProgress>(
      selected.map((candidate) => [
        candidate.sourceUrl,
        { sourceUrl: candidate.sourceUrl, status: "waiting" as const }
      ])
    );
    try {
      const onProgress = (progress: GitHubSkillImportProgress) => {
        latestProgress.set(progress.sourceUrl, progress);
        setGithubImportProgress((current) => ({
          ...current,
          [progress.sourceUrl]: progress
        }));
      };
      if (repositoryScanKind === "system-git") {
        const inputs = selected.map((candidate) => ({
          ...repositoryCandidateInputs[candidate.sourceUrl],
          id: githubCandidateIds[candidate.sourceUrl] || candidate.id
        }));
        const result = await onImportRepositorySkills(inputs, {
          onProgress,
          shouldStop: () => importStopRequestedRef.current
        });
        setGithubImportResult({
          imported: result.imported,
          failed: result.failed.map((failure) => ({
            id: failure.id,
            sourceUrl: repositoryImportProgressKey(failure),
            error: failure.error
          }))
        });
      } else {
        const result = await onImportGitHubSkills(
          selected.map((candidate) => ({
            url: candidate.sourceUrl,
            id: githubCandidateIds[candidate.sourceUrl] || candidate.id,
            ref: candidate.ref,
            remotePath: candidate.remotePath,
            sourceCollection: {
              ...githubScanResult.sourceScope,
              sourceSubpath: sourceSubpathFor(
                githubScanResult.sourceScope.directory,
                candidate.remotePath
              )
            }
          })),
          {
            onProgress,
            shouldStop: () => importStopRequestedRef.current
          }
        );
        setGithubImportResult(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = selected.filter((candidate) =>
        latestProgress.get(candidate.sourceUrl)?.status !== "imported"
      );
      setGithubOperationError(message);
      setGithubImportProgress((current) => ({
        ...current,
        ...Object.fromEntries(
          failed.map((candidate) => [
            candidate.sourceUrl,
            { sourceUrl: candidate.sourceUrl, status: "failed" as const, error: message }
          ])
        )
      }));
      setGithubImportResult({
        imported: [],
        failed: failed.map((candidate) => ({
          id: githubCandidateIds[candidate.sourceUrl] || candidate.id,
          sourceUrl: candidate.sourceUrl,
          error: message
        }))
      });
    } finally {
      setGithubOperation(undefined);
      setRepositoryOperationCancelable(false);
      importStopRequestedRef.current = false;
      setImportStopRequested(false);
    }
  };

  const retryGitHubSkill = async (
    candidate: GitHubSkillScanResult["candidates"][number]
  ) => {
    if (!githubScanResult || githubOperation || candidate.status !== "ready") {
      return;
    }
    const sourceUrl = candidate.sourceUrl;
    const requestedId = githubCandidateIds[sourceUrl] || candidate.id;
    setGithubOperation("importing");
    setGithubRetrySourceUrl(sourceUrl);
    setRepositoryOperationCancelable(true);
    importStopRequestedRef.current = false;
    setImportStopRequested(false);
    setGithubOperationError("");
    setGithubImportProgress((current) => ({
      ...current,
      [sourceUrl]: { sourceUrl, status: "reviewing" }
    }));
    setGithubImportResult((current) => current ? {
      imported: current.imported,
      failed: current.failed.filter((failure) => failure.sourceUrl !== sourceUrl)
    } : current);

    const onProgress = (progress: GitHubSkillImportProgress) => {
      setGithubImportProgress((current) => ({
        ...current,
        [progress.sourceUrl]: progress
      }));
    };

    try {
      let retryResult: GitHubSkillImportResult;
      if (repositoryScanKind === "system-git") {
        const repositoryInput = repositoryCandidateInputs[sourceUrl];
        if (!repositoryInput) {
          throw new Error("Repository import details are no longer available. Scan the source again.");
        }
        const input = {
          ...repositoryInput,
          id: requestedId
        };
        const result = await onImportRepositorySkills([input], { onProgress });
        retryResult = {
          imported: result.imported,
          failed: result.failed.map((failure) => ({
            id: failure.id,
            sourceUrl: repositoryImportProgressKey(failure),
            error: failure.error
          }))
        };
      } else {
        retryResult = await onImportGitHubSkills([{
          url: sourceUrl,
          id: requestedId,
          ref: candidate.ref,
          remotePath: candidate.remotePath,
          sourceCollection: {
            ...githubScanResult.sourceScope,
            sourceSubpath: sourceSubpathFor(
              githubScanResult.sourceScope.directory,
              candidate.remotePath
            )
          }
        }], { onProgress });
      }
      setGithubImportResult((current) => ({
        imported: [
          ...(current?.imported ?? []).filter(
            (skill) => !retryResult.imported.some((imported) => imported.id === skill.id)
          ),
          ...retryResult.imported
        ],
        failed: [
          ...(current?.failed ?? []).filter((failure) => failure.sourceUrl !== sourceUrl),
          ...retryResult.failed
        ]
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGithubImportProgress((current) => ({
        ...current,
        [sourceUrl]: { sourceUrl, status: "failed", error: message }
      }));
      setGithubImportResult((current) => ({
        imported: current?.imported ?? [],
        failed: [
          ...(current?.failed ?? []).filter((failure) => failure.sourceUrl !== sourceUrl),
          { id: requestedId, sourceUrl, error: message }
        ]
      }));
    } finally {
      setGithubRetrySourceUrl(undefined);
      setGithubOperation(undefined);
      setRepositoryOperationCancelable(false);
      importStopRequestedRef.current = false;
      setImportStopRequested(false);
    }
  };

  const importLocalSkill = async () => {
    const sourcePath = localSkillPath.trim();
    if (!sourcePath || localImportOperation || localImportBlocked) {
      return;
    }
    setLocalImportOperation(true);
    try {
      const imported = selectedLocalInventory?.externalEvidence
        ? await onImportExternal(selectedLocalInventory)
        : await onImportUnmanaged(sourcePath);
      if (imported) {
        await closeImportTool();
      }
    } finally {
      setLocalImportOperation(false);
    }
  };

  const importSelectedExternalSkill = async () => {
    if (!externalImport || localImportOperation) {
      return;
    }
    const selected = externalImportItems.find(
      (item) => item.path === externalImport.sourcePath
    );
    if (!selected || selected.externalEvidence?.state === "broken-link") {
      return;
    }
    setLocalImportOperation(true);
    try {
      if (await onImportExternal(selected)) {
        setExternalImport(undefined);
      }
    } finally {
      setLocalImportOperation(false);
    }
  };

  const runAutomaticCleanup = async (
    key: string,
    requests: SkillCleanupRequest[]
  ) => {
    if (
      automaticCleanupKey ||
      (requests.length === 0 && sharedReplacementCandidates.length === 0)
    ) {
      return;
    }
    setAutomaticCleanupKey(key);
    setAutoCleanupReviewOpen(false);
    try {
      for (const group of sharedReplacementCandidates) {
        const migration = group.sharedMigration;
        if (!migration?.libraryId) continue;
        setSharedOperation({ skillKey: group.skillKey, action: "retire" });
        const completed = await onRetireSharedSkill({
          skillKey: group.skillKey,
          libraryId: migration.libraryId,
          paths: migration.paths
        });
        if (!completed) return;
      }
      if (requests.length > 0) {
        await onAutoConsolidateSkillGroups(requests);
      }
    } finally {
      setSharedOperation(undefined);
      setAutomaticCleanupKey(undefined);
    }
  };

  const changeSharedRetention = async (
    group: (typeof cleanupGroups)[number],
    retained: boolean
  ) => {
    if (!group.sharedMigration || sharedOperation) return false;
    setSharedOperation({
      skillKey: group.skillKey,
      action: retained ? "keep" : "review"
    });
    try {
      return await onSetSharedSkillRetention({
        skillKey: group.skillKey,
        paths: group.sharedMigration.paths,
        retained
      });
    } finally {
      setSharedOperation(undefined);
    }
  };

  const retireSharedCopy = async () => {
    if (
      !sharedRetireCandidate?.sharedMigration?.libraryId ||
      sharedRetireCandidate.sharedMigration.state !== "ready" ||
      sharedOperation
    ) {
      return;
    }
    setSharedOperation({ skillKey: sharedRetireCandidate.skillKey, action: "retire" });
    try {
      if (await onRetireSharedSkill({
        skillKey: sharedRetireCandidate.skillKey,
        libraryId: sharedRetireCandidate.sharedMigration.libraryId,
        paths: sharedRetireCandidate.sharedMigration.paths
      })) {
        setSharedRetireKey(undefined);
      }
    } finally {
      setSharedOperation(undefined);
    }
  };

  const selectLocalSkillFolder = async () => {
    const source = await onSelectLocalSkillSource();
    if (source) {
      if (localSkillSource?.archiveToken) {
        await onReleaseSkillArchive(localSkillSource.archiveToken);
      }
      setLocalSkillSource(source);
      setLocalImportOperation(true);
      try {
        if (source.kind === "folder") await onRefreshInventory(false);
      } finally {
        setLocalImportOperation(false);
      }
    }
  };
  const mergeKeepEntry = mergePreview?.entries.find((entry) => entry.id === mergeKeepId);
  const mergeSourceEntry = mergePreview?.entries.find((entry) => entry.id === mergeSourceId);
  const mergeCompareEntries = mergePreview?.entries.filter((entry) => entry.id !== mergeKeepId) ?? [];
  const effectiveCompareId = mergeCompareEntries.some((entry) => entry.id === mergeCompareId)
    ? mergeCompareId
    : mergeCompareEntries[0]?.id ?? "";
  const mergeComparison = mergePreview?.comparisons.find(
    (comparison) =>
      (comparison.leftId === mergeKeepId && comparison.rightId === effectiveCompareId) ||
      (comparison.rightId === mergeKeepId && comparison.leftId === effectiveCompareId)
  );
  const confirmMerge = async () => {
    if (!mergePreview || !mergeKeepEntry || !mergeSourceEntry || mergeOperation) return;
    setMergeOperation("merging");
    try {
      const merged = await onMergeLibrarySkills({
        ids: mergePreview.entries.map((entry) => entry.id),
        keepId: mergeKeepEntry.id,
        sourceId: mergeSourceEntry.id,
        expectedContentHashes: Object.fromEntries(
          mergePreview.entries.map((entry) => [entry.id, entry.contentHash])
        )
      });
      if (merged) setMergePreview(undefined);
    } finally {
      setMergeOperation(undefined);
    }
  };

  const addSourceCandidate = async (
    group: SkillSourceGroupView,
    candidate: SkillSourceGroupCandidate
  ) => {
    if (group.sourceKind === "local") {
      if (!onImportLocalSourceSkill) return false;
      const sourcePath = [group.repository.replace(/\/+$/, ""), candidate.sourceSubpath]
        .filter(Boolean)
        .join("/");
      return onImportLocalSourceSkill(sourcePath, {
        formatVersion: 1,
        kind: "local",
        canonicalLink: group.canonicalLink,
        repository: group.repository,
        ref: "",
        directory: "",
        sourceId: group.sourceId,
        sourceSubpath: candidate.sourceSubpath
      });
    }
    const result = await onImportRepositorySkills([{
      repository: group.repository,
      ref: group.ref,
      directory: candidate.directory,
      transport: "system-git",
      sourceCollection: {
        formatVersion: 1,
        kind: "repository",
        canonicalLink: group.canonicalLink,
        repository: group.repository,
        ref: group.ref,
        directory: group.directory,
        sourceSubpath: candidate.sourceSubpath
      }
    }]);
    return result.imported.length > 0;
  };
  return (
    <section className="skill-library-panel ui-surface-frame" aria-label={t("Skill library")}>
      <div className="library-control-deck">
        <div className="library-quick-tabs">
          <div className="library-mode-switch" role="tablist" aria-label={t("Skill library view")}>
            <button
              className={`library-mode-tab${libraryMode === "skills" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={libraryMode === "skills"}
              onClick={() => onLibraryModeChange("skills")}
            >
              {t("Skill list")}
            </button>
            <button
              className={`library-mode-tab${libraryMode === "sources" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={libraryMode === "sources"}
              onClick={() => onLibraryModeChange("sources")}
            >
              {t("By source")}
            </button>
          </div>
          <div
            className="library-status-tabs"
            role="tablist"
            aria-label={t("Skill status filters")}
            hidden={libraryMode !== "skills"}
          >
          <button
            className={`library-quick-tab${statusFilter === "enabled" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "enabled"}
            onClick={() => updateControls({ statusFilter: "enabled" })}
          >
            {t("Enabled")} <strong>{librarySkills.length - disabledSkillCount}</strong>
          </button>
          <button
            className={`library-quick-tab${statusFilter === "updates" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "updates"}
            onClick={() => updateControls({ statusFilter: "updates" })}
          >
            {t("Updates")} <strong>{availableUpdateCount}</strong>
          </button>
          <button
            className={`library-quick-tab${statusFilter === "disabled" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "disabled"}
            onClick={() => updateControls({ statusFilter: "disabled" })}
          >
            {t("Disabled")} <strong>{disabledSkillCount}</strong>
          </button>
          </div>
          <div
            className="library-status-tabs"
            role="tablist"
            aria-label={t("Source check scope")}
            hidden={libraryMode !== "sources"}
          >
            <button
              className={`library-quick-tab${sourceScopeFilter === "monitored" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={sourceScopeFilter === "monitored"}
              onClick={() => setSourceScopeFilter("monitored")}
            >
              {t("Monitored")} <strong>{monitoredSourceCount}</strong>
            </button>
            <button
              className={`library-quick-tab${sourceScopeFilter === "manual" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={sourceScopeFilter === "manual"}
              onClick={() => setSourceScopeFilter("manual")}
            >
              {t("Manual only")} <strong>{manualSourceCount}</strong>
            </button>
            <button
              className={`library-quick-tab${sourceScopeFilter === "all" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={sourceScopeFilter === "all"}
              onClick={() => setSourceScopeFilter("all")}
            >
              {t("All")} <strong>{sourceGroups.length}</strong>
            </button>
          </div>
        </div>
        <div className="library-toolbar" hidden={libraryMode !== "skills"}>
          <label className="library-search ui-composite-field">
            <span>{t("Search")}</span>
            <Search size={16} strokeWidth={2.1} aria-hidden="true" />
            <input
              ref={searchInputRef}
              aria-label={t("Search skills")}
              placeholder={t("Search skill name or description...")}
              value={search}
              onChange={(event) => updateControls({ search: event.currentTarget.value })}
            />
          </label>
          <button
            aria-expanded={filtersOpen}
            className={`secondary-action library-filter-trigger${advancedFilterCount > 0 ? " has-filters" : ""}`}
            ref={filterTriggerRef}
            type="button"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <ListFilter size={15} strokeWidth={2.2} />
            <span>{t("Filters")}</span>
            {advancedFilterCount > 0 ? (
              <strong aria-label={t("{{count}} active filters", { count: advancedFilterCount })}>
                {advancedFilterCount}
              </strong>
            ) : null}
          </button>
          <button
            className="secondary-action library-toolbar-action"
            type="button"
            aria-label={t("Check updates")}
            title={t("Check skill updates")}
            aria-busy={checkingAllUpdates}
            disabled={updateActivityBusy}
            onClick={onCheckUpdates}
          >
            {checkingAllUpdates ? (
              <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
            ) : (
              <SearchCheck size={15} strokeWidth={2.2} />
            )}
            <span>{t(checkingAllUpdates ? "Checking..." : "Check updates")}</span>
          </button>
          {updateableSkillIds.length > 0 ? (
            <button
              className="secondary-action library-toolbar-action"
              type="button"
              aria-label={t("Update all skills")}
              title={t("Update all skills")}
              aria-busy={previewingAllUpdates}
              disabled={updateActivityBusy}
              onClick={() => onPreviewAllLibrarySkillUpdates(updateableSkillIds)}
            >
              {previewingAllUpdates ? (
                <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
              ) : (
                <Sparkles size={15} strokeWidth={2.2} />
              )}
              <span>{t("Update all")}</span>
            </button>
          ) : null}
          {filtersOpen ? (
            <div className="library-filter-panel" role="group" aria-label={t("Skill filters")}>
              <label>
                <span>{t("Source")}</span>
                <select
                  aria-label={t("Skill source filter")}
                  value={sourceFilter}
                  onChange={(event) =>
                    updateControls({ sourceFilter: event.currentTarget.value as typeof sourceFilter })
                  }
                >
                  <option value="all">{t("All sources")}</option>
                  <option value="online">{t("Online")}</option>
                  <option value="local">{t("Local")}</option>
                </select>
              </label>
              <label>
                <span>{t("Usage")}</span>
                <select
                  aria-label={t("Skill usage filter")}
                  value={usageFilter}
                  onChange={(event) =>
                    updateControls({ usageFilter: event.currentTarget.value as typeof usageFilter })
                  }
                >
                  <option value="all">{t("All usage")}</option>
                  <option value="referenced">{t("Referenced")}</option>
                  <option value="unreferenced">{t("Unreferenced")}</option>
                </select>
              </label>
              <label>
                <span>{t("Agents")}</span>
                <select
                  aria-label={t("Skill Agent filter")}
                  value={targetFilter}
                  onChange={(event) =>
                    updateControls({ targetFilter: event.currentTarget.value as typeof targetFilter })
                  }
                >
                  <option value="all">{t("All Agents")}</option>
                  <option value="managed">{t("Managed")}</option>
                  <option value="library">{t("Imported")}</option>
                  <option value="outside">{t("Unmanaged")}</option>
                  <option value="kept-outside">{t("Kept outside")}</option>
                  <option value="not-installed">{t("Not installed")}</option>
                </select>
              </label>
              <button
                className="secondary-action library-filter-reset"
                type="button"
                disabled={advancedFilterCount === 0}
                onClick={resetAdvancedFilters}
              >
                <RotateCcw size={15} strokeWidth={2.2} />
                <span>{t("Reset")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <section
        className="library-table"
        aria-label={t("Library skills")}
        hidden={libraryMode !== "skills"}
      >
        <div className="library-table__head">
          <span>{t("Skill")}</span>
          <span>{t("Source")}</span>
          <span className="library-column-label">
            {t("Usage")}
            <InfoTip
              label={t(
                "Shows Profile references and Agent installs for this skill."
              )}
            />
          </span>
          <span className="library-column-label">
            {t("Status")}
            <InfoTip label={t("Shows the current maintenance state for this skill.")} />
          </span>
          <span>{t("Action")}</span>
          <span aria-label={t("More")} />
        </div>
        <div className="library-table__body" ref={scrollOwnerRef}>
          {isLoading && librarySkills.length === 0 ? (
            <div className="inline-state inline-state--loading library-empty" role="status">
              <span className="inline-state__icon" aria-hidden="true" />
              <span>{t("Loading skills")}</span>
            </div>
          ) : null}
          {!isLoading && librarySkills.length === 0 ? (
            <p className="muted library-empty">{t("Import a skill from a folder or repository to start the library.")}</p>
          ) : null}
          {librarySkills.length > 0 && filteredSkills.length === 0 ? (
            <p className="muted library-empty">{t("No skills match the current filters.")}</p>
          ) : null}
          {filteredSkills.map((skill) => {
            const updateInfo = updatesById.get(skill.id);
            const installs = installsFor(skill.id);
            const staleCopies = installs.filter(
              (install) => install.installMethod === "copied" && install.contentMatchesLibrary === false
            );
            const hasUpdateSource = Boolean(skill.source);
            const isTracked = skill.updatePolicy === "tracked";
            const globallyEnabled = skill.globallyEnabled !== false;
            const availabilityIsChanging = availabilityOperation?.id === skill.id;
            const hasUpdate = globallyEnabled && isTracked && Boolean(updateInfo?.updateAvailable);
            const hasError = globallyEnabled && isTracked && Boolean(updateInfo?.error);
            const usageCount = (skillUsage[skill.id] ?? []).length;
            const revisionLabel = shortRevision(skill);
            const versionLabel = skill.version ?? skill.remoteRef ?? revisionLabel;
            const installedAgentNames = Array.from(new Set(
              installs.flatMap((install) =>
                install.foundIn.map((targetId) => targetNameFor(targetId, targetNames, targetId))
              )
            ));
            const installedAgentCount = installedAgentNames.length || installs.length;
            const sourceTypeLabel = skill.sourceType === "github"
              ? "GitHub"
              : skill.sourceType === "git"
                ? t("Repository")
                : t("Local");
            const sourceUpdatedAt = updateInfo?.latestUpdatedAt ?? skill.upstream?.updatedAt;
            const sourceUpdatedLabel = sourceUpdatedAt
              ? new Date(sourceUpdatedAt).toLocaleDateString(localeTag, {
                  year: "numeric",
                  month: "short",
                  day: "numeric"
                })
              : undefined;
            const sourceMeta = [
              skill.sourceType === "local" ? undefined : sourceTypeLabel,
              versionLabel,
              sourceUpdatedLabel ? t("Updated {{date}}", { date: sourceUpdatedLabel }) : undefined
            ].filter(Boolean).join(" · ");
            const sourceDetail = [
              sourceLabel(skill),
              skill.version,
              revisionLabel,
              sourceUpdatedAt
                ? t("Source updated {{date}}", { date: formatDate(sourceUpdatedAt) })
                : undefined
            ]
              .filter(Boolean)
              .join(" · ");
            const staleInstallDetail = staleCopies.length > 0
              ? t("{{count}} out of sync", { count: staleCopies.length })
              : undefined;
            const statusDetail = availabilityIsChanging
              ? t("Saving...")
              : !globallyEnabled
                ? t("Hidden from Profile selection")
                : hasUpdate
                  ? [
                      updateInfo?.latestRevision
                        ? `${updateInfo.latestRevision.slice(0, 7)} ${t("available")}`
                        : undefined,
                      staleInstallDetail
                    ].filter(Boolean).join(" · ")
                  : hasError
                    ? t("Source check failed")
                  : staleCopies.length > 0
                      ? staleInstallDetail
                      : undefined;
            return (
              <div
                aria-label={t("Library item {{id}}", { id: skill.id })}
                className={`library-table-row${globallyEnabled ? "" : " is-globally-disabled"}`}
                key={skill.id}
                role="group"
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!availabilityIsChanging) {
                    openActionMenuAt(
                      skill.id,
                      event.clientX,
                      event.clientY,
                      event.currentTarget.querySelector<HTMLElement>(".library-actions-cell .icon-action") ?? event.currentTarget
                    );
                  }
                }}
              >
                <div className="library-resource-cell">
                  <ResourceIconPicker
                    className="resource-avatar"
                    fallbackIconKey={skill.sourceType === "github" || skill.sourceType === "git" ? "github" : "folder"}
                    iconKey={skill.iconKey}
                    label={skill.name}
                    sourceUrl={skill.sourceType === "github" || skill.sourceType === "git" ? skill.source : undefined}
                    onChange={(iconKey) => onSetIcon({ id: skill.id, iconKey })}
                  />
                  <div className="skill-title-stack">
                    <span className="skill-title-line">
                      <button
                        className="library-skill-name-button"
                        type="button"
                        onClick={(event) => {
                          modalFallbackFocusRef.current = event.currentTarget;
                          setBrowsingSkill(skill);
                        }}
                      >
                        <strong className="skill-title">{skill.name}</strong>
                      </button>
                      {(skillNameCounts.get(skill.name.normalize("NFKC").trim().toLowerCase()) ?? 0) > 1 ? (
                        <span className="library-duplicate-id">{skill.id}</span>
                      ) : null}
                    </span>
                    <PreviewText className="skill-description" text={skill.description || skill.id} />
                  </div>
                </div>
                <div className="library-source-cell">
                  {(skill.sourceType === "github" || skill.sourceType === "git") && /^https?:\/\//i.test(skill.source ?? "") ? (
                    <button
                      className="library-source-primary is-interactive"
                      type="button"
                      aria-label={t("Open repository source for {{id}}", { id: skill.id })}
                      onClick={() => onOpenSource(skill.source!)}
                    >
                      <GitBranch size={13} strokeWidth={2.2} />
                      <PreviewText
                        ariaLabel={t("Full source for {{id}}", { id: skill.id })}
                        className="library-source-name"
                        displayText={t(sourceName(skill))}
                        text={sourceLabel(skill)}
                        tooltipClassName="library-source-tooltip"
                      />
                      <ExternalLink size={11} strokeWidth={2.2} />
                    </button>
                  ) : skill.sourceType === "git" && skill.source ? (
                    <button
                      className="library-source-primary is-interactive"
                      type="button"
                      aria-label={t("Copy repository source for {{id}}", { id: skill.id })}
                      onClick={() => onCopySource(skill.source!)}
                    >
                      <GitBranch size={13} strokeWidth={2.2} />
                      <PreviewText
                        ariaLabel={t("Full source for {{id}}", { id: skill.id })}
                        className="library-source-name"
                        displayText={t(sourceName(skill))}
                        text={sourceLabel(skill)}
                        tooltipClassName="library-source-tooltip"
                      />
                      <Copy size={11} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <span className="library-source-primary">
                      <Folder size={13} strokeWidth={2.2} />
                      <PreviewText
                        ariaLabel={t("Full source for {{id}}", { id: skill.id })}
                        className="library-source-name"
                        displayText={t(sourceName(skill))}
                        text={sourceLabel(skill)}
                        tooltipClassName="library-source-tooltip"
                      />
                    </span>
                  )}
                  <PreviewText
                    ariaLabel={t("Source details for {{id}}", { id: skill.id })}
                    className="library-source-meta"
                    displayText={sourceMeta}
                    text={sourceDetail}
                  />
                </div>
                <div className="library-usage-cell">
                  <span className="library-usage-line">
                    <span>{t("Profiles")}</span>
                    <strong>{usageCount}</strong>
                  </span>
                  <span className="library-usage-line">
                    <span>{t("Agents")}</span>
                    <PreviewText
                      ariaLabel={t("Usage details for {{id}}", { id: skill.id })}
                      className="library-usage-count"
                      displayText={String(installedAgentCount)}
                      text={`${t("Profiles")}: ${(skillUsage[skill.id] ?? []).join(", ") || t("Not referenced")} · ${t("Agents")}: ${installedAgentNames.join(", ") || t("Not installed")}`}
                    />
                  </span>
                </div>
                <div className="library-status-cell">
                  {availabilityIsChanging ? (
                    <strong className="library-primary-status is-working">
                      <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
                      <span>{t(availabilityOperation.enabled ? "Enabling..." : "Disabling...")}</span>
                    </strong>
                  ) : !globallyEnabled ? (
                    <strong className="library-primary-status is-disabled">
                      <CircleSlash2 size={13} strokeWidth={2.2} />
                      <span>{t("Disabled")}</span>
                    </strong>
                  ) : hasUpdate ? (
                    <strong className="library-primary-status is-update">
                      <CircleArrowUp size={13} strokeWidth={2.2} />
                      <span>{t("Update available")}</span>
                    </strong>
                  ) : hasError ? (
                    <strong className="library-primary-status is-error">
                      <TriangleAlert size={13} strokeWidth={2.2} />
                      <span>{t("Check failed")}</span>
                    </strong>
                  ) : staleCopies.length > 0 ? (
                    <strong className="library-primary-status is-warning">
                      <CircleAlert size={13} strokeWidth={2.2} />
                      <span>{t("Needs sync")}</span>
                    </strong>
                  ) : (
                    <strong className="library-primary-status">
                      {isTracked && updateInfo ? (
                        <CheckCircle2 size={13} strokeWidth={2.2} />
                      ) : hasUpdateSource && !isTracked ? (
                        <Link2Off size={13} strokeWidth={2.2} />
                      ) : isTracked && hasUpdateSource ? (
                        <Circle size={13} strokeWidth={2.2} />
                      ) : (
                        <Circle size={13} strokeWidth={2.2} />
                      )}
                      <span>{t(
                        isTracked && updateInfo
                          ? "Up to date"
                          : isTracked && hasUpdateSource
                            ? "Not checked"
                            : hasUpdateSource
                              ? "Monitoring off"
                              : "Manual"
                      )}</span>
                    </strong>
                  )}
                  {statusDetail ? (
                    <PreviewText
                      ariaLabel={t("Status details for {{id}}", { id: skill.id })}
                      className="library-status-detail"
                      text={statusDetail}
                    />
                  ) : null}
                </div>
                <div className="library-current-action-cell">
                  {hasUpdate ? (
                    <button
                      aria-label={t("Update {{name}}", { name: skill.id })}
                      aria-busy={previewingSkillId === skill.id}
                      className="library-row-action"
                      type="button"
                      disabled={updateActivityBusy || Boolean(previewingSkillId)}
                      onClick={(event) => {
                        modalFallbackFocusRef.current = event.currentTarget;
                        void runSkillUpdatePreview(skill.id);
                      }}
                    >
                      {previewingSkillId === skill.id ? (
                        <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
                      ) : (
                        <RefreshCw size={13} strokeWidth={2.2} />
                      )}
                      <span>{t("Update")}</span>
                    </button>
                  ) : hasError ? (
                    <button
                      aria-label={t("Retry update check {{id}}", { id: skill.id })}
                      aria-busy={previewingSkillId === skill.id}
                      className="library-row-action"
                      type="button"
                      disabled={updateActivityBusy || Boolean(previewingSkillId)}
                      onClick={(event) => {
                        modalFallbackFocusRef.current = event.currentTarget;
                        void runSkillUpdatePreview(skill.id);
                      }}
                    >
                      {previewingSkillId === skill.id ? (
                        <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
                      ) : (
                        <RefreshCw size={13} strokeWidth={2.2} />
                      )}
                      <span>{t("Retry check")}</span>
                    </button>
                  ) : staleCopies.length > 0 ? (
                    <button
                      aria-label={t(
                        staleCopies.length === 1
                          ? "Sync install of {{id}}"
                          : "Sync {{count}} installs of {{id}}",
                        { count: staleCopies.length, id: skill.id }
                      )}
                      className="library-row-action"
                      type="button"
                      onClick={() => onSyncSkillInstalls(skill.id)}
                    >
                      <RefreshCw size={13} strokeWidth={2.2} />
                      <span>{t("Sync installs")}</span>
                    </button>
                  ) : null}
                </div>
                <div className="library-actions-cell">
                  <div className="row-action-menu">
                    <button
                      className="icon-action"
                      type="button"
                      aria-label={t("More actions for {{id}}", { id: skill.id })}
                      aria-expanded={openActionId === skill.id}
                      aria-haspopup="menu"
                      disabled={availabilityIsChanging}
                      onClick={(event) => toggleActionMenu(skill.id, event.currentTarget)}
                    >
                      <MoreHorizontal size={16} strokeWidth={2.2} />
                    </button>
                  </div>
                  {openActionId === skill.id && openAction
                    ? createPortal(
                        <ActionMenu
                          ariaLabel={t("Actions for {{id}}", { id: skill.id })}
                          className="row-action-popover"
                          data-skill-action-popover={skill.id}
                          style={{ left: openAction.left, top: openAction.top }}
                        >
                          {globallyEnabled && hasUpdateSource && isTracked ? (
                            <button
                              className="row-action-item"
                              type="button"
                              role="menuitem"
                              disabled={updateActivityBusy || Boolean(previewingSkillId)}
                              onClick={() => runSkillMenuAction(skill, "update")}
                            >
                              {previewingSkillId === skill.id ? (
                                <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                              ) : (
                                <RefreshCw size={14} strokeWidth={2.2} />
                              )}
                              <span>{t(hasUpdate ? "Update" : "Check update")}</span>
                            </button>
                          ) : null}
                          <button
                            className="row-action-item"
                            type="button"
                            role="menuitem"
                            disabled={Boolean(availabilityOperation)}
                            onClick={() => runSkillMenuAction(skill, "availability")}
                          >
                            <Power size={14} strokeWidth={2.2} />
                            <span>{t(globallyEnabled ? "Disable globally" : "Enable globally")}</span>
                          </button>
                          <button
                            className="row-action-item"
                            type="button"
                            role="menuitem"
                            onClick={() => runSkillMenuAction(skill, "settings")}
                          >
                            <Settings2 size={14} strokeWidth={2.2} />
                            <span>{t("Update settings")}</span>
                          </button>
                          {(skillNameCounts.get(skill.name.normalize("NFKC").trim().toLowerCase()) ?? 0) > 1 ? (
                            <button
                              className="row-action-item"
                              type="button"
                              role="menuitem"
                              disabled={Boolean(mergeOperation)}
                              onClick={() => runSkillMenuAction(skill, "merge")}
                            >
                              {mergeOperation === "loading" ? (
                                <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                              ) : (
                                <Combine size={14} strokeWidth={2.2} />
                              )}
                              <span>{t("Merge duplicates")}</span>
                            </button>
                          ) : null}
                          <button
                            className="row-action-item row-action-item--danger"
                            type="button"
                            role="menuitem"
                            onClick={() => runSkillMenuAction(skill, "remove")}
                          >
                            <Trash2 size={14} strokeWidth={2.2} />
                            <span>{t("Remove from library")}</span>
                          </button>
                        </ActionMenu>,
                        document.body
                      )
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <SkillSourceView
        active={libraryMode === "sources"}
        updateActivity={updateActivity}
        groups={sourceGroups}
        loading={sourceGroupsLoading}
        scopeFilter={sourceScopeFilter}
        sourceKindFilter={sourceFilter}
        resultFilter={sourceResultFilter}
        onSourceKindFilterChange={(filter) => updateControls({ sourceFilter: filter })}
        onResultFilterChange={setSourceResultFilter}
        onCheckGroup={onCheckSourceGroup}
        onCheckMonitored={onCheckMonitoredSourceGroups}
        onRename={onSetSourceName}
        onSetMonitored={onSetSourceMonitored}
        onSetCandidateIgnored={onSetSourceCandidateIgnored}
        onPreviewMerge={onPreviewSourceMerge}
        onMerge={onMergeSources}
        onAdd={addSourceCandidate}
        onUpdate={onPreviewLibrarySkillUpdate}
        onReviewUpdates={onPreviewAllLibrarySkillUpdates}
        onDelete={(libraryId) => {
          const skill = skillsById.get(libraryId);
          if (skill) setDeleteCandidate(skill);
        }}
        onOpenSource={onOpenSource}
        onCopySource={onCopySource}
      />

      <SkillUpdateDialog
        plan={selectedUpdatePlan}
        busy={isBusy}
        progress={selectedUpdatePlan ? updateRun[selectedUpdatePlan.id] : undefined}
        onClose={onCloseUpdatePreview}
        onConfirm={onUpdateLibrarySkill}
      />

      {browsingSkill ? (
        <SkillFileBrowserDialog
          skill={browsingSkill}
          dialogRef={modalDialogRef}
          initialFocusRef={modalInitialFocusRef}
          onListFiles={onListSkillFiles}
          onReadFile={onReadSkillFile}
          onClose={() => setBrowsingSkill(undefined)}
        />
      ) : null}

      {mergePreview && mergeKeepEntry && mergeSourceEntry ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => !mergeOperation && setMergePreview(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog skill-merge-dialog ui-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={t("Merge same-name Skills")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Merge same-name Skills")}</div>
                <p className="muted ui-dialog-description">
                  {t("Choose the Library entry to keep and the update source to retain.")}
                </p>
              </div>
              <span className={`skill-import-match-state${mergePreview.comparisons.every((item) => item.identical) ? " is-identical" : " is-different"}`}>
                {t(mergePreview.comparisons.every((item) => item.identical) ? "Identical" : "Differences found")}
              </span>
            </header>

            <div className="skill-merge-body ui-dialog-body">
              <fieldset className="skill-merge-choice-group">
                <legend>{t("Keep Skill")}</legend>
                <p>{t("This entry keeps its Library ID, content, icon, and availability.")}</p>
                <div className="skill-merge-choice-grid">
                  {mergePreview.entries.map((entry) => (
                    <label className={mergeKeepId === entry.id ? "is-selected" : ""} key={entry.id}>
                      <input
                        type="radio"
                        name="merge-keep-skill"
                        checked={mergeKeepId === entry.id}
                        onChange={() => {
                          setMergeKeepId(entry.id);
                          setMergeCompareId(
                            mergePreview.entries.find((candidate) => candidate.id !== entry.id)?.id ?? ""
                          );
                        }}
                      />
                      <span>
                        <strong>{entry.id}</strong>
                        <small>
                          {[entry.version ?? t("Not declared"), entry.contentHash.slice(0, 8),
                            (entry.upstream?.updatedAt ?? entry.modifiedAt)
                              ? `${t("Modified")} ${formatDate((entry.upstream?.updatedAt ?? entry.modifiedAt)!)}`
                              : undefined]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        <small>{t("{{profiles}} profiles · {{installs}} installs", {
                          profiles: entry.profileNames.length,
                          installs: entry.installCount
                        })}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="skill-merge-choice-group skill-merge-source-group">
                <legend>{t("Keep update source")}</legend>
                <p>{t("Content still comes from the Skill selected above.")}</p>
                <div className="skill-merge-source-list">
                  {mergePreview.entries.map((entry) => (
                    <label className={mergeSourceId === entry.id ? "is-selected" : ""} key={entry.id}>
                      <input
                        type="radio"
                        name="merge-source-skill"
                        checked={mergeSourceId === entry.id}
                        onChange={() => setMergeSourceId(entry.id)}
                      />
                      <span>
                        <strong>{entry.sourceType === "github" ? "GitHub" : t("Local")} · {entry.id}</strong>
                        <small title={entry.source}>{entry.source}</small>
                        {entry.upstream?.updatedAt || entry.modifiedAt ? (
                          <small>{t("Modified")} · {formatDate(entry.upstream?.updatedAt ?? entry.modifiedAt!)}</small>
                        ) : null}
                      </span>
                      <em>{t(entry.updatePolicy === "tracked" ? "Tracked" : "Monitoring off")}</em>
                    </label>
                  ))}
                </div>
              </fieldset>

              <section className="skill-merge-diff" aria-label={t("Skill differences") }>
                <header>
                  <div>
                    <strong>{t("Compare content")}</strong>
                    <span>{mergeKeepEntry.id}</span>
                  </div>
                  {mergeCompareEntries.length > 1 ? (
                    <select
                      aria-label={t("Compare with")}
                      value={effectiveCompareId}
                      onChange={(event) => setMergeCompareId(event.target.value)}
                    >
                      {mergeCompareEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.id}</option>
                      ))}
                    </select>
                  ) : (
                    <span>{effectiveCompareId}</span>
                  )}
                </header>
                {mergeComparison?.changes.length ? (
                  <div className="diff-list">
                    {mergeComparison.changes.map((change) => (
                      <div className="diff-file" key={change.path}>
                        <div className="diff-file-meta"><strong>{change.path}</strong></div>
                        <DiffViewer path={change.path} diff={change.diff} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="skill-merge-identical">
                    <CheckCircle2 size={16} strokeWidth={2.2} />
                    <span>{t("No file changes")}</span>
                  </div>
                )}
              </section>

              <div className="skill-merge-impact">
                <strong>{t("Merge impact")}</strong>
                <span>{t("{{skills}} entries become one · {{profiles}} profiles updated · {{installs}} installs relinked", {
                  skills: mergePreview.entries.length,
                  profiles: mergePreview.profileCount,
                  installs: mergePreview.entries
                    .filter((entry) => entry.id !== mergeKeepId)
                    .reduce((total, entry) => total + entry.installCount, 0)
                })}</span>
              </div>
            </div>

            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                disabled={Boolean(mergeOperation)}
                onClick={() => setMergePreview(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                aria-busy={mergeOperation === "merging"}
                disabled={Boolean(mergeOperation)}
                onClick={() => void confirmMerge()}
              >
                {mergeOperation === "merging" ? (
                  <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                ) : (
                  <Combine size={14} strokeWidth={2.2} />
                )}
                {t(mergeOperation === "merging" ? "Merging..." : "Merge Skills")}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      <SkillUpdateSettingsDialog
        skill={sourceCandidate}
        busy={isBusy}
        onDismiss={() => setSourceCandidate(undefined)}
        onSave={onSaveUpdateSettings}
      />

      {deleteCandidate ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => setDeleteCandidate(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label={t("Delete library skill")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Remove from library")}</div>
                <p className="muted ui-dialog-description">
                  {(skillUsage[deleteCandidate.id] ?? []).length > 0
                    ? t("{{name}} is used by {{profiles}}. Remove it from those profiles first.", {
                        name: deleteCandidate.name,
                        profiles: (skillUsage[deleteCandidate.id] ?? []).join(", ")
                      })
                    : (() => {
                        const installCount = installsFor(deleteCandidate.id).filter(
                          (item) => item.status === "managed"
                        ).length;
                        return installCount > 0
                          ? t(
                              installCount === 1
                                ? "Remove {{name}} and 1 managed Agent install? Unmanaged copies are kept."
                                : "Remove {{name}} and {{count}} managed Agent installs? Unmanaged copies are kept.",
                              { name: deleteCandidate.name, count: installCount }
                            )
                          : t("Remove {{name}} from the shared library?", { name: deleteCandidate.name });
                      })()}
                </p>
              </div>
            </header>
            <footer className="preview-actions">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                onClick={() => setDeleteCandidate(undefined)}
              >
                {t("Cancel")}
              </button>
              {(skillUsage[deleteCandidate.id] ?? []).length > 0 ? (
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => {
                    onReviewSkillUsage(deleteCandidate.id);
                    setDeleteCandidate(undefined);
                  }}
                >
                  {t("Review profiles")}
                </button>
              ) : (
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => {
                    onRemoveLibrarySkill(deleteCandidate.id);
                    setDeleteCandidate(undefined);
                  }}
                >
                  {installsFor(deleteCandidate.id).some((item) => item.status === "managed")
                    ? t("Remove skill and installs")
                    : t("Remove skill")}
                </button>
              )}
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {autoCleanupReviewOpen ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => setAutoCleanupReviewOpen(false)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact cleanup-bulk-dialog ui-dialog-shell"
            role="dialog"
            aria-label={t("Clean up local Skills")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Clean up local Skills")}</div>
                <p className="muted ui-dialog-description">
                  {t("AgentEnv will run the safe actions below. Every changed path is backed up before cleanup starts.")}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list ui-dialog-body">
              {([...cleanupRequestsByEffect.entries()]).map(([effect, items]) => (
                <section className="cleanup-bulk-effect" key={effect}>
                  <div>
                    <strong>{t(cleanupEffectLabel(effect))}</strong>
                    <span>{items.length}</span>
                  </div>
                  <p>{items.map((item) => item.name).join(", ")}</p>
                </section>
              ))}
              {sharedReplacementCandidates.length > 0 ? (
                <section className="cleanup-bulk-effect">
                  <div>
                    <strong>{t("Move Skills out of shared folder")}</strong>
                    <span>{sharedReplacementCandidates.length}</span>
                  </div>
                  <p>
                    {sharedReplacementCandidates.map((group) => {
                      const decisions = preparedTargetsForCleanupGroup(group)
                        .map((target) =>
                          target.disposition === "install"
                            ? `${targetNameFor(target.targetId, targetNames, target.targetId)}: ${t("Install as {{name}}", { name: target.targetName })}`
                            : `${targetNameFor(target.targetId, targetNames, target.targetId)}: ${t("Do not install")}`
                        )
                        .join("; ");
                      return `${group.primary?.name ?? group.skillKey}${decisions ? ` - ${decisions}` : ""}`;
                    }).join("\n")}
                  </p>
                </section>
              ) : null}
              <small>{t("Each Skill is backed up independently. A failure does not undo completed Skills.")}</small>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                onClick={() => setAutoCleanupReviewOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => void runAutomaticCleanup("all", automaticCleanupRequests)}
              >
                {t("Clean up {{count}} skills", { count: readyCleanupCount })}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {sharedTargetReview?.sharedMigration?.state === "waiting" ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => setSharedTargetReviewKey(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact shared-target-review-dialog ui-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={t("Prepare shared Skill migration")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Prepare affected Agents")}</div>
                <p className="muted ui-dialog-description">
                  {t("{{name}} is still loaded by {{count}} Agents from one shared folder.", {
                    name: sharedTargetReview.primary?.name ?? sharedTargetReview.skillKey,
                    count: sharedTargetReview.sharedMigration.pendingConsumers.length
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list ui-dialog-body">
              {sharedTargetReview.sharedMigration.pendingConsumers.map((targetId) => (
                <span key={targetId}>{t(targetNameFor(targetId, targetNames, targetId))}</span>
              ))}
              <p className="shared-target-review-guidance">
                {t("Apply the intended Profile to each Agent, then return here to move this Skill out of the shared folder.")}
              </p>
              <small>{t("Profiles without this Skill will keep it absent from that Agent after the shared copy is removed.")}</small>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                onClick={() => setSharedTargetReviewKey(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="secondary-action shared-keep-action"
                type="button"
                disabled={Boolean(sharedOperation)}
                onClick={() => void changeSharedRetention(sharedTargetReview, true).then((succeeded) => {
                  if (succeeded) setSharedTargetReviewKey(undefined);
                })}
              >
                {t("Keep shared copy")}
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => {
                  setSharedTargetReviewKey(undefined);
                  onOpenProfiles();
                }}
              >
                {t("Open Profiles")}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {sharedRetireCandidate?.sharedMigration ? createPortal(
        <div
          className="preview-modal-backdrop"
          onClick={sharedOperation ? undefined : () => setSharedRetireKey(undefined)}
        >
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact shared-retire-dialog ui-dialog-shell"
            role="dialog"
            aria-label={t("Move Skill out of shared folder")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Move out of shared folder")}</div>
                <p className="muted ui-dialog-description">
                  {t("Each Agent will use its saved Profile instead of the shared {{name}} copy.", {
                    name: sharedRetireCandidate.primary?.name ?? sharedRetireCandidate.skillKey
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-retire-summary ui-dialog-body">
              <div>
                <strong>{t("After moving")}</strong>
                {sharedRetireTargets.length > 0 ? (
                  <div className="cleanup-migration-decisions">
                    {sharedRetireTargets.map((target) => (
                      <span key={target.targetId}>
                        <strong>{targetNameFor(target.targetId, targetNames, target.targetId)}</strong>
                        {t(
                          target.disposition === "install"
                            ? "Install as {{name}}"
                            : "Do not install",
                          { name: target.targetName }
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span>{t("No installed consumers detected")}</span>
                )}
              </div>
              {sharedRetireCandidate.sharedMigration.paths.map((path) => (
                <PreviewText
                  key={path}
                  ariaLabel={t("Full shared path {{path}}", { path })}
                  className="cleanup-option-path"
                  text={path}
                  tooltipClassName="library-source-tooltip"
                />
              ))}
              <small>{t("The Library copy is kept. One backup covers the shared copy, Agent copies, and saved Agent decisions; any failed step restores all of them.")}</small>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                disabled={Boolean(sharedOperation)}
                onClick={() => setSharedRetireKey(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                aria-busy={sharedOperation?.action === "retire"}
                disabled={Boolean(sharedOperation)}
                onClick={() => void retireSharedCopy()}
              >
                  {sharedOperation?.action === "retire" ? (
                    <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
                  ) : null}
                  {t(sharedOperation?.action === "retire" ? "Moving..." : "Move out of shared folder")}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {disableCandidate ? createPortal(
        <div
          className="preview-modal-backdrop"
          onClick={availabilityOperation ? undefined : () => setDisableCandidate(undefined)}
        >
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact skill-availability-dialog"
            role="dialog"
            aria-label={t("Disable library skill")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="skill-availability-dialog__header">
              <span className="skill-availability-dialog__icon" aria-hidden="true">
                <CircleSlash2 size={18} strokeWidth={2.2} />
              </span>
              <span>
                <strong>{t("Disable skill?")}</strong>
                <small>{disableCandidate.name}</small>
              </span>
            </header>
            <div className="skill-availability-dialog__effects" role="list">
              <span role="listitem">
                <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                {t("Keep in Library")}
              </span>
              <span role="listitem">
                <CircleSlash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                {t("Hide from Profile selection")}
              </span>
              {(skillUsage[disableCandidate.id] ?? []).length > 0 ? (
                <span role="listitem">
                  <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
                  {t("Remove managed installs on next Apply")}
                </span>
              ) : null}
            </div>
            {(skillUsage[disableCandidate.id] ?? []).length > 0 ? (
              <p className="skill-availability-dialog__usage">
                {t(
                  (skillUsage[disableCandidate.id] ?? []).length === 1
                    ? "1 Profile references this skill."
                    : "{{count}} Profiles reference this skill.",
                  { count: (skillUsage[disableCandidate.id] ?? []).length }
                )}
              </p>
            ) : null}
            <footer className="preview-actions skill-availability-dialog__actions">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                disabled={Boolean(availabilityOperation)}
                onClick={() => setDisableCandidate(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={Boolean(availabilityOperation)}
                onClick={() => void runAvailabilityChange({ id: disableCandidate.id, enabled: false })}
              >
                {availabilityOperation ? (
                  <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
                ) : null}
                {t(availabilityOperation ? "Disabling..." : "Disable globally")}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {bulkUpdatePlans ? (
        <BulkSkillUpdateDialog
          plans={bulkUpdatePlans}
          failures={bulkUpdateFailures}
          updateRun={updateRun}
          isBusy={isBusy}
          previewingAllUpdates={previewingAllUpdates}
          updateActivityBusy={updateActivityBusy}
          onClose={onCloseBulkUpdatePreview}
          onPreview={(ids) => void onPreviewAllLibrarySkillUpdates(ids)}
          onUpdate={onUpdateAllLibrarySkills}
        />
      ) : null}

      {externalImport && externalImportGroup ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => setExternalImport(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact external-skill-dialog ui-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={t("Import external skill")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">
                  {t("Import {{name}}", { name: externalImportGroup.primary?.name ?? externalImport.skillKey })}
                </div>
                <p className="muted ui-dialog-description">
                  {selectedExternalImport?.contentMatchesLibrary
                    ? t("Review the matching Library copy and any source changes. External files and lock data stay unchanged.")
                    : selectedExternalImport?.externalEvidence?.manager === "skills-cli"
                      ? t("Create an independent Library copy. Skills CLI files and lock data stay unchanged.")
                      : t("Create an independent Library copy. {{manager}} files stay unchanged.", {
                          manager: externalManagerLabel(selectedExternalImport)
                        })}
                </p>
              </div>
            </header>
            <fieldset className="cleanup-review-group external-source-group ui-dialog-body">
              <legend>{t("Source copy")}</legend>
              {externalImportItems.map((item) => (
                <label className="cleanup-review-option" key={`external-${item.path}`}>
                  <input
                    type="radio"
                    name="external-skill-source"
                    checked={externalImport.sourcePath === item.path}
                    disabled={item.externalEvidence?.state === "broken-link"}
                    onChange={() =>
                      setExternalImport({
                        skillKey: externalImport.skillKey,
                        sourcePath: item.path
                      })
                    }
                  />
                  <span>
                    <strong>{t(cleanupLocationLabel(item, targetNames))}</strong>
                    <PreviewText
                      ariaLabel={t("Full external source path {{path}}", { path: item.path })}
                      className="cleanup-option-path"
                      text={item.path}
                      tooltipClassName="library-source-tooltip"
                    />
                    {item.modifiedAt ? (
                      <small>{t("Modified")} · {formatDate(item.modifiedAt)}</small>
                    ) : null}
                  </span>
                  <em>
                    {item.externalEvidence?.state === "broken-link"
                      ? t("Missing")
                      : t("Content {{hash}}", { hash: item.contentHash.slice(0, 7) })}
                  </em>
                </label>
              ))}
            </fieldset>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                disabled={localImportOperation}
                onClick={() => setExternalImport(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                aria-busy={localImportOperation}
                disabled={localImportOperation || !externalImportItems.some(
                  (item) =>
                    item.path === externalImport.sourcePath &&
                    item.externalEvidence?.state !== "broken-link"
                )}
                onClick={() => void importSelectedExternalSkill()}
              >
                {localImportOperation ? (
                  <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
                ) : null}
                {t(
                  localImportOperation
                    ? "Reviewing..."
                    : selectedExternalImport?.contentMatchesLibrary
                      ? "Review Library copy"
                      : "Import copy"
                )}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {cleanupDetails ? createPortal(
        <div className="preview-modal-backdrop" onClick={() => setCleanupDetailsKey(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact cleanup-details-dialog ui-dialog-shell"
            role="dialog"
            aria-label={t("Skill details {{id}}", { id: cleanupDetails.skillKey })}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">
                  {cleanupDetails.primary?.name ?? cleanupDetails.skillKey}
                </div>
                <p className="muted ui-dialog-description">
                  {cleanupDetails.primary?.description || t("Local Skill details and detected locations.")}
                </p>
              </div>
              <span className={`resource-chip resource-chip--${
                cleanupPresentationChipClass(cleanupDetails.presentation.state)
              }`}>
                {t(cleanupPresentationLabel(cleanupDetails.presentation.state))}
              </span>
            </header>
            <div className="cleanup-details-list ui-dialog-body">
              {cleanupDetailVersions.map((version) => (
                <section
                  aria-label={t(
                    version.key === "unavailable" ? "Unavailable links" : "Version {{hash}}",
                    { hash: version.key.slice(0, 7) }
                  )}
                  className="cleanup-details-version"
                  key={version.key}
                >
                  <header>
                    <strong>
                      {t(
                        version.key === "unavailable" ? "Unavailable links" : "Version {{hash}}",
                        { hash: version.key.slice(0, 7) }
                      )}
                    </strong>
                    <span>{t("{{count}} copies", { count: version.items.length })}</span>
                  </header>
                  {version.items.map((item) => (
                    <div className="cleanup-details-location" key={`${item.status}-${item.path}`}>
                      <div>
                        <strong>{t(cleanupLocationLabel(item, targetNames))}</strong>
                        <div className="cleanup-details-location__actions">
                          <span
                            className={`resource-chip resource-chip--${cleanupInventoryStatusClass(item)}`}
                          >
                            {t(cleanupInventoryStatusLabel(item))}
                          </span>
                          {onSetSkillPathPolicies &&
                          !item.sharedLocation &&
                          (item.status === "outside" || item.status === "kept-outside") ? (
                            <button
                              className="secondary-action cleanup-path-policy-action"
                              type="button"
                              disabled={Boolean(pathPolicyOperationPath)}
                              aria-busy={pathPolicyOperationPath === item.path}
                              onClick={() =>
                                void changePathPolicy(
                                  item,
                                  item.status === "kept-outside" ? undefined : "keep-outside"
                                )}
                            >
                              {pathPolicyOperationPath === item.path ? (
                                <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
                              ) : null}
                              {t(
                                item.status === "kept-outside"
                                  ? "Review again"
                                  : "Keep outside AgentEnv"
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <PreviewText
                        ariaLabel={t("Full detail path {{path}}", { path: item.path })}
                        className="cleanup-option-path"
                        text={item.path}
                        tooltipClassName="library-source-tooltip"
                      />
                      {item.modifiedAt ? (
                        <small>{t("Modified")} · {formatDate(item.modifiedAt)}</small>
                      ) : null}
                      <small>
                        {item.libraryId ? `${t("Library")}: ${item.libraryId}` : t("Not in Library")}
                      </small>
                      {item.sharedLocation ? <small>{t("Shared compatibility location")}</small> : null}
                      {(item.runtimeStates ?? []).map((state) =>
                        state.availability !== "enabled" || state.issues.length > 0 ? (
                          <div className="cleanup-runtime-state" key={state.targetId}>
                            <small>
                              {t("{{target}} runtime: {{state}}", {
                                target: targetNameFor(state.targetId, targetNames, "Unknown Agent"),
                                state: t(state.availability)
                              })}
                            </small>
                            {state.issues.map((issue) => (
                              <PreviewText
                                ariaLabel={t("Full runtime issue for {{path}}", { path: item.path })}
                                className="cleanup-option-path"
                                key={`${issue.code}:${issue.message}`}
                                text={issue.message}
                                tooltipClassName="library-source-tooltip"
                              />
                            ))}
                          </div>
                        ) : null
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                onClick={() => setCleanupDetailsKey(undefined)}
              >
                {t("Close")}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {cleanupDraft && cleanupCandidate ? createPortal(
        <div
          className="preview-modal-backdrop"
          onClick={() => {
            if (!cleanupOperationKey) setCleanupDraft(undefined);
          }}
        >
          <section
            ref={modalDialogRef}
            className="profile-form-dialog cleanup-review-dialog ui-dialog-shell"
            role="dialog"
            aria-label={t("Review skill cleanup")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">
                  {t(cleanupCandidate.presentation.action === "add-to-library" ? "Add {{name}} to Library" : "Review {{name}}", {
                    name: cleanupCandidate.primary?.name ?? cleanupDraft.skillKey
                  })}
                </div>
                <p className="muted ui-dialog-description">
                  {cleanupUsesExistingLibrary
                    ? t("Review the differences, choose the canonical Library version, then confirm which local copies to normalize.")
                    : cleanupCandidate.sharedMigration
                      ? t("Choose the version to keep. AgentEnv will add it to Library, keep one shared copy active, and remove redundant Agent copies after backup.")
                      : t("Choose the local copy to keep in Library, then choose which copies become managed deployments.")}
                </p>
              </div>
            </header>
            <div className="cleanup-review-content ui-dialog-body">
              {cleanupUsesExistingLibrary ? (
                <fieldset className="cleanup-review-group">
                  <legend>
                    {t("Library version")}
                    <small>{t("Choose whether Library or a reviewed local copy should become canonical.")}</small>
                  </legend>
                  <label className="cleanup-review-option">
                    <input
                      type="radio"
                      name="library-version-action"
                      checked={cleanupDraft.libraryAction === "keep"}
                      onChange={() => setCleanupDraft({ ...cleanupDraft, libraryAction: "keep" })}
                    />
                    <span>
                      <strong>{t("Keep Library version")}</strong>
                      <small>{t("Replace local copies with the current canonical content.")}</small>
                      {cleanupLibrarySkill?.updatedAt ? (
                        <small>{t("Modified")} · {formatDate(cleanupLibrarySkill.updatedAt)}</small>
                      ) : null}
                    </span>
                  </label>
                  <label className="cleanup-review-option">
                    <input
                      type="radio"
                      name="library-version-action"
                      checked={cleanupDraft.libraryAction === "replace"}
                      onChange={() => setCleanupDraft({ ...cleanupDraft, libraryAction: "replace" })}
                    />
                    <span>
                      <strong>{t("Use a local version")}</strong>
                      <small>{t("Back up Library, then replace it with the selected local content.")}</small>
                    </span>
                  </label>
                  {cleanupDraft.libraryAction === "replace" ? cleanupCandidate.activeItems
                    .filter(isCleanupManageable)
                    .map((item) => (
                      <label className="cleanup-review-option cleanup-review-option--nested" key={`canonical-${item.path}`}>
                        <input
                          type="radio"
                          name="canonical-skill-copy"
                          checked={cleanupDraft.canonicalPath === item.path}
                          onChange={() => setCleanupDraft({
                            ...cleanupDraft,
                            canonicalPath: item.path,
                            selectedPaths: cleanupDraft.selectedPaths.includes(item.path)
                              ? cleanupDraft.selectedPaths
                              : cleanupDraft.selectedPaths.concat(item.path)
                          })}
                        />
                        <span>
                          <strong>{t(cleanupLocationLabel(item, targetNames))}</strong>
                          <PreviewText
                            ariaLabel={t("Full source path {{path}}", { path: item.path })}
                            className="cleanup-option-path"
                            text={item.path}
                            tooltipClassName="library-source-tooltip"
                          />
                          {item.modifiedAt ? (
                            <small>{t("Modified")} · {formatDate(item.modifiedAt)}</small>
                          ) : null}
                        </span>
                        <code>{t("Content {{hash}}", { hash: item.contentHash.slice(0, 7) })}</code>
                      </label>
                    )) : null}
                </fieldset>
              ) : (
                <fieldset className="cleanup-review-group">
                  <legend>
                    {t("Version to keep in Library")}
                    <small>{t("Choose the copy whose contents you want to preserve.")}</small>
                  </legend>
                  {cleanupCandidate.items
                    .filter((item) => item.status !== "managed" && item.status !== "kept-outside")
                    .map((item) => (
                      <label className="cleanup-review-option" key={`canonical-${item.path}`}>
                        <input
                          type="radio"
                          name="canonical-skill-copy"
                          checked={cleanupDraft.canonicalPath === item.path}
                          onChange={() =>
                            setCleanupDraft({
                              ...cleanupDraft,
                              canonicalPath: item.path,
                              selectedPaths: cleanupDraft.selectedPaths.includes(item.path)
                                ? cleanupDraft.selectedPaths
                                : cleanupDraft.selectedPaths.concat(item.path)
                            })
                          }
                        />
                        <span>
                          <strong>{t(cleanupLocationLabel(item, targetNames))}</strong>
                          <PreviewText
                            ariaLabel={t("Full source path {{path}}", { path: item.path })}
                            className="cleanup-option-path"
                            text={item.path}
                            tooltipClassName="library-source-tooltip"
                          />
                          {item.description ? (
                            <PreviewText
                              ariaLabel={t("Full description for {{path}}", { path: item.path })}
                              className="cleanup-option-description"
                              text={item.description}
                            />
                          ) : null}
                          {item.modifiedAt ? (
                            <small>{t("Modified")} · {formatDate(item.modifiedAt)}</small>
                          ) : null}
                        </span>
                        <code>{t("Content {{hash}}", { hash: item.contentHash.slice(0, 7) })}</code>
                      </label>
                    ))}
                </fieldset>
              )}
              <fieldset className="cleanup-review-group">
                <legend>
                  {t(cleanupCandidate.sharedMigration ? "Copies to clean up" : "Locations to manage")}
                  <small>
                    {t(cleanupCandidate.sharedMigration
                      ? "The shared copy stays active until Profiles are ready. Redundant Agent copies are removed."
                      : "Selected copies are backed up, then replaced by the Library version.")}
                  </small>
                </legend>
                {cleanupCandidate.items.map((item) => (
                  <label className="cleanup-review-option" key={`location-${item.path}`}>
                    <input
                      type="checkbox"
                      checked={cleanupDraft.selectedPaths.includes(item.path)}
                      disabled={
                        item.status === "managed" ||
                        item.status === "kept-outside" ||
                        Boolean(cleanupCandidate.sharedMigration) ||
                        (cleanupDraft.libraryAction !== "keep" && cleanupDraft.canonicalPath === item.path)
                      }
                      onChange={() => setCleanupDraft({
                        ...cleanupDraft,
                        selectedPaths: cleanupDraft.selectedPaths.includes(item.path)
                          ? cleanupDraft.selectedPaths.filter((path) => path !== item.path)
                          : cleanupDraft.selectedPaths.concat(item.path)
                      })}
                    />
                    <span>
                      <strong>{t(cleanupLocationLabel(item, targetNames))}</strong>
                      <PreviewText
                        ariaLabel={t("Full managed path {{path}}", { path: item.path })}
                        className="cleanup-option-path"
                        text={item.path}
                        tooltipClassName="library-source-tooltip"
                      />
                      {item.modifiedAt ? (
                        <small>{t("Modified")} · {formatDate(item.modifiedAt)}</small>
                      ) : null}
                    </span>
                    <em>
                      {item.status === "managed"
                        ? t("Already managed")
                        : item.status === "kept-outside"
                          ? t("Kept outside")
                          : cleanupCandidate.sharedMigration && item.sharedLocation
                            ? t("Keep active")
                            : cleanupCandidate.sharedMigration
                              ? t("Remove duplicate")
                          : !cleanupUsesExistingLibrary && cleanupDraft.canonicalPath === item.path
                            ? t("Source copy")
                            : t("Replace")}
                    </em>
                  </label>
                ))}
              </fieldset>
              <p className="cleanup-safety-note">
                <strong>{t("Backup included")}</strong>
                {" "}{t("All selected copies can be restored from History.")}
              </p>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                disabled={Boolean(cleanupOperationKey)}
                onClick={() => setCleanupDraft(undefined)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                aria-busy={cleanupOperationKey === cleanupDraft.skillKey}
                disabled={cleanupDraft.selectedPaths.length === 0 || Boolean(cleanupOperationKey)}
                onClick={() => {
                  const request: SkillCleanupRequest = {
                    skillKey: cleanupDraft.skillKey,
                    libraryId: cleanupDraft.libraryId,
                    canonicalPath: cleanupDraft.canonicalPath,
                    libraryAction: cleanupDraft.libraryAction,
                    mode: cleanupCandidate.sharedMigration
                      ? "shared-compatibility"
                      : "target-copies",
                    sharedLocations: cleanupCandidate.sharedMigration
                      ? cleanupCandidate.items
                          .filter((item) => item.sharedLocation)
                          .map((item) => ({ path: item.path, contentHash: item.contentHash }))
                      : undefined,
                    locations: cleanupCandidate.items
                      .filter(
                        (item) =>
                          cleanupDraft.selectedPaths.includes(item.path) &&
                          !item.sharedLocation
                      )
                      .map((item) => ({
                        targetId: item.foundIn[0] ?? "",
                        path: item.path,
                        contentHash: item.contentHash
                      }))
                  };
                  setCleanupOperationKey(cleanupDraft.skillKey);
                  void onConsolidateSkillGroup(request).finally(() => {
                    setCleanupOperationKey(undefined);
                    setCleanupDraft(undefined);
                  });
                }}
              >
                {cleanupOperationKey === cleanupDraft.skillKey ? (
                  <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : null}
                {t(
                  cleanupOperationKey === cleanupDraft.skillKey
                    ? "Applying..."
                    : cleanupCandidate.presentation.action === "add-to-library"
                      ? "Add to Library"
                      : "Apply cleanup"
                )}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {activeTool === "discoveries" ? (
        <section className="library-drawer" aria-label={t("Environment skills")}>
          <div className="library-drawer__header">
            <div>
              <strong>
                {t("Local Skill Cleanup")}
                <InfoTip label={t("Review local Skill copies, add a canonical version to Library, and remove redundant copies with a restorable backup.")} />
              </strong>
            </div>
            <div className="library-drawer__actions">
              <button
                className="secondary-action library-drawer__refresh"
                type="button"
                aria-label={t("Refresh local skills")}
                disabled={Boolean(automaticCleanupKey) || isRefreshingInventory}
                onClick={() => void onRefreshInventory()}
              >
                <RefreshCw
                  className={isRefreshingInventory ? "is-spinning" : undefined}
                  size={14}
                  strokeWidth={2.2}
                />
                <span>{t(isRefreshingInventory ? "Refreshing" : "Refresh")}</span>
              </button>
              <IconButton
                label={t("Close library tool")}
                disabled={Boolean(automaticCleanupKey) || isRefreshingInventory}
                onClick={onCloseTool}
                variant="ghost"
              >
                <X size={16} strokeWidth={2.2} />
              </IconButton>
            </div>
          </div>
          <section className="resource-section target-discovery-section">
            <div className="cleanup-section-heading">
              <div>
                <div className="resource-heading">
                  {t("Skills on this Mac")}
                  <InfoTip label={t("Each group shows one Skill, its detected copies, and the next safe cleanup action.")} />
                </div>
                <small>{migrationSummary || t("No cleanup actions needed")}</small>
              </div>
            </div>
            <div className="resource-list resource-list--unmanaged">
              {cleanupGroups.length === 0 ? (
                <p className="muted library-empty">
                  {t("No Agent Skills detected. Install Skills for an enabled Agent and scan again.")}
                </p>
              ) : null}
              {cleanupGroups.map((group, index) => {
                const sectionStarts = index === 0 || cleanupGroups[index - 1].bucket !== group.bucket;
                const collapsibleBucket =
                  group.bucket === "managed" || group.bucket === "kept"
                    ? group.bucket
                    : undefined;
                const sectionCanCollapse = Boolean(collapsibleBucket);
                const sectionExpanded = collapsibleBucket
                  ? expandedCleanupBuckets[collapsibleBucket]
                  : true;
                const hasIgnored = group.items.some((skill) => skill.status === "kept-outside");
                const allKeptOutside = group.activeItems.length === 0;
                const canIgnore = group.activeItems.some((skill) => skill.status !== "managed");
                const sharedMigration = group.sharedMigration;
                const linkedLibraryId = group.items.find((item) => item.libraryId)?.libraryId;
                const contentVersionCount = new Set(
                  group.activeItems.map((item) => item.contentHash).filter(Boolean)
                ).size;
                const defaultCleanupSummary = `${group.primary?.description || group.skillKey} · ${group.items.length} ${group.items.length === 1 ? "location" : "locations"}`;
                const decisionSummary = group.bucket !== "decision"
                  ? undefined
                  : contentVersionCount > 1 && !linkedLibraryId
                    ? t("{{count}} different content versions · {{locations}} locations", {
                        count: contentVersionCount,
                        locations: group.items.length
                      })
                    : group.presentation.state === "local-changes-found" && linkedLibraryId
                      ? t("Shared copy differs from Library")
                      : group.presentation.state === "unavailable"
                        ? t("Skill content could not be read safely")
                        : undefined;
                const latestModifiedAt = group.activeItems
                  .map((item) => item.modifiedAt)
                  .filter((value): value is string => Boolean(value))
                  .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
                const cleanupSummaryText = decisionSummary ?? defaultCleanupSummary;
                const cleanupLocationsDisplay = [
                  latestModifiedAt ? `${t("Modified")} ${formatDate(latestModifiedAt)}` : undefined,
                  group.items.map((skill) => cleanupLocationLabel(skill, targetNames)).join(" + ")
                ].filter(Boolean).join(" · ");
                const contentChoiceLabel =
                  group.bucket === "decision" && contentVersionCount > 1 && !linkedLibraryId
                    ? t("{{count}} versions", { count: contentVersionCount })
                    : undefined;
                const chipLabelKey = group.bucket === "ready"
                  ? "Ready"
                  : cleanupPresentationCompactLabel(group.presentation.state);
                const chipDetailKey = group.bucket === "ready" && group.automaticEffect
                  ? cleanupEffectLabel(group.automaticEffect)
                  : cleanupPresentationLabel(group.presentation.state);
                const chipLabel = contentChoiceLabel ?? t(chipLabelKey);
                const chipDetail = decisionSummary ?? t(chipDetailKey);
                const chipClass = group.bucket === "ready"
                  ? "managed"
                  : cleanupPresentationChipClass(group.presentation.state);
                const actionLabel = t(cleanupActionLabel(group.presentation.action));
                const actionDisplayLabel = t(cleanupActionDisplayLabel(group.presentation.action));
                const managedInstallCount = group.activeItems.filter(
                  (item) => item.status === "managed" && !item.sharedLocation
                ).length;
                const libraryRelationText = linkedLibraryId
                  ? managedInstallCount > 0
                    ? `${t("Library")} / ${linkedLibraryId} · ${t("{{count}} managed installs", { count: managedInstallCount })}`
                    : `${t("Library")} / ${linkedLibraryId}`
                  : undefined;
                const groupIsWorking = sharedOperation?.skillKey === group.skillKey;
                const sharedProgressText = sharedMigration?.state === "waiting"
                  ? t("{{count}} Agents still load this shared copy", {
                      count: sharedMigration.pendingConsumers.length
                    })
                  : sharedMigration?.state === "ready"
                    ? t("All consumer Agents are ready")
                    : undefined;
                const cleanupActionId = `cleanup:${group.skillKey}`;
                const runPrimaryAction = () => {
                  if (
                    group.presentation.action === "add-to-library" ||
                    group.presentation.action === "manage-copies" ||
                    group.presentation.action === "review-differences" ||
                    group.presentation.action === "review-drift"
                  ) {
                    openCleanupReview(group);
                    return;
                  }
                  if (group.presentation.action === "review-details") {
                    setCleanupDetailsKey(group.skillKey);
                    return;
                  }
                  if (group.presentation.action === "review-paths") {
                    if (group.activeItems.some(isCleanupManageable)) {
                      openCleanupReview(group);
                    } else {
                      setCleanupDetailsKey(group.skillKey);
                    }
                    return;
                  }
                  if (group.presentation.action === "review-agents") {
                    setSharedTargetReviewKey(group.skillKey);
                    return;
                  }
                  if (group.presentation.action === "move-from-shared") {
                    setSharedRetireKey(group.skillKey);
                  }
                };

                return (
                  <Fragment key={group.skillKey}>
                    {sectionStarts ? (
                      <CleanupBucketHeader
                        actionDisabled={Boolean(automaticCleanupKey)}
                        actionWorking={automaticCleanupKey === "all"}
                        bucket={group.bucket}
                        collapsible={sectionCanCollapse}
                        count={cleanupGroupsByBucket[group.bucket].length}
                        expanded={sectionExpanded}
                        readyCleanupCount={readyCleanupCount}
                        onReviewCleanup={() => setAutoCleanupReviewOpen(true)}
                        onToggle={() => {
                          if (!collapsibleBucket) return;
                          setExpandedCleanupBuckets((current) => ({
                            ...current,
                            [collapsibleBucket]: !sectionExpanded
                          }));
                        }}
                      />
                    ) : null}
                    {sectionExpanded ? (
                  <div
                    aria-label={t("Cleanup group {{id}}", { id: group.skillKey })}
                    className="resource-row cleanup-group-row"
                    role="group"
                  >
                    <span className="resource-avatar cleanup-group-icon" aria-hidden="true">
                      <Folder size={17} strokeWidth={2.1} />
                    </span>
                    <div className="resource-row__main">
                      <div className="cleanup-group-heading">
                        <PreviewText
                          ariaLabel={t("Full skill name {{id}}", { id: group.skillKey })}
                          className="cleanup-group-name"
                          text={group.primary?.name ?? group.skillKey}
                        />
                      </div>
                      {libraryRelationText ? (
                        <PreviewText
                          ariaLabel={t("Full Library relationship {{id}}", { id: group.skillKey })}
                          className="cleanup-group-owner"
                          text={libraryRelationText}
                        />
                      ) : null}
                      {sharedProgressText ? (
                        <PreviewText
                          ariaLabel={t("Full shared copy state {{id}}", { id: group.skillKey })}
                          className="cleanup-shared-progress"
                          text={sharedProgressText}
                        />
                      ) : null}
                      <PreviewText
                        ariaLabel={t("Full cleanup summary {{id}}", { id: group.skillKey })}
                        className="cleanup-group-summary"
                        displayText={cleanupSummaryText}
                        text={cleanupSummaryText}
                      />
                      <PreviewText
                        ariaLabel={t("Full cleanup locations {{id}}", { id: group.skillKey })}
                        className="cleanup-group-locations"
                        displayText={cleanupLocationsDisplay}
                        focusable
                        text={group.items
                          .map((skill) => `${cleanupLocationLabel(skill, targetNames)} · ${skill.path}`)
                          .join("\n")}
                        tooltipClassName="library-source-tooltip"
                      />
                    </div>
                    <PreviewText
                      ariaLabel={t("Full cleanup state {{id}}", { id: group.skillKey })}
                      className={`resource-chip resource-chip--${chipClass} cleanup-group-state`}
                      displayText={chipLabel}
                      preferredPlacement="top"
                      text={chipDetail}
                    />
                    <div className="cleanup-group-actions">
                      {(group.bucket !== "ready" || !group.automaticEffect) && group.presentation.action !== "none" ? (
                        <button
                          className="secondary-action cleanup-current-action"
                          type="button"
                          aria-label={t("{{action}} {{id}}", { action: t(actionLabel), id: group.skillKey })}
                          disabled={Boolean(automaticCleanupKey) || Boolean(sharedOperation)}
                          onClick={runPrimaryAction}
                        >
                          {actionDisplayLabel}
                        </button>
                      ) : null}
                      <button
                        className="icon-action"
                        type="button"
                        aria-label={t("More cleanup actions for {{id}}", { id: group.skillKey })}
                        aria-expanded={openActionId === cleanupActionId}
                        aria-haspopup="menu"
                        disabled={Boolean(automaticCleanupKey) || groupIsWorking}
                        onClick={(event) => toggleActionMenu(cleanupActionId, event.currentTarget)}
                      >
                        <MoreHorizontal size={16} strokeWidth={2.2} />
                      </button>
                      {openActionId === cleanupActionId && openAction
                        ? createPortal(
                            <ActionMenu
                              ariaLabel={t("Cleanup actions for {{id}}", { id: group.skillKey })}
                              className="row-action-popover cleanup-action-popover"
                              data-skill-action-popover={cleanupActionId}
                              style={{ left: openAction.left, top: openAction.top }}
                            >
                              <button
                                className="row-action-item"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setCleanupDetailsKey(group.skillKey);
                                  setOpenAction(undefined);
                                }}
                              >
                                <Search size={14} strokeWidth={2.2} />
                                <span><strong>{t("Details")}</strong></span>
                              </button>
                              {sharedMigration && sharedMigration.state !== "outside" && sharedMigration.state !== "kept" ? (
                                <button
                                  className="row-action-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    void changeSharedRetention(group, true);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <Link2Off size={14} strokeWidth={2.2} />
                                  <span><strong>{t("Keep shared copy")}</strong></span>
                                </button>
                              ) : sharedMigration?.state === "kept" ? (
                                <button
                                  className="row-action-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    void changeSharedRetention(group, false);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <RefreshCw size={14} strokeWidth={2.2} />
                                  <span><strong>{t("Review again")}</strong></span>
                                </button>
                              ) : null}
                              {!sharedMigration && canIgnore && !hasIgnored ? (
                                <button
                                  className="row-action-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onKeepSkillGroupOutside(group.skillKey);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <Link2Off size={14} strokeWidth={2.2} />
                                  <span><strong>{t("Keep outside AgentEnv")}</strong></span>
                                </button>
                              ) : null}
                              {!sharedMigration && hasIgnored ? (
                                <button
                                  className="row-action-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onReviewSkillGroupAgain(group.skillKey);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <RotateCcw size={14} strokeWidth={2.2} />
                                  <span><strong>{t(allKeptOutside ? "Review again" : "Review kept paths")}</strong></span>
                                </button>
                              ) : null}
                            </ActionMenu>,
                            document.body
                          )
                        : null}
                    </div>
                  </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            <section className="cleanup-history-section" aria-label={t("Cleanup history")}>
              <div className="resource-heading">
                {t("History")}
                <InfoTip label={t("Every cleanup creates a restorable backup. Restoring returns the affected local copies to their state before cleanup.")} />
              </div>
              {cleanupBackups.length === 0 ? (
                <p className="muted library-empty">{t("No cleanup backups yet.")}</p>
              ) : (
                <div className="resource-list resource-list--unmanaged cleanup-history-list">
                  {cleanupBackups.map((backup) => (
                    <div className="resource-row cleanup-history-row" key={backup.id}>
                      <span className="resource-avatar cleanup-history-icon" aria-hidden="true">
                        <RotateCcw size={16} strokeWidth={2.1} />
                      </span>
                      <div className="resource-row__main">
                        <PreviewText
                          ariaLabel={t("Full cleanup history name {{id}}", { id: backup.libraryId })}
                          className="cleanup-history-name"
                          text={backup.libraryId}
                        />
                        <PreviewText
                          ariaLabel={t("Full cleanup history details {{id}}", { id: backup.libraryId })}
                          className="cleanup-history-details"
                          displayText={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared folder migration" : backup.operation === "update" ? "Update" : backup.operation === "merge" ? "Merge" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
                          text={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared folder migration" : backup.operation === "update" ? "Update" : backup.operation === "merge" ? "Merge" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
                        />
                      </div>
                      <div className="cleanup-group-actions">
                        <button
                          className="secondary-action cleanup-current-action"
                          type="button"
                          aria-label={t("Restore cleanup {{id}}", { id: backup.libraryId })}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => onRestoreCleanup(backup.id)}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          {t("Restore")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>
        </section>
      ) : null}

      {activeTool === "import"
        ? (
            <ModalFrame
              ariaLabel={t("Import skills")}
              backdropClassName="library-import-backdrop"
              className="library-import-dialog"
              dialogRef={importDialogRef}
              dismissDisabled={Boolean(githubOperation) && !repositoryOperationCancelable}
              onDismiss={() => void closeImportTool()}
              suspended={importConflictOpen}
            >
                <header className="profile-dialog-header library-import-header ui-dialog-header">
                  <div className="section-title ui-dialog-title">{t("Import skills")}</div>
                  <IconButton
                    label={t("Close import")}
                    disabled={
                      localImportOperation ||
                      (Boolean(githubOperation) && !repositoryOperationCancelable)
                    }
                    onClick={() => void closeImportTool()}
                    size="default"
                    variant="ghost"
                  >
                    <X size={16} strokeWidth={2.2} />
                  </IconButton>
                </header>

                <div className="library-import-source-tabs" role="tablist" aria-label={t("Import source")}>
                  <button
                    className={importSource === "local" ? "is-active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={importSource === "local"}
                    disabled={Boolean(githubOperation) || localImportOperation}
                    onClick={() => setImportSource("local")}
                  >
                    <Folder size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Local")}
                  </button>
                  <button
                    className={importSource === "github" ? "is-active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={importSource === "github"}
                    disabled={Boolean(githubOperation) || localImportOperation}
                    onClick={() => setImportSource("github")}
                  >
                    <GitBranch size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Repository")}
                  </button>
                </div>

                {importSource === "local" ? (
                  <div className="library-import-content">
                    <section className="library-import-panel">
                      <div className="library-import-grid">
                        <label>
                          <span>{t("Folder or ZIP")}</span>
                          <input
                            aria-label={t("Local Skill source path")}
                            placeholder={t("No source selected")}
                            readOnly
                            value={localSkillPath}
                          />
                        </label>
                        <Button
                          aria-label={t("Choose local Skill source")}
                          disabled={localImportOperation || Boolean(githubOperation)}
                          icon={<Folder size={15} strokeWidth={2.2} />}
                          onClick={() => {
                            void selectLocalSkillFolder();
                          }}
                        >
                          {t("Choose source")}
                        </Button>
                      </div>
                      {localImportImpact ? (
                        <div
                          className={`local-import-impact${
                            localImportBlocked ? " local-import-impact--warning" : ""
                          }`}
                          role={localImportBlocked ? "alert" : "status"}
                        >
                          {localImportBlocked ? (
                            <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
                          ) : (
                            <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                          )}
                          <span>{t(localImportImpact.message, localImportImpact.values)}</span>
                        </div>
                      ) : null}
                      {localSkillSource && !selectedLocalInventory && onScanLocalSkillSource && onImportLocalSourceSkill ? (
                        <ProjectSkillDiscoveryPanel
                          rootPath={localSkillSource.rootPath}
                          sourceKind={localSkillSource.kind}
                          sourcePath={localSkillSource.path}
                          onScan={onScanLocalSkillSource}
                          onImport={onImportLocalSourceSkill}
                        />
                      ) : null}
                    </section>
                  </div>
                ) : !githubScanResult ? (
                  <div className="library-import-content">
                    <section className="library-import-panel">
                      <div className="github-scan-field">
                        <span className="library-import-field-label">
                          {t("Repository")}
                          <InfoTip label={t("Paste a GitHub URL or a Git HTTPS/SSH clone address. Repository scans never modify your checkout.")} />
                        </span>
                        <input
                          aria-label={t("Repository address")}
                          placeholder="https://github.com/owner/repo or git@host:team/repo.git"
                          disabled={localImportOperation}
                          value={githubUrl}
                          onChange={(event) => setGithubUrl(event.currentTarget.value)}
                        />
                      </div>
                      <details className="repository-advanced">
                        <summary>
                          <Settings2 size={14} strokeWidth={2.1} aria-hidden="true" />
                          {t("Advanced")}
                          <ChevronDown
                            className="repository-advanced-chevron"
                            size={14}
                            strokeWidth={2.1}
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="repository-advanced-grid">
                          <label>
                            <span>{t("Ref")}</span>
                            <input
                              aria-label={t("Repository ref")}
                              placeholder={t("Default branch")}
                              disabled={Boolean(githubOperation)}
                              value={repositoryRef}
                              onChange={(event) => setRepositoryRef(event.currentTarget.value)}
                            />
                          </label>
                          <label>
                            <span>{t("Directory")}</span>
                            <input
                              aria-label={t("Repository directory")}
                              placeholder="skills/review"
                              disabled={Boolean(githubOperation)}
                              value={repositoryDirectory}
                              onChange={(event) => setRepositoryDirectory(event.currentTarget.value)}
                            />
                          </label>
                          <label>
                            <span>{t("Connection")}</span>
                            <select
                              aria-label={t("Repository connection")}
                              disabled={Boolean(githubOperation)}
                              value={repositoryConnection}
                              onChange={(event) =>
                                setRepositoryConnection(event.currentTarget.value as "auto" | "system-git")
                              }
                            >
                              <option value="auto">{t("Automatic")}</option>
                              <option value="system-git">{t("System Git")}</option>
                            </select>
                          </label>
                        </div>
                      </details>
                    </section>
                  </div>
                ) : (
                  <div className="github-scan-results">
                    <div className="github-scan-summary">
                      <div>
                        <strong>{t("{{count}} found", { count: githubScanResult.candidates.length })}</strong>
                        <PreviewText
                          ariaLabel={t("Repository scan source")}
                          className="repository-scan-summary-path"
                          text={repositoryScanSummary || `${githubScanResult.owner}/${githubScanResult.repo} · ${githubScanResult.ref}`}
                          tooltipClassName="library-source-tooltip"
                        />
                      </div>
                      <Button
                        disabled={Boolean(githubOperation) || Boolean(githubImportResult)}
                        onClick={() => {
                          setGithubScanResult(undefined);
                          setGithubImportResult(undefined);
                          setGithubOperationError("");
                          setRepositoryScanKind(undefined);
                          setRepositoryScanSummary("");
                          setRepositoryCandidateInputs({});
                          resetRepositoryImportDraft();
                        }}
                      >
                        {t("Change source")}
                      </Button>
                    </div>
                    {githubScanResult.truncated ? (
                      <div className="inline-state inline-state--warning" role="status">
                        <TriangleAlert size={15} aria-hidden="true" />
                        {t("Results are incomplete. Narrow the repository directory and scan again.")}
                      </div>
                    ) : null}
                    <div className="github-selection-bar">
                      <label className="github-select-all">
                        <input
                          type="checkbox"
                          aria-label={t("Select all discovered skills")}
                          checked={githubAllReadySelected}
                          disabled={
                            githubReadyCandidateSources.length === 0 ||
                            Boolean(githubOperation) ||
                            Boolean(githubImportResult)
                          }
                          ref={(checkbox) => {
                            if (checkbox) {
                              checkbox.indeterminate = githubSomeReadySelected;
                            }
                          }}
                          onChange={(event) => selectAllRepositoryCandidates(event.currentTarget.checked)}
                        />
                        <span>{t("Select all")}</span>
                      </label>
                      <span
                        className={`github-selection-count${
                          githubImportResult
                            ? githubFailedImportCount > 0 || githubSkippedImportCount > 0
                              ? " is-partial"
                              : " is-complete"
                            : ""
                        }`}
                        role="status"
                      >
                        {githubImportResult ? (
                          <>
                            {githubFailedImportCount > 0 || githubSkippedImportCount > 0 ? (
                              <TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
                            ) : (
                              <CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" />
                            )}
                            {t(
                              githubFailedImportCount > 0 && githubSkippedImportCount > 0
                                ? "{{imported}} imported · {{failed}} failed · {{skipped}} skipped"
                                : githubFailedImportCount > 0
                                  ? "{{imported}} imported · {{failed}} failed"
                                  : githubSkippedImportCount > 0
                                    ? "{{imported}} imported · {{skipped}} skipped"
                                    : "All {{count}} skills imported",
                              {
                                count: githubImportedProgressCount,
                                imported: githubImportedProgressCount,
                                failed: githubFailedImportCount,
                                skipped: githubSkippedImportCount
                              }
                            )}
                          </>
                        ) : t("{{count}} selected", { count: githubSelectedSources.length })}
                      </span>
                      <span className="github-selection-id-heading">{t("Library ID")}</span>
                    </div>
                    <div className="github-candidate-list">
                      {githubScanResult.candidates.length === 0 ? (
                        <div className="inline-state">{t("No skills found")}</div>
                      ) : null}
                      {githubScanResult.candidates.map((candidate) => {
                        const selectable = candidate.status === "ready";
                        const checked = githubSelectedSources.includes(candidate.sourceUrl);
                        const progress = githubImportProgress[candidate.sourceUrl];
                        const failure = githubImportResult?.failed.find(
                          (item) => item.sourceUrl === candidate.sourceUrl
                        );
                        const failureMessage = progress?.error ?? failure?.error;
                        const progressStatus = progress?.status ?? (failureMessage ? "failed" : undefined);
                        const retrying = githubRetrySourceUrl === candidate.sourceUrl;
                        return (
                          <div
                            className={`github-candidate-row${selectable ? "" : " is-disabled"}`}
                            key={candidate.sourceUrl}
                          >
                            {progressStatus ? (
                              <span
                                className={`github-import-state github-import-state--${progressStatus}`}
                                role="status"
                                aria-label={t("{{name}}: {{status}}", {
                                  name: candidate.name,
                                  status: t(progressStatus)
                                })}
                              >
                                {progressStatus === "waiting" ? (
                                  <Circle size={16} strokeWidth={2} aria-hidden="true" />
                                ) : progressStatus === "reviewing" || progressStatus === "importing" ? (
                                  <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                                ) : progressStatus === "imported" ? (
                                  <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                                ) : progressStatus === "skipped" ? (
                                  <CircleSlash2 size={16} strokeWidth={2.1} aria-hidden="true" />
                                ) : (
                                  <PreviewText
                                    ariaLabel={t("Import failure for {{name}}", { name: candidate.name })}
                                    className="github-import-state__failure"
                                    displayContent={<XCircle size={16} strokeWidth={2.2} aria-hidden="true" />}
                                    text={failureMessage ?? t("Import failed")}
                                    tooltipClassName="library-source-tooltip import-error-tooltip"
                                  />
                                )}
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                aria-label={t("Select {{name}}", { name: candidate.name })}
                                disabled={!selectable || Boolean(githubOperation) || Boolean(githubImportResult)}
                                checked={checked}
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  selectRepositoryCandidate(candidate.sourceUrl, checked);
                                }}
                              />
                            )}
                            <span className="github-candidate-icon" aria-hidden="true">
                              <GitBranch size={16} strokeWidth={2.2} />
                            </span>
                            <span className="github-candidate-main">
                              <strong>{candidate.name}</strong>
                              <PreviewText
                                ariaLabel={t("Full repository path {{id}}", { id: candidate.id })}
                                className="github-candidate-path"
                                text={candidate.remotePath || "/"}
                                tooltipClassName="library-source-tooltip"
                              />
                              {candidate.description ? <small>{candidate.description}</small> : null}
                              {progressStatus === "failed" ? (
                                <small className="github-import-state-label field-error">{t("Import failed")}</small>
                              ) : progress ? (
                                <small className="github-import-state-label">{t(progress.status)}</small>
                              ) : null}
                            </span>
                            {selectable && (progressStatus === "failed" || progressStatus === "skipped" || retrying) ? (
                              <Button
                                className="github-candidate-retry"
                                size="compact"
                                variant="secondary"
                                aria-label={t(
                                  progressStatus === "skipped" ? "Import {{name}}" : "Retry {{name}}",
                                  { name: candidate.name }
                                )}
                                disabled={Boolean(githubOperation)}
                                icon={retrying
                                  ? <LoaderCircle className="is-spinning" size={15} />
                                  : progressStatus === "skipped"
                                    ? <Download size={15} strokeWidth={2.2} />
                                    : <RotateCcw size={15} strokeWidth={2.2} />}
                                onClick={() => void retryGitHubSkill(candidate)}
                              >
                                {t(progressStatus === "skipped" ? "Import" : "Retry")}
                              </Button>
                            ) : selectable ? (
                              <input
                                className="github-candidate-id"
                                aria-label={t("Library ID for {{name}}", { name: candidate.name })}
                                disabled={Boolean(githubOperation) || Boolean(githubImportResult)}
                                value={githubCandidateIds[candidate.sourceUrl] ?? candidate.id}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setRepositoryCandidateId(candidate.sourceUrl, value);
                                }}
                              />
                            ) : (
                              <PreviewText
                                ariaLabel={t("Status details for {{id}}", { id: candidate.id })}
                                className={`resource-chip resource-chip--managed${
                                  candidate.status === "invalid" ? " resource-chip--warning" : ""
                                }`}
                                displayText={t(
                                  candidate.status === "duplicate"
                                    ? "Duplicate"
                                    : candidate.status === "invalid"
                                      ? "Invalid"
                                      : "Imported"
                                )}
                                focusable={candidate.status === "invalid"}
                                text={candidate.error ?? t("Already in Library")}
                                tooltipClassName="library-source-tooltip"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {githubOperationError ? (
                  <div className="inline-state inline-state--error import-inline-error" role="alert">
                    <TriangleAlert size={15} aria-hidden="true" />
                    <span>{githubOperationError}</span>
                    {githubApiRetryAvailable ? (
                      <button
                        className="inline-state-action"
                        type="button"
                        disabled={Boolean(githubOperation)}
                        onClick={() => {
                          setRepositoryConnection("system-git");
                          void scanRepository(true);
                        }}
                      >
                        {t("Try with System Git")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <footer className="preview-actions import-dialog-actions ui-dialog-footer">
                  <Button
                    variant={githubImportResult ? "primary" : "secondary"}
                    disabled={
                      localImportOperation ||
                      (Boolean(githubOperation) && !repositoryOperationCancelable) ||
                      importStopRequested
                    }
                    onClick={() => void closeImportTool()}
                    icon={importStopRequested
                      ? <LoaderCircle className="is-spinning" size={15} />
                      : undefined}
                  >
                    {t(
                      githubOperation === "importing"
                        ? importStopRequested ? "Stopping..." : "Stop import"
                        : "Close"
                    )}
                  </Button>
                  {importSource === "local" && selectedLocalInventory ? (
                    <Button
                      variant="primary"
                      aria-busy={localImportOperation}
                      disabled={
                        !localSkillPath.trim() ||
                        localImportOperation ||
                        Boolean(githubOperation) ||
                        localImportBlocked
                      }
                      onClick={() => void importLocalSkill()}
                      icon={localImportOperation
                        ? <LoaderCircle className="is-spinning" size={15} />
                        : undefined}
                    >
                      {localImportOperation ? t("Importing...") : t(localImportLabel)}
                    </Button>
                  ) : importSource === "local" ? null : !githubScanResult ? (
                    <Button
                      variant="primary"
                      aria-busy={githubOperation === "scanning"}
                      disabled={!githubUrl.trim() || Boolean(githubOperation) || localImportOperation}
                      icon={githubOperation === "scanning"
                        ? <LoaderCircle className="is-spinning" size={15} />
                        : undefined}
                      onClick={() => {
                        void scanRepository();
                      }}
                    >
                      {t(githubOperation === "scanning" ? "Scanning..." : "Scan")}
                    </Button>
                  ) : githubImportResult ? null : (
                    <Button
                      variant="primary"
                      aria-busy={githubOperation === "importing"}
                      disabled={githubSelectedSources.length === 0 || Boolean(githubOperation)}
                      icon={githubOperation === "importing"
                        ? <LoaderCircle className="is-spinning" size={15} />
                        : undefined}
                      onClick={() => {
                        void importSelectedGitHubSkills();
                      }}
                    >
                      {githubOperation === "importing" ? t("Importing...") : t("Import {{count}}", { count: githubSelectedSources.length })}
                    </Button>
                  )}
                </footer>
            </ModalFrame>
          )
        : null}
    </section>
  );
};
