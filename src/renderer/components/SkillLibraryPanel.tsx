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
  ChevronRight,
  Circle,
  CircleSlash2,
  Combine,
  Copy,
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
  Users,
  X,
  XCircle
} from "lucide-react";
import { createPortal } from "react-dom";
import { useModalDialog } from "../hooks/useModalDialog";
import type {
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
  SkillAvailabilityInput,
  SkillInventoryEntry,
  SkillIconInput,
  SkillLibraryEntry,
  SkillSourceGroupCandidate,
  SkillSourceGroupView,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillMergeInput,
  SkillMergePreview,
  SkillSourceType,
  SkillUpdatePolicyInput,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput
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
  updateSkillLibraryControls
} from "../libraryViewState";
import {
  automaticSkillCleanupRequest,
  buildSkillCleanupGroups,
  type SkillCleanupAutomaticEffect,
  type SkillCleanupBucket,
  type SkillCleanupDisplayState,
  type SkillCleanupRecommendedAction
} from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { Button, IconButton, ModalFrame, Switch } from "./ui";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { isExternalSkillImportable } from "../../shared/skillIdentity";
import { sourceSubpathFor } from "../../shared/skillSourceGrouping";
import { SkillSourceView } from "./SkillSourceView";

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

export const repositoryImportProgressKey = (
  input: Pick<RepositorySkillImportInput, "repository" | "ref" | "directory">
) => `${input.repository}\0${input.ref ?? ""}\0${input.directory ?? ""}`;

export interface PreparedSkillTarget {
  targetId: string;
  targetName: string;
  disposition: "install" | "omit";
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
  skillUsage: Record<string, string[]>;
  installedTargetIds?: string[];
  targetNames?: TargetNameIndex;
  preparedTargetsBySkill?: Record<string, PreparedSkillTarget[]>;
  activeTool?: "import" | "discoveries";
  isRefreshingInventory?: boolean;
  onCloseTool?(): void;
  onRefreshInventory(): Promise<void>;
  onSelectLocalSkillFolder(): Promise<string | undefined>;
  onImportUnmanaged(sourcePath: string): Promise<boolean>;
  onImportExternal(skill: SkillInventoryEntry): Promise<boolean>;
  onScanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  onImportGitHubSkills(
    inputs: GitHubSkillImportInput[],
    onProgress?: (progress: GitHubSkillImportProgress) => void
  ): Promise<GitHubSkillImportResult>;
  onScanRepositorySkills(input: RepositorySkillSourceInput): Promise<RepositorySkillScanResult>;
  onImportRepositorySkills(
    inputs: RepositorySkillImportInput[],
    onProgress?: (progress: GitHubSkillImportProgress) => void
  ): Promise<RepositorySkillImportResult>;
  onLibraryModeChange(mode: "skills" | "sources"): void;
  onCheckSourceGroup(sourceId: string): Promise<void>;
  onCheckAllSourceGroups(): Promise<void>;
  onSetSourceName(input: SkillSourceNameInput): Promise<void>;
  onPreviewSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  onMergeSources(previewId: string): Promise<SkillSourceMergeResult>;
  onCancelRepositoryOperations(): Promise<void>;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onConsolidateSkillGroup(input: SkillCleanupRequest): Promise<boolean>;
  onAutoConsolidateSkillGroups(inputs: SkillCleanupRequest[]): Promise<void>;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
  onSetUpdatePolicy(input: SkillUpdatePolicyInput): void;
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
  onIgnoreSkillGroup(skillKey: string): void;
  onUnignoreSkillGroup(skillKey: string): void;
  onSetSharedSkillRetention(input: SharedSkillRetentionInput): Promise<boolean>;
  onRetireSharedSkill(input: RetireSharedSkillInput): Promise<boolean>;
  onOpenProfiles(): void;
  onRestoreCleanup(backupId: string): void;
  updateCheckStatus?: SkillUpdateCheckStatus;
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
    return "Library copy";
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
  if (status === "external") return "External";
  if (status === "unmanaged") return "Unmanaged";
  if (status === "ignored") return "Ignored";
  return "Managed";
};

const cleanupInventoryStatusLabel = (item: SkillInventoryEntry) =>
  item.externalOwnership?.state === "broken-link"
    ? "Unavailable"
    : inventoryStatusLabel(item.status);

const cleanupInventoryStatusClass = (item: SkillInventoryEntry) =>
  item.externalOwnership?.state === "broken-link" ? "stale" : item.status;

const externalManagerLabel = (skill: SkillInventoryEntry | undefined) =>
  skill?.externalOwnership?.displayName ??
  (skill?.externalOwnership?.manager === "skills-cli"
    ? "Skills CLI"
    : skill?.externalOwnership?.manager ?? "External manager");

const cleanupPresentationLabel = (state: SkillCleanupDisplayState) => {
  if (state === "not-in-library") return "Not in Library";
  if (state === "duplicate-copies") return "Duplicate copies";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "copies-not-managed") return "Copies not managed";
  if (state === "local-changes-found") return "Local changes found";
  if (state === "managed-copy-changed") return "Managed copy changed";
  if (state === "managed-elsewhere") return "Managed elsewhere";
  if (state === "shared-copy-in-use") return "Shared copy still active";
  if (state === "shared-copy-replaceable") return "Shared copy can be replaced";
  if (state === "kept-shared") return "Kept shared";
  if (state === "ignored") return "Ignored";
  if (state === "unavailable") return "Unavailable";
  return "Managed";
};

const cleanupPresentationCompactLabel = (state: SkillCleanupDisplayState) => {
  if (state === "duplicate-copies") return "Duplicate";
  if (state === "unavailable") return "Unavailable";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "local-changes-found" || state === "managed-copy-changed") return "Changed";
  if (state === "managed-elsewhere") return "External";
  if (state === "shared-copy-in-use") return "Shared";
  if (state === "shared-copy-replaceable") return "Ready";
  if (state === "kept-shared") return "Kept";
  if (state === "ignored") return "Ignored";
  if (state === "managed") return "Managed";
  return "Unmanaged";
};

