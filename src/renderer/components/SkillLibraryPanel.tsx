import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CheckCircle2,
  ExternalLink,
  Folder,
  GitBranch,
  Link2,
  Link2Off,
  LoaderCircle,
  MoreHorizontal,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { useModalDialog } from "../hooks/useModalDialog";
import type {
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
  SkillAvailabilityInput,
  SkillInventoryEntry,
  SkillIconInput,
  SkillLibraryEntry,
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
import {
  matchesSkillStatusFilter,
  type SkillLibraryViewState,
  updateSkillLibraryControls
} from "../libraryViewState";
import {
  automaticSkillCleanupRequest,
  buildSkillCleanupGroups,
  type SkillCleanupDisplayState,
  type SkillCleanupRecommendedAction
} from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { Switch } from "./ui";

export type SkillUpdateCheckStatus = {
  state: "checking" | "success" | "error" | "info";
  message: string;
};

export interface PreparedSkillTarget {
  targetId: string;
  targetName: string;
  disposition: "install" | "omit";
}

interface SkillLibraryPanelProps {
  isLoading?: boolean;
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillInventory: SkillInventoryEntry[];
  cleanupBackups: SkillCleanupBackupSummary[];
  selectedUpdatePlan?: SkillUpdatePlan;
  bulkUpdatePlans?: SkillUpdatePlan[];
  skillUsage: Record<string, string[]>;
  installedTargetIds?: string[];
  preparedTargetsBySkill?: Record<string, PreparedSkillTarget[]>;
  activeTool?: "import" | "discoveries";
  isRefreshingInventory?: boolean;
  onCloseTool?(): void;
  onRefreshInventory(): Promise<void>;
  onSelectLocalSkillFolder(): Promise<string | undefined>;
  onImportUnmanaged(sourcePath: string): Promise<boolean>;
  onImportExternal(skill: SkillInventoryEntry): Promise<boolean>;
  onScanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  onImportGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onConsolidateSkillGroup(input: SkillCleanupRequest): Promise<boolean>;
  onAutoConsolidateSkillGroups(inputs: SkillCleanupRequest[]): Promise<void>;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
  onSetUpdatePolicy(input: SkillUpdatePolicyInput): void;
  onSetAvailability(input: SkillAvailabilityInput): Promise<boolean>;
  onSetIcon(input: SkillIconInput): void;
  onPreviewLibrarySkillUpdate(id: string): void;
  onCloseUpdatePreview(): void;
  onUpdateLibrarySkill(id: string): void;
  onUpdateAllLibrarySkills(ids: string[]): void;
  onPreviewAllLibrarySkillUpdates(ids: string[]): void;
  onCloseBulkUpdatePreview(): void;
  onSyncSkillInstalls(id: string): void;
  onRemoveLibrarySkill(id: string): void;
  onReviewSkillUsage(id: string): void;
  onCheckUpdates(): void;
  onOpenSource(url: string): void;
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
  return skill.source ?? skill.sourceType;
};

const shortRevision = (skill: SkillLibraryEntry) =>
  (skill.remoteRevision ?? skill.contentHash ?? "local").slice(0, 7);

const sourceName = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "local" && !skill.source) {
    return "Library copy";
  }
  const source = sourceLabel(skill);
  if (source.startsWith("https://github.com/")) {
    return source.replace("https://github.com/", "").replace("/tree/", "/");
  }
  return source;
};

const targetName = (targetId: string) => {
  if (targetId === "opencode") return "OpenCode";
  if (targetId === "codex") return "Codex";
  if (targetId === "claude-code") return "Claude Code";
  return targetId;
};

const cleanupLocationLabel = (item: SkillInventoryEntry) => {
  const names = item.foundIn.map(targetName);
  if (names.length > 1) {
    return `Shared: ${names.join(" + ")}`;
  }
  return names[0] ?? "Unknown Target";
};

const inventoryStatusLabel = (status: SkillInventoryEntry["status"]) => {
  if (status === "library") return "Imported";
  if (status === "external") return "External";
  if (status === "unmanaged") return "Unmanaged";
  if (status === "ignored") return "Ignored";
  return "Managed";
};

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
  return "Managed";
};

const cleanupPresentationCompactLabel = (state: SkillCleanupDisplayState) => {
  if (state === "duplicate-copies") return "Duplicate";
  if (state === "multiple-versions" || state === "local-changes-found") return "Conflict";
  if (state === "managed-copy-changed") return "Changed";
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
  return "unmanaged";
};

const cleanupActionLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "add-to-library") return "Add to Library";
  if (action === "manage-copies") return "Manage copies";
  if (action === "review-differences") return "Review differences";
  if (action === "review-drift") return "Review drift";
  if (action === "review-ownership") return "Review ownership";
  if (action === "open-profiles") return "Manage shared Skill";
  if (action === "review-replacement") return "Review replacement";
  return "";
};

const cleanupActionDisplayLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "open-profiles") {
    return "Manage shared";
  }
  if (action === "review-replacement") {
    return "Replace shared";
  }
  if (
    action === "review-differences" ||
    action === "review-drift" ||
    action === "review-ownership"
  ) {
    return "Review";
  }
  return cleanupActionLabel(action);
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const SkillLibraryPanel = ({
  isLoading = false,
  librarySkills,
  skillUpdates,
  skillInventory,
  cleanupBackups,
  selectedUpdatePlan,
  bulkUpdatePlans,
  skillUsage,
  installedTargetIds = [],
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
  onReviewSkillUsage,
  onCheckUpdates,
  onOpenSource,
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
  const { formatDate, t } = useI18n();
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScanResult, setGithubScanResult] = useState<GitHubSkillScanResult>();
  const [githubSelectedIds, setGithubSelectedIds] = useState<string[]>([]);
  const [githubCandidateIds, setGithubCandidateIds] = useState<Record<string, string>>({});
  const [githubImportResult, setGithubImportResult] = useState<GitHubSkillImportResult>();
  const [githubOperation, setGithubOperation] = useState<"scanning" | "importing">();
  const [localImportOperation, setLocalImportOperation] = useState(false);
  const [automaticCleanupKey, setAutomaticCleanupKey] = useState<string>();
  const [cleanupOperationKey, setCleanupOperationKey] = useState<string>();
  const [autoCleanupReviewOpen, setAutoCleanupReviewOpen] = useState(false);
  const [sharedOperation, setSharedOperation] = useState<{
    skillKey: string;
    action: "keep" | "review" | "retire";
  }>();
  const [githubOperationError, setGithubOperationError] = useState("");
  const [localSkillPath, setLocalSkillPath] = useState("");
  const [importSource, setImportSource] = useState<"local" | "github">("local");
  const { search, sourceFilter, statusFilter, targetFilter } = viewState;
  const updateControls = (
    patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>
  ) => onViewStateChange(updateSkillLibraryControls(viewState, patch));
  const [openAction, setOpenAction] = useState<{ id: string; left: number; top: number }>();
  const openActionId = openAction?.id;
  const [deleteCandidate, setDeleteCandidate] = useState<SkillLibraryEntry>();
  const [disableCandidate, setDisableCandidate] = useState<SkillLibraryEntry>();
  const [sourceCandidate, setSourceCandidate] = useState<SkillLibraryEntry>();
  const [availabilityOperation, setAvailabilityOperation] = useState<SkillAvailabilityInput>();
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
    Record<string, { sourceType: SkillSourceType; source: string }>
  >({});
  const modalDialogRef = useRef<HTMLElement>(null);
  const importDialogRef = useRef<HTMLElement>(null);
  const importFallbackFocusRef = useRef<HTMLElement>(null);
  const modalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const modalFallbackFocusRef = useRef<HTMLElement>(null);
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
  const githubReadyCandidateIds = githubScanResult?.candidates
    .filter((candidate) => candidate.status === "ready")
    .map((candidate) => candidate.id) ?? [];
  const githubSelectedReadyCount = githubReadyCandidateIds.filter((candidateId) =>
    githubSelectedIds.includes(candidateId)
  ).length;
  const githubAllReadySelected =
    githubReadyCandidateIds.length > 0 &&
    githubSelectedReadyCount === githubReadyCandidateIds.length;
  const githubSomeReadySelected =
    githubSelectedReadyCount > 0 && !githubAllReadySelected;
  const dismissModal = () => {
    if (selectedUpdatePlan) {
      onCloseUpdatePreview();
    } else if (deleteCandidate) {
      setDeleteCandidate(undefined);
    } else if (disableCandidate) {
      setDisableCandidate(undefined);
    } else if (sourceCandidate) {
      setSourceCandidate(undefined);
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
      bulkUpdatePlans ||
      externalImport ||
      cleanupDetailsKey ||
      sharedTargetReviewKey ||
      sharedRetireKey ||
      autoCleanupReviewOpen ||
      cleanupDraft
  );
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
    }
  }, [openActionId]);
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
        return;
      }
      if (activeTool) {
        if (activeTool === "import" && githubOperation) {
          return;
        }
        onCloseTool?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, githubOperation, modalOpen, onCloseTool, openActionId]);
  useModalDialog({
    open: modalOpen,
    dialogRef: modalDialogRef,
    initialFocusRef: modalInitialFocusRef,
    fallbackFocusRef: modalFallbackFocusRef,
    dismissDisabled: Boolean(availabilityOperation || sharedOperation || cleanupOperationKey),
    onDismiss: dismissModal
  });
  useModalDialog({
    open: activeTool === "import",
    dialogRef: importDialogRef,
    fallbackFocusRef: importFallbackFocusRef,
    dismissDisabled: Boolean(githubOperation),
    onDismiss: () => onCloseTool?.()
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
        !githubOperation &&
        !modalOpen &&
        !target.closest(".library-drawer") &&
        !target.closest(".row-action-popover")
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
    setGithubSelectedIds([]);
    setGithubCandidateIds({});
    setGithubImportResult(undefined);
    setGithubOperationError("");
    setGithubOperation(undefined);
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
        usage.length > 0,
        updatesById.get(skill.id)
      ) &&
      matchesTarget
    );
  });
  const resetFilters = () => {
    updateControls({
      search: "",
      sourceFilter: "all",
      statusFilter: "all",
      targetFilter: "all"
    });
  };

  const toggleActionMenu = (skillId: string, button: HTMLButtonElement) => {
    if (openActionId === skillId) {
      setOpenAction(undefined);
      return;
    }

    const rect = button.getBoundingClientRect();
    const popoverWidth = Math.min(268, window.innerWidth - 32);
    const estimatedHeight = 190;
    const left = Math.min(window.innerWidth - popoverWidth - 16, Math.max(16, rect.right - popoverWidth));
    const belowTop = rect.bottom + 8;
    const top =
      belowTop + estimatedHeight > window.innerHeight - 16
        ? Math.max(16, rect.top - estimatedHeight - 8)
        : belowTop;
    setOpenAction({ id: skillId, left, top });
  };
  const hasActiveFilters =
    search.trim().length > 0 ||
    sourceFilter !== "all" ||
    statusFilter !== "all" ||
    targetFilter !== "all";
  const enabledSkills = librarySkills.filter((skill) => skill.globallyEnabled !== false);
  const referencedSkillCount = enabledSkills.filter(
    (skill) => (skillUsage[skill.id] ?? []).length > 0
  ).length;
  const unreferencedSkillCount = Math.max(enabledSkills.length - referencedSkillCount, 0);
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
  const manualCleanupCount = cleanupGroups.filter(
    (group) => group.presentation.action !== "none"
  ).length;
  const sharedWaitingCount = cleanupGroups.filter(
    (group) => group.presentation.state === "shared-copy-in-use"
  ).length;
  const migrationSummary = [
    manualCleanupCount > 0 ? t("{{count}} need action", { count: manualCleanupCount }) : "",
    sharedWaitingCount > 0 ? t("{{count}} shared copies need review", { count: sharedWaitingCount }) : ""
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
        selectedLocalConflict)
  );
  const localImportImpact = !selectedLocalInventory
    ? undefined
    : selectedLocalInventory.status === "managed"
      ? "This Target copy is already managed by AgentEnv and is present in Library."
      : selectedLocalInventory.status === "ignored"
        ? "This group is ignored. Restore it in Scan local before managing it."
        : selectedLocalConflict
          ? "This folder differs from the existing Library version. Use Scan local to review the conflict."
          : selectedLocalInventory.status === "external"
            ? "This installation is owned by Skills CLI. AgentEnv will import an independent Library copy and leave it unchanged."
            : selectedLocalCanManage
              ? "AgentEnv will back up this Target copy, import it to Library, then replace the folder with a managed copy."
              : undefined;
  const localImportLabel = selectedLocalCanManage ? "Import & manage" : "Import copy";
  const sourceCandidateDraft = sourceCandidate
    ? sourceDrafts[sourceCandidate.id] ?? {
        sourceType: sourceCandidate.sourceType,
        source: sourceCandidate.source ?? ""
      }
    : undefined;
  const cleanupCandidate = cleanupDraft
    ? cleanupGroups.find((group) => group.skillKey === cleanupDraft.skillKey)
    : undefined;
  const cleanupDetails = cleanupDetailsKey
    ? cleanupGroups.find((group) => group.skillKey === cleanupDetailsKey)
    : undefined;
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
        item.externalOwnership &&
        item.contentMatchesLibrary !== true
    ) ?? [];
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

  const scanGitHub = async () => {
    const url = githubUrl.trim();
    if (!url) {
      return;
    }
    setGithubOperation("scanning");
    setGithubOperationError("");
    setGithubImportResult(undefined);
    try {
      const result = await onScanGitHubSkills(url);
      setGithubScanResult(result);
      setGithubSelectedIds(
        result.candidates.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.id)
      );
      setGithubCandidateIds(
        Object.fromEntries(result.candidates.map((candidate) => [candidate.id, candidate.id]))
      );
    } catch (error) {
      setGithubOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubOperation(undefined);
    }
  };

  const importSelectedGitHubSkills = async () => {
    if (!githubScanResult || githubSelectedIds.length === 0) {
      return;
    }
    const selected = githubScanResult.candidates.filter(
      (candidate) => candidate.status === "ready" && githubSelectedIds.includes(candidate.id)
    );
    setGithubOperation("importing");
    setGithubOperationError("");
    try {
      const result = await onImportGitHubSkills(
        selected.map((candidate) => ({
          url: candidate.sourceUrl,
          id: githubCandidateIds[candidate.id] || candidate.id,
          ref: candidate.ref,
          remotePath: candidate.remotePath
        }))
      );
      setGithubImportResult(result);
      if (result.failed.length === 0) {
        setGithubUrl("");
        setGithubScanResult(undefined);
        setGithubSelectedIds([]);
        onCloseTool?.();
      } else {
        const importedIds = new Set(result.imported.map((skill) => skill.id));
        setGithubSelectedIds((current) =>
          current.filter((candidateId) => {
            const resolvedId = githubCandidateIds[candidateId] || candidateId;
            return !importedIds.has(resolvedId);
          })
        );
      }
    } catch (error) {
      setGithubOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubOperation(undefined);
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

  return (
    <section className="skill-library-panel" aria-label={t("Skill library")}>
      <div className="library-control-deck">
        <div className="library-quick-tabs" role="tablist" aria-label={t("Skill status filters")}>
          <button
            className={`library-quick-tab${statusFilter === "all" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "all"}
            onClick={() => updateControls({ statusFilter: "all" })}
          >
            {t("All")} <strong>{librarySkills.length}</strong>
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
            className={`library-quick-tab${statusFilter === "referenced" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "referenced"}
            onClick={() => updateControls({ statusFilter: "referenced" })}
          >
            {t("Referenced")} <strong>{referencedSkillCount}</strong>
          </button>
          <button
            className={`library-quick-tab${statusFilter === "unreferenced" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={statusFilter === "unreferenced"}
            onClick={() => updateControls({ statusFilter: "unreferenced" })}
          >
            {t("Unreferenced")} <strong>{unreferencedSkillCount}</strong>
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
        <div className="library-toolbar">
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
          {hasActiveFilters ? (
            <button
              className="secondary-action library-reset-action"
              type="button"
              aria-label={t("Reset filters")}
              title={t("Reset filters")}
              onClick={resetFilters}
            >
              <RotateCcw size={15} strokeWidth={2.2} />
              <span>{t("Reset filters")}</span>
            </button>
          ) : null}
          <select
            aria-label={t("Skill source filter")}
            value={sourceFilter}
            onChange={(event) =>
              updateControls({ sourceFilter: event.currentTarget.value as typeof sourceFilter })
            }
          >
            <option value="all">{t("Source: All")}</option>
            <option value="github">GitHub</option>
            <option value="local">{t("Local")}</option>
          </select>
          <select
            aria-label={t("Skill target filter")}
            value={targetFilter}
            onChange={(event) =>
              updateControls({ targetFilter: event.currentTarget.value as typeof targetFilter })
            }
          >
            <option value="all">{t("Target: All")}</option>
            <option value="managed">{t("Managed")}</option>
            <option value="library">{t("Imported")}</option>
            <option value="unmanaged">{t("Unmanaged")}</option>
            <option value="ignored">{t("Ignored")}</option>
            <option value="not-installed">{t("Not installed")}</option>
          </select>
          <button
            className="secondary-action library-toolbar-action"
            type="button"
            aria-label={t("Check updates")}
            title={t("Check skill updates")}
            disabled={updateCheckStatus?.state === "checking"}
            onClick={onCheckUpdates}
          >
            <RefreshCw size={15} strokeWidth={2.2} />
            <span>{t(updateCheckStatus?.state === "checking" ? "Checking..." : "Check updates")}</span>
          </button>
          <button
            className="secondary-action library-toolbar-action"
            type="button"
            aria-label={t("Update all skills")}
            title={t("Update all skills")}
            disabled={updateableSkillIds.length === 0}
            onClick={() => onPreviewAllLibrarySkillUpdates(updateableSkillIds)}
          >
            <Sparkles size={15} strokeWidth={2.2} />
            <span>{t("Update all")}</span>
          </button>
        </div>
      </div>

      <section className="library-table" aria-label={t("Library skills")}>
        <div className="library-table__head">
          <span>{t("Skill")}</span>
          <span>{t("Source")}</span>
          <span>{t("Version")}</span>
          <span className="library-column-label">
            {t("Updates")}
            <InfoTip label={t("Shows whether this skill tracks its source and whether an update is available.")} />
          </span>
          <span className="library-column-label">
            {t("Profiles")}
            <InfoTip
              label={t(
                "Shows Profiles that reference this skill, including disabled references."
              )}
            />
          </span>
          <span className="library-column-label">
            {t("Installs")}
            <InfoTip label={t("Shows whether each Target install matches the Library copy. This is separate from source updates.")} />
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
            <p className="muted library-empty">{t("Import a skill from a folder or GitHub to start the library.")}</p>
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
            const updateLabel = !globallyEnabled
              ? "Not checked"
              : !isTracked
              ? "Not tracked"
              : updateInfo?.error
                ? "Check failed"
                : updateInfo?.updateAvailable
                  ? "Available"
                  : updateInfo
                    ? "Up to date"
                    : hasUpdateSource
                      ? "Not checked"
                      : "Library only";
            const hasUpdate = globallyEnabled && isTracked && Boolean(updateInfo?.updateAvailable);
            const hasError = globallyEnabled && isTracked && Boolean(updateInfo?.error);
            const updateAction = hasUpdate ? "update" : hasError ? "retry" : undefined;
            const usageCount = (skillUsage[skill.id] ?? []).length;
            const revisionLabel = shortRevision(skill);
            const versionLabel = skill.version ?? skill.remoteRef ?? revisionLabel;
            const versionDetail = skill.version
              ? revisionLabel
              : skill.remoteRef
                ? revisionLabel
              : hasUpdateSource
                ? isTracked
                  ? "Tracked source"
                  : "Source retained"
                : "Library revision";
            return (
              <div
                aria-label={t("Library item {{id}}", { id: skill.id })}
                className={`library-table-row${globallyEnabled ? "" : " is-globally-disabled"}`}
                key={skill.id}
                role="group"
              >
                <div className="library-resource-cell">
                  <ResourceIconPicker
                    className="resource-avatar"
                    iconKey={skill.iconKey ?? (skill.sourceType === "github" ? "github" : "folder")}
                    label={skill.name}
                    onChange={(iconKey) => onSetIcon({ id: skill.id, iconKey })}
                  />
                  <div className="skill-title-stack">
                    <span className="skill-title-line">
                      <strong className="skill-title">{skill.name}</strong>
                      {(skillNameCounts.get(skill.name.normalize("NFKC").trim().toLowerCase()) ?? 0) > 1 ? (
                        <span className="library-duplicate-id">{skill.id}</span>
                      ) : null}
                      {!globallyEnabled || availabilityIsChanging ? (
                        <span className={`library-global-state${availabilityIsChanging ? " is-working" : ""}`}>
                          {availabilityIsChanging ? (
                            <LoaderCircle className="is-spinning" size={12} strokeWidth={2.2} />
                          ) : null}
                          {t(
                            availabilityIsChanging
                              ? availabilityOperation.enabled
                                ? "Enabling..."
                                : "Disabling..."
                              : "Disabled"
                          )}
                        </span>
                      ) : null}
                    </span>
                    <PreviewText className="skill-description" text={skill.description || skill.id} />
                  </div>
                </div>
                <div className="library-source-cell">
                  {skill.sourceType === "github" && /^https?:\/\//i.test(skill.source ?? "") ? (
                    <button
                      className="resource-chip resource-chip--github library-source-open"
                      type="button"
                      aria-label={t("Open GitHub source for {{id}}", { id: skill.id })}
                      onClick={() => onOpenSource(skill.source!)}
                    >
                      <GitBranch size={13} strokeWidth={2.2} />
                      <span>GitHub</span>
                      <ExternalLink size={11} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <span className={`resource-chip resource-chip--${skill.sourceType}`}>
                      <Folder size={13} strokeWidth={2.2} />
                      {skill.sourceType === "github" ? "GitHub" : t("Local")}
                    </span>
                  )}
                  <PreviewText
                    ariaLabel={t("Full source for {{id}}", { id: skill.id })}
                    className="library-source-address"
                    displayText={t(sourceName(skill))}
                    text={sourceLabel(skill)}
                    tooltipClassName="library-source-tooltip"
                  />
                </div>
                <div className="library-version-cell">
                  <strong>{versionLabel}</strong>
                  <small>{t(versionDetail)}</small>
                </div>
                <div className="library-update-cell">
                  {updateAction ? (
                    <button
                      className={`library-row-inline-action${
                        updateAction === "update" ? " is-update" : " is-error"
                      }`}
                      type="button"
                      aria-label={
                        updateAction === "update"
                          ? t("Review update {{id}}", { id: skill.id })
                          : t("Retry update check {{id}}", { id: skill.id })
                      }
                      disabled={updateCheckStatus?.state === "checking"}
                      onClick={(event) => {
                        modalFallbackFocusRef.current = event.currentTarget;
                        onPreviewLibrarySkillUpdate(skill.id);
                      }}
                    >
                      {updateAction === "update" ? (
                        <Sparkles size={14} strokeWidth={2.2} />
                      ) : (
                        <TriangleAlert size={14} strokeWidth={2.2} />
                      )}
                      <span>{t(updateAction === "update" ? "Update" : "Retry")}</span>
                    </button>
                  ) : (
                    <strong
                      aria-label={updateLabel}
                      className="resource-status"
                    >
                      {!globallyEnabled ? (
                        <Link2Off size={13} strokeWidth={2.2} />
                      ) : !isTracked ? (
                        <Link2Off size={13} strokeWidth={2.2} />
                      ) : !hasUpdateSource ? (
                        <Folder size={13} strokeWidth={2.2} />
                      ) : (
                        <CheckCircle2 size={13} strokeWidth={2.2} />
                      )}
                      <span>{t(updateLabel)}</span>
                    </strong>
                  )}
                  {globallyEnabled && updateInfo?.latestRevision ? (
                    <PreviewText
                      ariaLabel={t("Full update status for {{id}}", { id: skill.id })}
                      className="library-update-detail"
                      text={`${updateInfo.latestRevision.slice(0, 7)} ${t(hasUpdate ? "available" : "current")}`}
                    />
                  ) : hasError ? (
                    <PreviewText
                      ariaLabel={t("Full update status for {{id}}", { id: skill.id })}
                      className="library-update-detail"
                      text={t("Source check failed")}
                    />
                  ) : null}
                </div>
                <div className="library-usage-cell">
                  <strong className="usage-summary">
                    <Users size={13} strokeWidth={2.2} />
                    {t(usageCount === 1 ? "{{count}} profile" : "{{count}} profiles", { count: usageCount })}
                  </strong>
                  <small>
                    {(skillUsage[skill.id] ?? []).length > 0
                      ? (skillUsage[skill.id] ?? []).join(", ")
                      : t("Not referenced")}
                  </small>
                </div>
                <div className="library-installs-cell">
                  {staleCopies.length > 0 ? (
                    <>
                      <button
                        className="library-row-inline-action"
                        type="button"
                        aria-label={t(
                          staleCopies.length === 1
                            ? "Sync install of {{id}}"
                            : "Sync {{count}} installs of {{id}}",
                          { count: staleCopies.length, id: skill.id }
                        )}
                        onClick={() => onSyncSkillInstalls(skill.id)}
                      >
                        <RefreshCw size={14} strokeWidth={2.2} />
                        <span>{t("Sync")}</span>
                      </button>
                      <PreviewText
                        ariaLabel={t("Full install status for {{id}}", { id: skill.id })}
                        className="library-install-detail"
                        text={t("{{count}} out of sync", { count: staleCopies.length })}
                      />
                    </>
                  ) : null}
                  {installs.length === 0 ? <strong className="library-install-empty">{t("Not installed")}</strong> : null}
                  {staleCopies.length === 0 ? installs.slice(0, 1).map((install) => (
                    <span className="library-install-entry" key={install.path}>
                      <span title={install.foundIn.map(targetName).join(", ")}>
                        {install.foundIn.map(targetName).join(", ")}
                        {installs.length > 1 ? ` +${installs.length - 1}` : ""}
                      </span>
                      <strong className={`resource-chip resource-chip--${install.status}`}>
                        {install.status === "managed" && install.installMethod === "linked" ? (
                          <Link2 size={13} strokeWidth={2.2} />
                        ) : install.status === "managed" && install.contentMatchesLibrary === false ? (
                          <RefreshCw size={13} strokeWidth={2.2} />
                        ) : install.status === "managed" ? (
                          <CheckCircle2 size={13} strokeWidth={2.2} />
                        ) : (
                          <SlidersHorizontal size={13} strokeWidth={2.2} />
                        )}
                        {install.status === "managed"
                          ? install.installMethod === "linked"
                            ? t("Live link")
                            : install.contentMatchesLibrary === false
                              ? t("Needs sync")
                              : t("Synced")
                          : install.status === "library"
                            ? t("Imported")
                            : install.status === "ignored"
                              ? t("Ignored")
                              : t("Unmanaged")}
                      </strong>
                    </span>
                  )) : null}
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
                          className="row-action-popover"
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
                              onClick={() => {
                                modalFallbackFocusRef.current = document.querySelector(
                                  `[aria-label="More actions for ${CSS.escape(skill.id)}"]`
                                );
                                onPreviewLibrarySkillUpdate(skill.id);
                                setOpenAction(undefined);
                              }}
                            >
                              <RefreshCw size={14} strokeWidth={2.2} />
                              <span>{t(hasUpdate ? "Preview update" : "Check update")}</span>
                            </button>
                          ) : null}
                          <button
                            className="row-action-item"
                            type="button"
                            role="menuitem"
                            disabled={Boolean(availabilityOperation)}
                            onClick={() => {
                              if (globallyEnabled) {
                                modalFallbackFocusRef.current = document.querySelector(
                                  `[aria-label="More actions for ${CSS.escape(skill.id)}"]`
                                );
                                setDisableCandidate(skill);
                              } else {
                                void runAvailabilityChange({ id: skill.id, enabled: true });
                              }
                              setOpenAction(undefined);
                            }}
                          >
                            <Power size={14} strokeWidth={2.2} />
                            <span>{t(globallyEnabled ? "Disable globally" : "Enable globally")}</span>
                          </button>
                          <button
                            className="row-action-item"
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              modalFallbackFocusRef.current = document.querySelector(
                                `[aria-label="More actions for ${CSS.escape(skill.id)}"]`
                              );
                              setSourceCandidate(skill);
                              setOpenAction(undefined);
                            }}
                          >
                            <Settings2 size={14} strokeWidth={2.2} />
                            <span>{t("Update settings")}</span>
                          </button>
                          <button
                            className="row-action-item row-action-item--danger"
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              modalFallbackFocusRef.current = document.querySelector(
                                `[aria-label="More actions for ${CSS.escape(skill.id)}"]`
                              );
                              setDeleteCandidate(skill);
                              setOpenAction(undefined);
                            }}
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

      <SkillUpdateDialog
        plan={selectedUpdatePlan}
        onClose={onCloseUpdatePreview}
        onConfirm={onUpdateLibrarySkill}
      />

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
                  </select>
                </label>
                <label>
                  <span>{t("Update source")}</span>
                  <input
                    aria-label={t("Update source for {{id}}", { id: sourceCandidate.id })}
                    placeholder={
                      sourceCandidateDraft.sourceType === "github"
                        ? "https://github.com/owner/repo/tree/main/path/to/skill"
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
              </div>
              <p className="skill-update-settings-help">
                <InfoTip label={t("Use a local skill folder or a GitHub tree directory. The library stores the source path, not duplicated skill copies per profile.")} />
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
                    source: sourceCandidateDraft.source.trim()
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
                                ? "Remove {{name}} and 1 managed target install? Unmanaged copies are kept."
                                : "Remove {{name}} and {{count}} managed target installs? Unmanaged copies are kept.",
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
            aria-label={t("Manage ready copies")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Manage ready copies")}</div>
                <p className="muted">
                  {t("These Skills have one clear canonical version. AgentEnv will add or reuse Library content and normalize the detected Target copies.")}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list">
              {automaticCleanupRequests.map((request) => (
                <span key={request.skillKey}>
                  {cleanupGroups.find((group) => group.skillKey === request.skillKey)?.primary?.name ?? request.skillKey}
                </span>
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
                {t("Manage {{count}} skills", { count: automaticCleanupRequests.length })}
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
            aria-label={t("Review shared Skill Targets")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Manage shared Skill")}</div>
                <p className="muted">
                  {t("{{name}} is loaded from a shared compatibility folder, independently of Profile references.", {
                    name: sharedTargetReview.primary?.name ?? sharedTargetReview.skillKey
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-bulk-review-list">
              {sharedTargetReview.sharedMigration.pendingConsumers.map((targetId) => (
                <span key={targetId}>{t(targetName(targetId))}</span>
              ))}
              <ol className="shared-target-review-steps">
                <li>{t("Configure and Apply the Profile each Target should use.")}</li>
                <li>{t("Return to Scan local and choose Replace shared.")}</li>
              </ol>
              <small>{t("A Profile without this Skill records that it should be removed from that Target.")}</small>
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
                {t("Keep shared")}
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => {
                  setSharedTargetReviewKey(undefined);
                  onOpenProfiles();
                }}
              >
                {t("Configure Profiles")}
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
                  {t("Every installed consumer is ready. Replace the shared {{name}} copy with each Target's saved Profile?", {
                    name: sharedRetireCandidate.primary?.name ?? sharedRetireCandidate.skillKey
                  })}
                </p>
              </div>
            </header>
            <div className="cleanup-retire-summary">
              <div>
                <strong>{t("Prepared consumers")}</strong>
                {sharedRetireTargets.length > 0 ? (
                  <div className="cleanup-migration-decisions">
                    {sharedRetireTargets.map((target) => (
                      <span key={target.targetId}>
                        <strong>{targetName(target.targetId)}</strong>
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
              <small>{t("The Library copy is kept. One backup covers the shared copy, Target copies, and migration state; any failed step restores all of them.")}</small>
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
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label={t("Disable library skill")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {t("Disable {{name}} globally?", { name: disableCandidate.name })}
                </div>
                <p className="muted">
                  {(skillUsage[disableCandidate.id] ?? []).length > 0
                    ? t(
                        (skillUsage[disableCandidate.id] ?? []).length === 1
                          ? "This skill stays in Library and in 1 Profile, but it will be excluded from Apply. Its managed Target installs are removed the next time that Profile is applied."
                          : "This skill stays in Library and in {{count}} Profiles, but it will be excluded from Apply. Managed Target installs are removed the next time each Profile is applied.",
                        { count: (skillUsage[disableCandidate.id] ?? []).length }
                      )
                    : t("This skill stays in Library but cannot be added to or applied by Profiles until it is enabled again.")}
                </p>
              </div>
            </header>
            <footer className="preview-actions">
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
                onClick={() => onUpdateAllLibrarySkills(bulkUpdatePlans.filter((plan) => plan.changes.length > 0 && plan.errors.length === 0).map((plan) => plan.id))}
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
                  {t("Create an independent Library copy. Skills CLI files and lock data stay unchanged.")}
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
                    <strong>{t(cleanupLocationLabel(item))}</strong>
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
                {t(localImportOperation ? "Importing..." : "Import copy")}
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
              {cleanupDetails.items.map((item) => (
                <div className="cleanup-details-location" key={`${item.status}-${item.path}`}>
                  <div>
                    <strong>{t(cleanupLocationLabel(item))}</strong>
                    <span className={`resource-chip resource-chip--${item.status}`}>
                      {t(inventoryStatusLabel(item.status))}
                    </span>
                  </div>
                  <PreviewText
                    ariaLabel={t("Full detail path {{path}}", { path: item.path })}
                    className="cleanup-option-path"
                    text={item.path}
                    tooltipClassName="library-source-tooltip"
                  />
                  <small>
                    {item.libraryId ? `${t("Library")}: ${item.libraryId} · ` : ""}
                    {t("Content {{hash}}", { hash: item.contentHash ? item.contentHash.slice(0, 7) : t("unavailable") })}
                  </small>
                  {item.sharedLocation ? <small>{t("Shared compatibility location")}</small> : null}
                </div>
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
                      ? t("Choose the version to keep. AgentEnv will add it to Library, keep one shared copy active, and remove redundant Target copies after backup.")
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
                          <strong>{t(cleanupLocationLabel(item))}</strong>
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
                          <strong>{t(cleanupLocationLabel(item))}</strong>
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
                      ? "The shared copy stays active until Profiles are ready. Redundant Target copies are removed."
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
                      <strong>{t(cleanupLocationLabel(item))}</strong>
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
                <small>{migrationSummary || t("No migration actions needed")}</small>
              </div>
              <button
                className={`${automaticCleanupRequests.length > 0 ? "primary-action" : "secondary-action"} cleanup-auto-action`}
                type="button"
                aria-label={
                  automaticCleanupRequests.length > 0
                    ? t("Auto-manage {{count}} ready skills", { count: automaticCleanupRequests.length })
                    : t("Auto-manage unavailable")
                }
                title={
                  automaticCleanupRequests.length === 0
                    ? t("No skills can be managed automatically right now.")
                    : undefined
                }
                disabled={Boolean(automaticCleanupKey) || automaticCleanupRequests.length === 0}
                onClick={() => setAutoCleanupReviewOpen(true)}
              >
                <Sparkles
                  className={automaticCleanupKey === "all" ? "is-spinning" : undefined}
                  size={15}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                {t(automaticCleanupKey === "all" ? "Managing..." : "Auto-manage")}
              </button>
            </div>
            <div className="resource-list resource-list--unmanaged">
              {cleanupGroups.length === 0 ? (
                <p className="muted library-empty">
                  {t("No target skills detected. Install skills into a supported target and scan again.")}
                </p>
              ) : null}
              {cleanupGroups.map((group) => {
                const hasIgnored = group.items.some((skill) => skill.status === "ignored");
                const allIgnored = group.activeItems.length === 0;
                const canIgnore = group.activeItems.some((skill) => skill.status !== "managed");
                const sharedMigration = group.sharedMigration;
                const chipLabel = t(cleanupPresentationCompactLabel(group.presentation.state));
                const chipDetail = t(cleanupPresentationLabel(group.presentation.state));
                const chipClass = cleanupPresentationChipClass(group.presentation.state);
                const actionLabel = t(cleanupActionLabel(group.presentation.action));
                const actionDisplayLabel = t(cleanupActionDisplayLabel(group.presentation.action));
                const linkedLibraryId = group.items.find((item) => item.libraryId)?.libraryId;
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
                  ? t("{{count}} Targets still load this shared copy", {
                      count: sharedMigration.pendingConsumers.length
                    })
                  : sharedMigration?.state === "ready"
                    ? t("All consumer Targets are ready")
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
                  if (group.presentation.action === "review-ownership") {
                    const source = group.activeItems.find(
                      (item) =>
                        item.status === "external" &&
                        item.contentMatchesLibrary !== true &&
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
                  <div
                    aria-label={t("Cleanup group {{id}}", { id: group.skillKey })}
                    className="resource-row cleanup-group-row"
                    key={group.skillKey}
                    role="group"
                  >
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
                          ariaLabel={t("Full shared migration state {{id}}", { id: group.skillKey })}
                          className="cleanup-shared-progress"
                          text={sharedProgressText}
                        />
                      ) : null}
                      <PreviewText
                        ariaLabel={t("Full cleanup summary {{id}}", { id: group.skillKey })}
                        className="cleanup-group-summary"
                        displayText={`${group.primary?.description || group.skillKey} · ${group.items.length} ${group.items.length === 1 ? "location" : "locations"}`}
                        text={`${group.primary?.description || group.skillKey} · ${group.items.length} ${group.items.length === 1 ? "location" : "locations"}`}
                      />
                      <PreviewText
                        ariaLabel={t("Full cleanup locations {{id}}", { id: group.skillKey })}
                        className="cleanup-group-locations"
                        displayText={group.items
                          .map((skill) => `${cleanupLocationLabel(skill)} · ${skill.path}`)
                          .join(" | ")}
                        text={group.items
                          .map((skill) => `${cleanupLocationLabel(skill)} · ${skill.path}`)
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
                      {group.presentation.action !== "none" ? (
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
                              className="row-action-popover cleanup-action-popover"
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
                                  <span><strong>{t("Keep shared")}</strong></span>
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
                      <div className="resource-row__main">
                        <PreviewText
                          ariaLabel={t("Full cleanup history name {{id}}", { id: backup.libraryId })}
                          className="cleanup-history-name"
                          text={backup.libraryId}
                        />
                        <PreviewText
                          ariaLabel={t("Full cleanup history details {{id}}", { id: backup.libraryId })}
                          className="cleanup-history-details"
                          displayText={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared migration" : backup.operation === "update" ? "Update" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
                          text={`${t(backup.operation === "remove" ? "Removal" : backup.operation === "retire" ? "Shared migration" : backup.operation === "update" ? "Update" : "Cleanup")} · ${t("{{count}} locations", { count: backup.locationCount })} · ${formatDate(backup.createdAt)}`}
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
            <div className="library-drawer-backdrop">
              <section
                ref={importDialogRef}
                className="library-drawer library-import-dialog"
                role="dialog"
                aria-label={t("Import skills")}
                aria-modal="true"
                tabIndex={-1}
              >
                <div className="library-drawer__header">
                  <strong>{t("Import skills")}</strong>
                  <button
                    className="icon-action"
                    type="button"
                    aria-label={t("Close import")}
                    disabled={Boolean(githubOperation) || localImportOperation}
                    onClick={onCloseTool}
                  >
                    <X size={16} strokeWidth={2.2} />
                  </button>
                </div>

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
                    GitHub
                  </button>
                </div>

                {importSource === "local" ? (
                  <div className="library-import-content">
                    <section className="resource-section library-import-panel">
                      <div className="resource-heading">{t("Choose a skill folder")}</div>
                      <div className="library-import-grid">
                        <label>
                          <span>{t("Selected folder")}</span>
                          <input
                            aria-label={t("Local skill folder path")}
                            placeholder={t("No folder selected")}
                            readOnly
                            value={localSkillPath}
                          />
                        </label>
                        <button
                          className="secondary-action"
                          aria-label={t("Choose local skill folder")}
                          type="button"
                          disabled={localImportOperation || Boolean(githubOperation)}
                          onClick={() => {
                            void selectLocalSkillFolder();
                          }}
                        >
                          {t("Choose folder")}
                        </button>
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
                          <span>{t(localImportImpact)}</span>
                        </div>
                      ) : null}
                    </section>
                  </div>
                ) : !githubScanResult ? (
                  <div className="library-import-content">
                    <section className="resource-section library-import-panel">
                      <div className="resource-heading">
                        {t("Scan GitHub")}
                        <InfoTip label={t("Paste a skill, directory, or repository URL.")} />
                      </div>
                      <label className="github-scan-field">
                        <span>{t("GitHub URL")}</span>
                        <input
                          aria-label={t("GitHub skill URL")}
                          placeholder="https://github.com/owner/repo"
                          disabled={localImportOperation}
                          value={githubUrl}
                          onChange={(event) => setGithubUrl(event.currentTarget.value)}
                        />
                      </label>
                    </section>
                  </div>
                ) : (
                  <div className="github-scan-results">
                    <div className="github-scan-summary">
                      <div>
                        <strong>{t("{{count}} found", { count: githubScanResult.candidates.length })}</strong>
                        <span>{githubScanResult.owner}/{githubScanResult.repo} · {githubScanResult.ref}</span>
                      </div>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={Boolean(githubOperation)}
                        onClick={() => {
                          setGithubScanResult(undefined);
                          setGithubImportResult(undefined);
                          setGithubOperationError("");
                        }}
                      >
                        {t("Change")}
                      </button>
                    </div>
                    {githubScanResult.truncated ? (
                      <div className="inline-state inline-state--warning" role="status">
                        <TriangleAlert size={15} aria-hidden="true" />
                        {t("Results are incomplete. GitHub truncated this repository tree.")}
                      </div>
                    ) : null}
                    <div className="github-selection-bar">
                      <label className="github-select-all">
                        <input
                          type="checkbox"
                          aria-label={t("Select all discovered skills")}
                          checked={githubAllReadySelected}
                          disabled={githubReadyCandidateIds.length === 0 || Boolean(githubOperation)}
                          ref={(checkbox) => {
                            if (checkbox) {
                              checkbox.indeterminate = githubSomeReadySelected;
                            }
                          }}
                          onChange={(event) =>
                            setGithubSelectedIds(
                              event.currentTarget.checked ? githubReadyCandidateIds : []
                            )
                          }
                        />
                        <span>{t("Select all")}</span>
                      </label>
                      <span className="github-selection-count" role="status">
                        {t("{{count}} selected", { count: githubSelectedIds.length })}
                      </span>
                    </div>
                    <div className="github-candidate-list">
                      {githubScanResult.candidates.length === 0 ? (
                        <div className="inline-state">{t("No skills found")}</div>
                      ) : null}
                      {githubScanResult.candidates.map((candidate) => {
                        const selectable = candidate.status === "ready";
                        const checked = githubSelectedIds.includes(candidate.id);
                        const failure = githubImportResult?.failed.find(
                          (item) => item.sourceUrl === candidate.sourceUrl
                        );
                        return (
                          <div
                            className={`github-candidate-row${selectable ? "" : " is-disabled"}`}
                            key={candidate.sourceUrl}
                          >
                            <input
                              type="checkbox"
                              aria-label={t("Select {{name}}", { name: candidate.name })}
                              disabled={!selectable || Boolean(githubOperation)}
                              checked={checked}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setGithubSelectedIds((current) =>
                                  checked
                                    ? [...current, candidate.id]
                                    : current.filter((id) => id !== candidate.id)
                                );
                              }}
                            />
                            <span className="resource-avatar resource-avatar--github" aria-hidden="true">
                              <GitBranch size={16} strokeWidth={2.2} />
                            </span>
                            <span className="github-candidate-main">
                              <strong>{candidate.name}</strong>
                              <PreviewText
                                ariaLabel={t("Full GitHub path {{id}}", { id: candidate.id })}
                                className="github-candidate-path"
                                text={candidate.remotePath || "/"}
                                tooltipClassName="library-source-tooltip"
                              />
                              {candidate.description ? <small>{candidate.description}</small> : null}
                              {failure ? <small className="field-error">{failure.error}</small> : null}
                            </span>
                            {selectable ? (
                              <input
                                className="github-candidate-id"
                                aria-label={t("Library ID for {{name}}", { name: candidate.name })}
                                disabled={Boolean(githubOperation)}
                                value={githubCandidateIds[candidate.id] ?? candidate.id}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setGithubCandidateIds((current) => ({
                                    ...current,
                                    [candidate.id]: value
                                  }));
                                }}
                              />
                            ) : (
                              <span className="resource-chip resource-chip--managed">
                                {t(candidate.status === "duplicate" ? "Duplicate" : "Imported")}
                              </span>
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
                  </div>
                ) : null}
                <footer className="preview-actions import-dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={Boolean(githubOperation) || localImportOperation}
                    onClick={onCloseTool}
                  >
                    {t("Cancel")}
                  </button>
                  {importSource === "local" ? (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={
                          !localSkillPath.trim() ||
                          localImportOperation ||
                          Boolean(githubOperation) ||
                          localImportBlocked
                        }
                        onClick={() => void importLocalSkill()}
                      >
                        {localImportOperation ? t("Importing...") : t(localImportLabel)}
                      </button>
                  ) : !githubScanResult ? (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={!githubUrl.trim() || Boolean(githubOperation) || localImportOperation}
                        onClick={() => {
                          void scanGitHub();
                        }}
                      >
                        {t(githubOperation === "scanning" ? "Scanning..." : "Scan")}
                      </button>
                  ) : (
                    <button
                      className="primary-action"
                      type="button"
                      disabled={githubSelectedIds.length === 0 || Boolean(githubOperation)}
                      onClick={() => {
                        void importSelectedGitHubSkills();
                      }}
                    >
                      {githubOperation === "importing" ? t("Importing...") : t("Import {{count}}", { count: githubSelectedIds.length })}
                    </button>
                  )}
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </section>
  );
};