const cleanupPresentationChipClass = (state: SkillCleanupDisplayState) => {
  if (state === "managed" || state === "shared-copy-replaceable") return "managed";
  if (state === "ignored" || state === "kept-shared") return "ignored";
  if (state === "managed-elsewhere") return "external";
  if (state === "multiple-versions" || state === "local-changes-found") return "conflict";
  if (state === "managed-copy-changed") return "stale";
  if (state === "shared-copy-in-use") return "pending";
  if (state === "duplicate-copies") return "library";
  if (state === "unavailable") return "stale";
  return "unmanaged";
};

const cleanupActionLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "add-to-library") return "Add to Library";
  if (action === "manage-copies") return "Manage copies";
  if (action === "review-differences") return "Review differences";
  if (action === "review-drift") return "Review drift";
  if (action === "review-ownership") return "Review ownership";
  if (action === "open-profiles") return "Review shared copy";
  if (action === "review-replacement") return "Review replacement";
  if (action === "review-details") return "Review details";
  return "";
};

const cleanupActionDisplayLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "open-profiles") {
    return "Review copy";
  }
  if (action === "review-replacement") {
    return "Replace shared";
  }
  if (
    action === "review-differences" ||
    action === "review-drift" ||
    action === "review-ownership" ||
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

const cleanupBucketLabel = (bucket: SkillCleanupBucket) => {
  if (bucket === "decision") return "Needs your decision";
  if (bucket === "ready") return "Ready to clean up";
  if (bucket === "managed") return "Managed";
  return "Kept outside AgentEnv";
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
  skillUsage,
  installedTargetIds = [],
  targetNames = {},
  preparedTargetsBySkill = {},
  activeTool,
  isRefreshingInventory = false,
  onCloseTool,
  onRefreshInventory,
  onSelectLocalSkillFolder,
  onImportUnmanaged,
  onImportExternal,
  onScanGitHubSkills,
  onImportGitHubSkills,
  onScanRepositorySkills,
  onImportRepositorySkills,
  onLibraryModeChange,
  onCheckSourceGroup,
  onCheckAllSourceGroups,
  onSetSourceName,
  onPreviewSourceMerge,
  onMergeSources,
  onCancelRepositoryOperations,
  onManageTargetSkill,
  onConsolidateSkillGroup,
  onAutoConsolidateSkillGroups,
  onSetUpdateSource,
  onSetUpdatePolicy,
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
  onIgnoreSkillGroup,
  onUnignoreSkillGroup,
  onSetSharedSkillRetention,
  onRetireSharedSkill,
  onOpenProfiles,
  onRestoreCleanup,
  updateCheckStatus,
  viewState,
  onViewStateChange,
  searchInputRef,
  scrollOwnerRef,
  importConflictOpen = false
}: SkillLibraryPanelProps) => {
  const { formatDate, localeTag, t } = useI18n();
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScanResult, setGithubScanResult] = useState<GitHubSkillScanResult>();
  const [githubSelectedSources, setGithubSelectedSources] = useState<string[]>([]);
  const [githubCandidateIds, setGithubCandidateIds] = useState<Record<string, string>>({});
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
  const [localSkillPath, setLocalSkillPath] = useState("");
  const [importSource, setImportSource] = useState<"local" | "github">("local");
  const [repositoryRef, setRepositoryRef] = useState("");
  const [repositoryDirectory, setRepositoryDirectory] = useState("");
  const [repositoryConnection, setRepositoryConnection] = useState<"auto" | "system-git">("auto");
  const [repositoryScanKind, setRepositoryScanKind] = useState<"github-api" | "system-git">();
  const [repositoryOperationCancelable, setRepositoryOperationCancelable] = useState(false);
  const [repositoryScanSummary, setRepositoryScanSummary] = useState("");
  const [repositoryCandidateInputs, setRepositoryCandidateInputs] = useState<
    Record<string, RepositorySkillImportInput>
  >({});
  const [githubApiRetryAvailable, setGithubApiRetryAvailable] = useState(false);
  const { search, sourceFilter, statusFilter, targetFilter, usageFilter } = viewState;
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [previewingSkillId, setPreviewingSkillId] = useState<string>();
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
  useEffect(() => {
    if (importConflictOpen) {
      setExternalImport(undefined);
    }
  }, [importConflictOpen]);
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { sourceType: SkillSourceType; source: string; ref: string; directory: string }>
  >({});
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
    if (selectedUpdatePlan) {
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
    } else if (bulkUpdatePlans) {
      onCloseBulkUpdatePreview();
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
      bulkUpdatePlans ||
      externalImport ||
      cleanupDetailsKey ||
      sharedTargetReviewKey ||
      sharedRetireKey ||
      autoCleanupReviewOpen ||
      cleanupDraft
  );
  const closeImportTool = async () => {
    if (githubOperation && repositoryOperationCancelable) {
      await onCancelRepositoryOperations();
    }
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
      availabilityOperation || sharedOperation || cleanupOperationKey || mergeOperation
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
    setGithubSelectedSources([]);
    setGithubCandidateIds({});
    setGithubImportResult(undefined);
    setGithubImportProgress({});
    setGithubOperationError("");
    setGithubOperation(undefined);
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
    const matchesSource = sourceFilter === "all" || skill.sourceType === sourceFilter;
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
    setPreviewingSkillId(id);
    try {
      await onPreviewLibrarySkillUpdate(id);
    } finally {
      setPreviewingSkillId(undefined);
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
      preparedTargetIdsBySkill: Object.fromEntries(
        Object.entries(preparedTargetsBySkill).map(([skillKey, targets]) => [
          skillKey,
          targets.map((target) => target.targetId)
        ])
      )
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
  const readyCleanupCount = automaticCleanupRequests.length;
  const sharedReplacementReadyCount = cleanupGroupsByBucket.ready.filter(
    (group) => group.sharedMigration?.state === "ready"
  ).length;
  const migrationSummary = [
    manualCleanupCount > 0
      ? t(manualCleanupCount === 1 ? "1 needs your decision" : "{{count}} need your decision", { count: manualCleanupCount })
      : "",
    readyCleanupCount > 0
      ? t(readyCleanupCount === 1 ? "1 ready to clean up" : "{{count}} ready to clean up", { count: readyCleanupCount })
      : "",
    sharedReplacementReadyCount > 0
      ? t(
          sharedReplacementReadyCount === 1
            ? "1 shared copy ready to replace"
            : "{{count}} shared copies ready to replace",
          { count: sharedReplacementReadyCount }
        )
      : ""
  ].filter(Boolean).join(" · ");
  const normalizedLocalSkillPath = localSkillPath.trim().replace(/\/+$/, "");
  const selectedLocalInventory = skillInventory.find(
    (item) => item.path.replace(/\/+$/, "") === normalizedLocalSkillPath
  );
  const selectedLocalConflict = Boolean(
    selectedLocalInventory?.status === "library" &&
      selectedLocalInventory.contentMatchesLibrary !== true
  );
  const selectedLocalCanManage = Boolean(
    selectedLocalInventory &&
      (selectedLocalInventory.status === "unmanaged" ||
        (selectedLocalInventory.status === "library" && !selectedLocalConflict))
  );
  const localImportBlocked = Boolean(
    selectedLocalInventory &&
      (selectedLocalInventory.status === "managed" ||
        selectedLocalInventory.status === "ignored" ||
        (selectedLocalInventory.status === "external" &&
          !isExternalSkillImportable(selectedLocalInventory.externalOwnership)) ||
        selectedLocalConflict)
  );
  const localImportImpact = !selectedLocalInventory
    ? undefined
    : selectedLocalInventory.status === "managed"
      ? { message: "This Agent copy is already managed by AgentEnv and is present in Library." }
      : selectedLocalInventory.status === "ignored"
        ? { message: "This group is ignored. Restore it in Scan local before managing it." }
        : selectedLocalConflict
          ? {
              message:
                "This folder differs from the existing Library version. Use Scan local to review the conflict."
            }
          : selectedLocalInventory.status === "external"
            ? selectedLocalInventory.externalOwnership?.importable === false
              ? {
                  message: "This Skill is provided by {{manager}} and remains read-only here.",
                  values: { manager: externalManagerLabel(selectedLocalInventory) }
                }
              : {
                  message:
                    "This installation is owned by {{manager}}. AgentEnv will import an independent Library copy and leave it unchanged.",
                  values: { manager: externalManagerLabel(selectedLocalInventory) }
                }
            : selectedLocalCanManage
              ? {
                  message:
                    "AgentEnv will back up this Agent copy, import it to Library, then replace the folder with a managed copy."
                }
              : undefined;
  const localImportLabel = selectedLocalCanManage ? "Import & manage" : "Import copy";
  const sourceCandidateDraft = sourceCandidate
    ? sourceDrafts[sourceCandidate.id] ?? {
        sourceType: sourceCandidate.sourceType,
        source: sourceCandidate.source ?? "",
        ref: sourceCandidate.remoteRef ?? sourceCandidate.upstream?.ref ?? "",
        directory: sourceCandidate.upstream?.subpath ?? ""
      }
    : undefined;
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
  const sharedRetireTargets = sharedRetireKey
    ? preparedTargetsBySkill[sharedRetireKey] ?? []
    : [];
  const externalImportGroup = externalImport
    ? cleanupGroups.find((group) => group.skillKey === externalImport.skillKey)
    : undefined;
  const externalImportItems =
    externalImportGroup?.activeItems.filter(
      (item) =>
        item.status === "external" &&
        isExternalSkillImportable(item.externalOwnership)
    ) ?? [];
  const selectedExternalImport = externalImportItems.find(
    (item) => item.path === externalImport?.sourcePath
  );
  const cleanupUsesExistingLibrary = Boolean(
    cleanupCandidate?.items.some((item) => item.status === "library" || item.status === "managed") ||
      (cleanupDraft && librarySkills.some((skill) => skill.id === cleanupDraft.libraryId))
  );

  const openCleanupReview = (group: (typeof cleanupGroups)[number]) => {
    const libraryId = group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey;
    const manageableItems = group.activeItems.filter(
      (item) => item.status !== "ignored" && item.status !== "external"
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
      setGithubSelectedSources(
        result.candidates.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.sourceUrl)
      );
      setGithubCandidateIds(
        Object.fromEntries(result.candidates.map((candidate) => [candidate.sourceUrl, candidate.id]))
      );
    } catch (error) {
      setGithubOperationError(error instanceof Error ? error.message : String(error));
      setGithubApiRetryAvailable(
        !forceSystemGit && repositoryConnection === "auto" && /^https:\/\/github\.com\//i.test(url)
      );
    } finally {
      setGithubOperation(undefined);
      setRepositoryOperationCancelable(false);
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
    setRepositoryOperationCancelable(repositoryScanKind === "system-git");
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
        const result = await onImportRepositorySkills(inputs, onProgress);
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
          onProgress
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
    setRepositoryOperationCancelable(repositoryScanKind === "system-git");
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
        const result = await onImportRepositorySkills([input], onProgress);
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
        }], onProgress);
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
    }
  };

  const importLocalSkill = async () => {
    const sourcePath = localSkillPath.trim();
    if (!sourcePath || localImportOperation || localImportBlocked) {
      return;
    }
    setLocalImportOperation(true);
    try {
      const imported = selectedLocalInventory?.status === "external"
        ? await onImportExternal(selectedLocalInventory)
        : await onImportUnmanaged(sourcePath);
      if (imported) {
        setLocalSkillPath("");
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
    if (!selected || selected.externalOwnership?.state === "broken-link") {
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
    if (automaticCleanupKey || requests.length === 0) {
      return;
    }
    setAutomaticCleanupKey(key);
    setAutoCleanupReviewOpen(false);
    try {
      await onAutoConsolidateSkillGroups(requests);
    } finally {
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
    const sourcePath = await onSelectLocalSkillFolder();
    if (sourcePath) {
      setLocalSkillPath(sourcePath);
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
    const result = await onImportRepositorySkills([{
      repository: group.repository,
      ref: group.ref,
      directory: candidate.directory,
      transport: "system-git",
      sourceCollection: {
        formatVersion: 1,
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
        </div>
        <div className="library-toolbar" hidden={libraryMode !== "skills"}>
          <label className="library-search">
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
            disabled={updateCheckStatus?.state === "checking"}
            onClick={onCheckUpdates}
          >
            {updateCheckStatus?.state === "checking" ? (
              <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
            ) : (
              <SearchCheck size={15} strokeWidth={2.2} />
            )}
            <span>{t(updateCheckStatus?.state === "checking" ? "Checking..." : "Check updates")}</span>
          </button>
          {updateableSkillIds.length > 0 ? (
            <button
              className="secondary-action library-toolbar-action"
              type="button"
              aria-label={t("Update all skills")}
              title={t("Update all skills")}
              onClick={() => onPreviewAllLibrarySkillUpdates(updateableSkillIds)}
            >
              <Sparkles size={15} strokeWidth={2.2} />
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
                  <option value="github">GitHub</option>
                  <option value="git">{t("Repository")}</option>
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
                  <option value="unmanaged">{t("Unmanaged")}</option>
                  <option value="ignored">{t("Ignored")}</option>
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
            <InfoTip label={t("Shows the next maintenance action for this skill.")} />
          </span>
          <span>{t("Actions")}</span>
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
              sourceTypeLabel,
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
                      : isTracked && updateInfo
                        ? `${(updateInfo.latestRevision ?? revisionLabel).slice(0, 7)} ${t("current")}`
                        : isTracked && hasUpdateSource
                          ? t("Tracked source")
                          : hasUpdateSource
                            ? t("Source retained")
                            : t("No update source");
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
                      <strong className="skill-title">{skill.name}</strong>
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
                  <strong className="usage-summary">
                    <Users size={13} strokeWidth={2.2} />
                    {t(usageCount === 1 ? "{{count}} profile" : "{{count}} profiles", { count: usageCount })}
                  </strong>
                  <PreviewText
                    ariaLabel={t("Usage details for {{id}}", { id: skill.id })}
                    className="library-usage-detail"
                    displayText={installedAgentCount > 0
                      ? t(installedAgentCount === 1 ? "{{count}} Agent" : "{{count}} Agents", { count: installedAgentCount })
                      : t("No Agent installs")}
                    text={`${t("Profiles")}: ${(skillUsage[skill.id] ?? []).join(", ") || t("Not referenced")} · ${t("Agents")}: ${installedAgentNames.join(", ") || t("Not installed")}`}
                  />
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
                    <button
                      aria-busy={previewingSkillId === skill.id}
                      className="library-status-action is-update"
                      type="button"
                      aria-label={t("Review update {{id}}", { id: skill.id })}
                      disabled={updateCheckStatus?.state === "checking" || Boolean(previewingSkillId)}
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
                      <span>{t("Review")}</span>
                    </button>
                  ) : hasError ? (
                    <button
                      aria-busy={previewingSkillId === skill.id}
                      className="library-status-action is-error"
                      type="button"
                      aria-label={t("Retry update check {{id}}", { id: skill.id })}
                      disabled={updateCheckStatus?.state === "checking" || Boolean(previewingSkillId)}
                      onClick={(event) => {
                        modalFallbackFocusRef.current = event.currentTarget;
                        void runSkillUpdatePreview(skill.id);
                      }}
                    >
                      {previewingSkillId === skill.id ? (
                        <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
                      ) : (
                        <TriangleAlert size={13} strokeWidth={2.2} />
                      )}
                      <span>{t("Retry")}</span>
                    </button>
                  ) : staleCopies.length > 0 ? (
                    <button
                      className="library-status-action is-warning"
                      type="button"
                      aria-label={t(
                        staleCopies.length === 1
                          ? "Sync install of {{id}}"
                          : "Sync {{count}} installs of {{id}}",
                        { count: staleCopies.length, id: skill.id }
                      )}
                      onClick={() => onSyncSkillInstalls(skill.id)}
                    >
                      <RefreshCw size={13} strokeWidth={2.2} />
                      <span>{t("Needs sync")}</span>
                    </button>
                  ) : (
                    <strong className="library-primary-status">
                      {isTracked && updateInfo ? (
                        <CheckCircle2 size={13} strokeWidth={2.2} />
                      ) : hasUpdateSource && !isTracked ? (
                        <Link2Off size={13} strokeWidth={2.2} />
                      ) : isTracked && hasUpdateSource ? (
                        <Circle size={13} strokeWidth={2.2} />
                      ) : (
                        <CheckCircle2 size={13} strokeWidth={2.2} />
                      )}
                      <span>{t(
                        isTracked && updateInfo
                          ? "Up to date"
                          : isTracked && hasUpdateSource
                            ? "Not checked"
                            : hasUpdateSource
                              ? "Checks disabled"
                              : "Ready"
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
                <div className="library-actions-cell">
                  <div className="row-action-menu">
                    <button
                      className="icon-action"
                      type="button"
                      aria-label={t("More actions for {{id}}", { id: skill.id })}
                      aria-expanded={openActionId === skill.id}
                      disabled={availabilityIsChanging}
                      onClick={(event) => toggleActionMenu(skill.id, event.currentTarget)}
                    >
                      <MoreHorizontal size={16} strokeWidth={2.2} />
                    </button>
                  </div>
                  {openActionId === skill.id && openAction
                    ? createPortal(
                        <div
                          className="row-action-popover ui-action-menu"
                          data-skill-action-popover={skill.id}
                          role="menu"
                          aria-label={t("Actions for {{id}}", { id: skill.id })}
                          style={{ left: openAction.left, top: openAction.top }}
                        >
                          {globallyEnabled && hasUpdateSource && isTracked ? (
                            <button
                              className="row-action-item"
                              type="button"
                              role="menuitem"
                              disabled={Boolean(previewingSkillId)}
                              onClick={() => runSkillMenuAction(skill, "update")}
                            >
                              {previewingSkillId === skill.id ? (
                                <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                              ) : (
                                <RefreshCw size={14} strokeWidth={2.2} />
                              )}
                              <span>{t(hasUpdate ? "Preview update" : "Check update")}</span>
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
                        </div>,
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
        groups={sourceGroups}
        loading={sourceGroupsLoading}
        onCheckGroup={onCheckSourceGroup}
        onCheckAll={onCheckAllSourceGroups}
        onRename={onSetSourceName}
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
        onClose={onCloseUpdatePreview}
        onConfirm={onUpdateLibrarySkill}
      />

      {mergePreview && mergeKeepEntry && mergeSourceEntry ? (
        <div className="preview-modal-backdrop" onClick={() => !mergeOperation && setMergePreview(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog skill-merge-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("Merge same-name Skills")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Merge same-name Skills")}</div>
                <p className="muted">
                  {t("Choose the Library entry to keep and the update source to retain.")}
                </p>
              </div>
              <span className={`skill-import-match-state${mergePreview.comparisons.every((item) => item.identical) ? " is-identical" : " is-different"}`}>
                {t(mergePreview.comparisons.every((item) => item.identical) ? "Identical" : "Differences found")}
              </span>
            </header>

            <div className="skill-merge-body">
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
                        <small>{entry.version ?? t("Not declared")} · {entry.contentHash.slice(0, 8)}</small>
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
                      </span>
                      <em>{t(entry.updatePolicy === "tracked" ? "Tracked" : "Not tracked")}</em>
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

            <footer className="preview-actions">
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
        </div>
      ) : null}

      {sourceCandidate && sourceCandidateDraft ? (
        <div className="preview-modal-backdrop" onClick={() => setSourceCandidate(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog skill-update-settings-dialog"
            role="dialog"
            aria-label={t("Update settings for {{id}}", { id: sourceCandidate.id })}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Update settings")}</div>
                <p className="muted">{sourceCandidate.name}</p>
              </div>
            </header>
            <div className="skill-update-settings-dialog__body">
              <div className="skill-update-settings-policy">
                <span>
                  <strong>{t("Track updates")}</strong>
                  <small>
                    {sourceCandidate.globallyEnabled === false
                      ? t("Checks resume when this skill is enabled.")
                      : sourceCandidate.updatePolicy === "tracked"
                        ? t("Include in manual and automatic checks.")
                        : sourceCandidate.source
                          ? t("Excluded from all update checks.")
                          : t("Add an update source before tracking.")}
                  </small>
                </span>
                <Switch
                  checked={sourceCandidate.updatePolicy === "tracked"}
                  disabled={!sourceCandidate.source}
                  label={t("Track updates for {{id}}", { id: sourceCandidate.id })}
                  onClick={() => {
                    const policy = sourceCandidate.updatePolicy === "tracked" ? "untracked" : "tracked";
                    onSetUpdatePolicy({ id: sourceCandidate.id, policy });
                    setSourceCandidate({ ...sourceCandidate, updatePolicy: policy });
                  }}
                >
                  <strong>{t(sourceCandidate.updatePolicy === "tracked" ? "On" : "Off")}</strong>
                </Switch>
              </div>
              <div className="skill-update-source-fields">
                <label>
                  <span>{t("Source type")}</span>
                  <select
                    aria-label={t("Update source type for {{id}}", { id: sourceCandidate.id })}
                    value={sourceCandidateDraft.sourceType}
                    onChange={(event) =>
                      setSourceDrafts({
                        ...sourceDrafts,
                        [sourceCandidate.id]: {
                          ...sourceCandidateDraft,
                          sourceType: event.currentTarget.value as SkillSourceType
                        }
                      })
                    }
                  >
                    <option value="local">{t("Local folder")}</option>
                    <option value="github">{t("GitHub directory")}</option>
                    <option value="git">{t("Git repository")}</option>
                  </select>
                </label>
                <label>
                  <span>{t("Update source")}</span>
                  <input
                    aria-label={t("Update source for {{id}}", { id: sourceCandidate.id })}
                    placeholder={
                      sourceCandidateDraft.sourceType === "github"
                        ? "https://github.com/owner/repo/tree/main/path/to/skill"
                        : sourceCandidateDraft.sourceType === "git"
                          ? "git@host:team/repo.git"
                        : "/path/to/skill"
                    }
                    value={sourceCandidateDraft.source}
                    onChange={(event) =>
                      setSourceDrafts({
                        ...sourceDrafts,
                        [sourceCandidate.id]: {
                          ...sourceCandidateDraft,
                          source: event.currentTarget.value
                        }
                      })
                    }
                  />
                </label>
                {sourceCandidateDraft.sourceType === "git" ? (
                  <>
                    <label>
                      <span>{t("Ref")}</span>
                      <input
                        aria-label={t("Update source ref for {{id}}", { id: sourceCandidate.id })}
                        placeholder={t("Default branch")}
                        value={sourceCandidateDraft.ref}
                        onChange={(event) =>
                          setSourceDrafts({
                            ...sourceDrafts,
                            [sourceCandidate.id]: {
                              ...sourceCandidateDraft,
                              ref: event.currentTarget.value
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>{t("Directory")}</span>
                      <input
                        aria-label={t("Update source directory for {{id}}", { id: sourceCandidate.id })}
                        placeholder="skills/review"
                        value={sourceCandidateDraft.directory}
                        onChange={(event) =>
                          setSourceDrafts({
                            ...sourceDrafts,
                            [sourceCandidate.id]: {
                              ...sourceCandidateDraft,
                              directory: event.currentTarget.value
                            }
                          })
                        }
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <p className="skill-update-settings-help">
                <InfoTip label={t("Use a local skill folder, GitHub tree directory, or Git clone address. Repository credentials stay with System Git.")} />
                {t("Source changes are saved independently from update tracking.")}
              </p>
            </div>
            <footer className="preview-actions">
              <button
                ref={modalInitialFocusRef}
                className="secondary-action"
                type="button"
                onClick={() => setSourceCandidate(undefined)}
              >
                {t("Close")}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!sourceCandidateDraft.source.trim()}
                onClick={() => {
                  onSetUpdateSource({
                    id: sourceCandidate.id,
                    sourceType: sourceCandidateDraft.sourceType,
                    source: sourceCandidateDraft.source.trim(),
                    ...(sourceCandidateDraft.sourceType === "git"
                      ? {
                          ref: sourceCandidateDraft.ref.trim() || undefined,
                          directory: sourceCandidateDraft.directory.trim() || undefined
                        }
                      : {})
                  });
                  setSourceCandidate(undefined);
                }}
              >
                {t("Save source")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteCandidate ? (
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
              <div>
                <div className="section-title">{t("Remove from library")}</div>
                <p className="muted">
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
        </div>
      ) : null}

      {autoCleanupReviewOpen ? (
        <div className="preview-modal-backdrop" onClick={() => setAutoCleanupReviewOpen(false)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label={t("Clean up local Skills")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Clean up local Skills")}</div>
                <p className="muted">
                  {t("AgentEnv will run the safe actions below. Every changed path is backed up before cleanup starts.")}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list">
              {([...cleanupRequestsByEffect.entries()]).map(([effect, items]) => (
                <section className="cleanup-bulk-effect" key={effect}>
                  <div>
                    <strong>{t(cleanupEffectLabel(effect))}</strong>
                    <span>{items.length}</span>
                  </div>
                  <p>{items.map((item) => item.name).join(", ")}</p>
                </section>
              ))}
              <small>{t("Each Skill is backed up independently. A failure does not undo completed Skills.")}</small>
            </div>
            <footer className="preview-actions">
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
                {t("Clean up {{count}} skills", { count: automaticCleanupRequests.length })}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {sharedTargetReview?.sharedMigration?.state === "waiting" ? (
        <div className="preview-modal-backdrop" onClick={() => setSharedTargetReviewKey(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact shared-target-review-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("Choose shared Skill handling")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Choose how Agents use this Skill")}</div>
                <p className="muted">
                  {t("{{name}} is still loaded by {{count}} Agents from one shared folder.", {
                    name: sharedTargetReview.primary?.name ?? sharedTargetReview.skillKey,
                    count: sharedTargetReview.sharedMigration.pendingConsumers.length
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list">
              {sharedTargetReview.sharedMigration.pendingConsumers.map((targetId) => (
                <span key={targetId}>{t(targetNameFor(targetId, targetNames, targetId))}</span>
              ))}
              <p className="shared-target-review-guidance">
                {t("Apply the intended Profile to each Agent, then return here to replace the shared copy.")}
              </p>
              <small>{t("Profiles without this Skill will remove it from that Agent when the shared copy is replaced.")}</small>
            </div>
            <footer className="preview-actions">
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
        </div>
      ) : null}

      {sharedRetireCandidate?.sharedMigration ? (
        <div
          className="preview-modal-backdrop"
          onClick={sharedOperation ? undefined : () => setSharedRetireKey(undefined)}
        >
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label={t("Replace shared Skill copy")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Replace shared copy")}</div>
                <p className="muted">
                  {t("Each Agent will use its saved Profile instead of the shared {{name}} copy.", {
                    name: sharedRetireCandidate.primary?.name ?? sharedRetireCandidate.skillKey
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-retire-summary">
              <div>
                <strong>{t("After replacement")}</strong>
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
            <footer className="preview-actions">
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
                  {t(sharedOperation?.action === "retire" ? "Replacing..." : "Replace shared copy")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {disableCandidate ? (
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
        </div>
      ) : null}

      {bulkUpdatePlans ? (
        <div className="preview-modal-backdrop" onClick={onCloseBulkUpdatePreview}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog bulk-update-dialog"
            role="dialog"
            aria-label={t("Review all skill updates")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Review all skill updates")}</div>
                <p className="muted">{t("Review every tracked change before updating the shared library.")}</p>
              </div>
            </header>
            <div className="bulk-update-list">
              {bulkUpdatePlans.map((plan) => (
                <details key={plan.id} open={plan.errors.length > 0}>
                  <summary>
                    <strong>{plan.name}</strong>
                    <span>{plan.errors.length > 0 ? t("Blocked") : t("{{count}} file changes", { count: plan.changes.length })}</span>
                  </summary>
                  {plan.impact ? (
                    <p className="skill-update-impact">
                      {t("{{profiles}} Profiles · {{linked}} linked installs update now · {{copied}} copied installs wait", {
                        profiles: plan.impact.profileNames.length,
                        linked: plan.impact.linkedInstallCount,
                        copied: plan.impact.copiedInstallCount
                      })}
                    </p>
                  ) : null}
                  {plan.errors.map((error) => <p className="error" key={error}>{error}</p>)}
                  {plan.changes.map((change) => <code key={change.path}>{change.path}</code>)}
                </details>
              ))}
            </div>
            <footer className="preview-actions">
              <button ref={modalInitialFocusRef} className="secondary-action" type="button" onClick={onCloseBulkUpdatePreview}>{t("Cancel")}</button>
              <button
                className="primary-action"
                type="button"
                disabled={bulkUpdatePlans.every((plan) => plan.errors.length > 0 || plan.changes.length === 0)}
                onClick={() => onUpdateAllLibrarySkills(bulkUpdatePlans.filter((plan) => plan.changes.length > 0 && plan.errors.length === 0))}
              >
                {t("Apply {{count}} updates", { count: bulkUpdatePlans.filter((plan) => plan.changes.length > 0 && plan.errors.length === 0).length })}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {externalImport && externalImportGroup ? (
        <div className="preview-modal-backdrop" onClick={() => setExternalImport(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact external-skill-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("Import external skill")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {t("Import {{name}}", { name: externalImportGroup.primary?.name ?? externalImport.skillKey })}
                </div>
                <p className="muted">
                  {selectedExternalImport?.contentMatchesLibrary
                    ? t("Review the matching Library copy and any source changes. External files and lock data stay unchanged.")
                    : selectedExternalImport?.externalOwnership?.manager === "skills-cli"
                      ? t("Create an independent Library copy. Skills CLI files and lock data stay unchanged.")
                      : t("Create an independent Library copy. {{manager}} files stay unchanged.", {
                          manager: externalManagerLabel(selectedExternalImport)
                        })}
                </p>
              </div>
            </header>
            <fieldset className="cleanup-review-group external-source-group">
              <legend>{t("Source copy")}</legend>
              {externalImportItems.map((item) => (
                <label className="cleanup-review-option" key={`external-${item.path}`}>
                  <input
                    type="radio"
                    name="external-skill-source"
                    checked={externalImport.sourcePath === item.path}
                    disabled={item.externalOwnership?.state === "broken-link"}
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
                  </span>
                  <em>
                    {item.externalOwnership?.state === "broken-link"
                      ? t("Missing")
                      : t("Content {{hash}}", { hash: item.contentHash.slice(0, 7) })}
                  </em>
                </label>
              ))}
            </fieldset>
            <footer className="preview-actions">
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
                disabled={localImportOperation || !externalImportItems.some(
                  (item) =>
                    item.path === externalImport.sourcePath &&
                    item.externalOwnership?.state !== "broken-link"
                )}
                onClick={() => void importSelectedExternalSkill()}
              >
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
        </div>
      ) : null}

      {cleanupDetails ? (
        <div className="preview-modal-backdrop" onClick={() => setCleanupDetailsKey(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog profile-form-dialog--compact cleanup-details-dialog"
            role="dialog"
            aria-label={t("Skill details {{id}}", { id: cleanupDetails.skillKey })}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {cleanupDetails.primary?.name ?? cleanupDetails.skillKey}
                </div>
                <p className="muted">
                  {cleanupDetails.primary?.description || t("Local Skill details and detected locations.")}
                </p>
              </div>
              <span className={`resource-chip resource-chip--${
                cleanupPresentationChipClass(cleanupDetails.presentation.state)
              }`}>
                {t(cleanupPresentationLabel(cleanupDetails.presentation.state))}
              </span>
            </header>
            <div className="cleanup-details-list">
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
                        <span
                          className={`resource-chip resource-chip--${cleanupInventoryStatusClass(item)}`}
                        >
                          {t(cleanupInventoryStatusLabel(item))}
                        </span>
                      </div>
                      <PreviewText
                        ariaLabel={t("Full detail path {{path}}", { path: item.path })}
                        className="cleanup-option-path"
                        text={item.path}
                        tooltipClassName="library-source-tooltip"
                      />
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
            <footer className="preview-actions">
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
        </div>
      ) : null}

      {cleanupDraft && cleanupCandidate ? (
        <div
          className="preview-modal-backdrop"
          onClick={() => {
            if (!cleanupOperationKey) setCleanupDraft(undefined);
          }}
        >
          <section
            ref={modalDialogRef}
            className="profile-form-dialog cleanup-review-dialog"
            role="dialog"
            aria-label={t("Review skill cleanup")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {t(cleanupCandidate.presentation.action === "add-to-library" ? "Add {{name}} to Library" : "Review {{name}}", {
                    name: cleanupCandidate.primary?.name ?? cleanupDraft.skillKey
                  })}
                </div>
                <p className="muted">
                  {cleanupUsesExistingLibrary
                    ? t("Review the differences, choose the canonical Library version, then confirm which local copies to normalize.")
                    : cleanupCandidate.sharedMigration
                      ? t("Choose the version to keep. AgentEnv will add it to Library, keep one shared copy active, and remove redundant Agent copies after backup.")
                      : t("Choose the local copy to keep in Library, then choose which copies become managed deployments.")}
                </p>
              </div>
            </header>
            <div className="cleanup-review-content">
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
                    .filter((item) => item.status !== "ignored" && item.status !== "external")
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
                    .filter((item) => item.status !== "managed" && item.status !== "ignored")
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
                        item.status === "ignored" ||
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
                    </span>
                    <em>
                      {item.status === "managed"
                        ? t("Already managed")
                        : item.status === "ignored"
                          ? t("Ignored")
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
            <footer className="preview-actions">
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
        </div>
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
              <button
                className="icon-action"
                type="button"
                aria-label={t("Close library tool")}
                disabled={Boolean(automaticCleanupKey) || isRefreshingInventory}
                onClick={onCloseTool}
              >
                <X size={16} strokeWidth={2.2} />
              </button>
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
              {automaticCleanupRequests.length > 0 ? (
                <button
                  className="primary-action cleanup-auto-action"
                  type="button"
                  aria-label={t("Clean up {{count}} ready Skills", { count: automaticCleanupRequests.length })}
                  disabled={Boolean(automaticCleanupKey)}
                  onClick={() => setAutoCleanupReviewOpen(true)}
                >
                  <Sparkles
                    className={automaticCleanupKey === "all" ? "is-spinning" : undefined}
                    size={15}
                    strokeWidth={2.2}
                    aria-hidden="true"
                  />
                  {t(
                    automaticCleanupKey === "all"
                      ? "Cleaning up..."
                      : "Clean up {{count}}",
                    { count: automaticCleanupRequests.length }
                  )}
                </button>
              ) : null}
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
                const hasIgnored = group.items.some((skill) => skill.status === "ignored");
                const allIgnored = group.activeItems.length === 0;
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
                const cleanupSummaryText = decisionSummary ?? defaultCleanupSummary;
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
                  if (group.presentation.action === "review-ownership") {
                    const source = group.activeItems.find(
                      (item) =>
                        item.status === "external" &&
                        isExternalSkillImportable(item.externalOwnership) &&
                        item.externalOwnership?.state !== "broken-link"
                    );
                    if (source) {
                      setExternalImport({ skillKey: group.skillKey, sourcePath: source.path });
                    } else {
                      setCleanupDetailsKey(group.skillKey);
                    }
                    return;
                  }
                  if (group.presentation.action === "open-profiles") {
                    setSharedTargetReviewKey(group.skillKey);
                    return;
                  }
                  if (group.presentation.action === "review-replacement") {
                    setSharedRetireKey(group.skillKey);
                  }
                };

                return (
                  <Fragment key={group.skillKey}>
                    {sectionStarts ? (
                      <div className={`cleanup-bucket-heading cleanup-bucket-heading--${group.bucket}`}>
                        <div>
                          <strong>{t(cleanupBucketLabel(group.bucket))}</strong>
                          <span>{cleanupGroupsByBucket[group.bucket].length}</span>
                        </div>
                        {sectionCanCollapse ? (
                          <button
                            className="icon-action"
                            type="button"
                            aria-label={t(sectionExpanded ? "Collapse {{section}}" : "Expand {{section}}", {
                              section: t(cleanupBucketLabel(group.bucket))
                            })}
                            aria-expanded={sectionExpanded}
                            onClick={() => {
                              if (!collapsibleBucket) return;
                              setExpandedCleanupBuckets((current) => ({
                                ...current,
                                [collapsibleBucket]: !sectionExpanded
                              }));
                            }}
                          >
                            {sectionExpanded ? (
                              <ChevronDown size={15} strokeWidth={2.2} />
                            ) : (
                              <ChevronRight size={15} strokeWidth={2.2} />
                            )}
                          </button>
                        ) : null}
                      </div>
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
                        displayText={group.items
                          .map((skill) => `${cleanupLocationLabel(skill, targetNames)} · ${skill.path}`)
                          .join(" | ")}
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
                        disabled={Boolean(automaticCleanupKey) || groupIsWorking}
                        onClick={(event) => toggleActionMenu(cleanupActionId, event.currentTarget)}
                      >
                        <MoreHorizontal size={16} strokeWidth={2.2} />
                      </button>
                      {openActionId === cleanupActionId && openAction
                        ? createPortal(
                            <div
                              className="row-action-popover cleanup-action-popover ui-action-menu"
                              data-skill-action-popover={cleanupActionId}
                              role="menu"
                              aria-label={t("Cleanup actions for {{id}}", { id: group.skillKey })}
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
                              {sharedMigration && sharedMigration.state !== "external" && sharedMigration.state !== "kept" ? (
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
                                    onIgnoreSkillGroup(group.skillKey);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <Link2Off size={14} strokeWidth={2.2} />
                                  <span><strong>{t("Ignore")}</strong></span>
                                </button>
                              ) : null}
                              {!sharedMigration && hasIgnored ? (
                                <button
                                  className="row-action-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onUnignoreSkillGroup(group.skillKey);
                                    setOpenAction(undefined);
                                  }}
                                >
                                  <RotateCcw size={14} strokeWidth={2.2} />
                                  <span><strong>{t(allIgnored ? "Unignore" : "Restore ignored")}</strong></span>
                                </button>
                              ) : null}
                            </div>,
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
                          displayText={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared copy replacement" : backup.operation === "update" ? "Update" : backup.operation === "merge" ? "Merge" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
                          text={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared copy replacement" : backup.operation === "update" ? "Update" : backup.operation === "merge" ? "Merge" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
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
        ? createPortal(
            <ModalFrame
              ariaLabel={t("Import skills")}
              backdropClassName="library-import-backdrop"
              className="library-import-dialog"
              dialogRef={importDialogRef}
              dismissDisabled={Boolean(githubOperation) && !repositoryOperationCancelable}
              onDismiss={() => void closeImportTool()}
              suspended={importConflictOpen}
            >
                <header className="profile-dialog-header library-import-header">
                  <div className="section-title">{t("Import skills")}</div>
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
                    {t("Local folder")}
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
                          <span>{t("Skill folder")}</span>
                          <input
                            aria-label={t("Local skill folder path")}
                            placeholder={t("No folder selected")}
                            readOnly
                            value={localSkillPath}
                          />
                        </label>
                        <Button
                          aria-label={t("Choose local skill folder")}
                          disabled={localImportOperation || Boolean(githubOperation)}
                          icon={<Folder size={15} strokeWidth={2.2} />}
                          onClick={() => {
                            void selectLocalSkillFolder();
                          }}
                        >
                          {t("Choose folder")}
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
                          ) : selectedLocalCanManage ? (
                            <SlidersHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />
                          ) : (
                            <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                          )}
                          <span>{t(localImportImpact.message, localImportImpact.values)}</span>
                        </div>
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
                          onChange={(event) =>
                            setGithubSelectedSources(
                              event.currentTarget.checked ? githubReadyCandidateSources : []
                            )
                          }
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
                                  setGithubSelectedSources((current) =>
                                    checked
                                      ? [...current, candidate.sourceUrl]
                                      : current.filter((sourceUrl) => sourceUrl !== candidate.sourceUrl)
                                  );
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
                            {selectable && (progressStatus === "failed" || retrying) ? (
                              <Button
                                className="github-candidate-retry"
                                size="compact"
                                variant="secondary"
                                aria-label={t("Retry {{name}}", { name: candidate.name })}
                                disabled={Boolean(githubOperation)}
                                icon={retrying
                                  ? <LoaderCircle className="is-spinning" size={15} />
                                  : <RotateCcw size={15} strokeWidth={2.2} />}
                                onClick={() => void retryGitHubSkill(candidate)}
                              >
                                {t("Retry")}
                              </Button>
                            ) : selectable ? (
                              <input
                                className="github-candidate-id"
                                aria-label={t("Library ID for {{name}}", { name: candidate.name })}
                                disabled={Boolean(githubOperation) || Boolean(githubImportResult)}
                                value={githubCandidateIds[candidate.sourceUrl] ?? candidate.id}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setGithubCandidateIds((current) => ({
                                    ...current,
                                    [candidate.sourceUrl]: value
                                  }));
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
                <footer className="preview-actions import-dialog-actions">
                  <Button
                    variant={githubImportResult ? "primary" : "secondary"}
                    disabled={
                      localImportOperation ||
                      (Boolean(githubOperation) && !repositoryOperationCancelable)
                    }
                    onClick={() => void closeImportTool()}
                  >
                    {t(githubImportResult ? "Close" : "Cancel")}
                  </Button>
                  {importSource === "local" ? (
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
                  ) : !githubScanResult ? (
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
            </ModalFrame>,
            document.body
          )
        : null}
    </section>
  );
};
