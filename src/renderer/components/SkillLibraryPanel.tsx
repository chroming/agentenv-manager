import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BookOpenText,
  CheckCircle2,
  ExternalLink,
  Folder,
  GitBranch,
  Link2,
  Link2Off,
  MoreHorizontal,
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
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
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
import { DiffViewer } from "./DiffViewer";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { ResourceIconPicker } from "./ResourceIconPicker";
import {
  type SkillLibraryViewState,
  updateSkillLibraryControls
} from "../libraryViewState";
import {
  automaticSkillCleanupRequest,
  buildSkillCleanupGroups
} from "../../shared/skillCleanup";

export type SkillUpdateCheckStatus = {
  state: "checking" | "success" | "error" | "info";
  message: string;
};

interface SkillLibraryPanelProps {
  isLoading?: boolean;
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillInventory: SkillInventoryEntry[];
  cleanupBackups: SkillCleanupBackupSummary[];
  selectedUpdatePlan?: SkillUpdatePlan;
  bulkUpdatePlans?: SkillUpdatePlan[];
  skillUsage: Record<string, string[]>;
  activeTool?: "import" | "discoveries";
  onCloseTool?(): void;
  onSelectLocalSkillFolder(): Promise<string | undefined>;
  onImportUnmanaged(sourcePath: string): Promise<boolean>;
  onImportExternal(skill: SkillInventoryEntry): Promise<boolean>;
  onScanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  onImportGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onConsolidateSkillGroup(input: SkillCleanupRequest): void;
  onAutoConsolidateSkillGroups(inputs: SkillCleanupRequest[]): Promise<void>;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
  onSetUpdatePolicy(input: SkillUpdatePolicyInput): void;
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
  onRestoreCleanup(backupId: string): void;
  updateCheckStatus?: SkillUpdateCheckStatus;
  viewState: SkillLibraryViewState;
  onViewStateChange(next: SkillLibraryViewState): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
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
  activeTool,
  onCloseTool,
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
  onRestoreCleanup,
  updateCheckStatus,
  viewState,
  onViewStateChange,
  searchInputRef
}: SkillLibraryPanelProps) => {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubScanResult, setGithubScanResult] = useState<GitHubSkillScanResult>();
  const [githubSelectedIds, setGithubSelectedIds] = useState<string[]>([]);
  const [githubCandidateIds, setGithubCandidateIds] = useState<Record<string, string>>({});
  const [githubImportResult, setGithubImportResult] = useState<GitHubSkillImportResult>();
  const [githubOperation, setGithubOperation] = useState<"scanning" | "importing">();
  const [localImportOperation, setLocalImportOperation] = useState(false);
  const [automaticCleanupKey, setAutomaticCleanupKey] = useState<string>();
  const [githubOperationError, setGithubOperationError] = useState("");
  const [localSkillPath, setLocalSkillPath] = useState("");
  const { search, sourceFilter, usageFilter, targetFilter, updateFilter } = viewState;
  const updateControls = (
    patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>
  ) => onViewStateChange(updateSkillLibraryControls(viewState, patch));
  const [openAction, setOpenAction] = useState<{ id: string; left: number; top: number }>();
  const openActionId = openAction?.id;
  const [deleteCandidate, setDeleteCandidate] = useState<SkillLibraryEntry>();
  const [cleanupDraft, setCleanupDraft] = useState<{
    skillKey: string;
    libraryId: string;
    canonicalPath: string;
    selectedPaths: string[];
  }>();
  const [externalImport, setExternalImport] = useState<{
    skillKey: string;
    sourcePath: string;
  }>();
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { sourceType: SkillSourceType; source: string }>
  >({});
  const modalDialogRef = useRef<HTMLElement>(null);
  const importDialogRef = useRef<HTMLElement>(null);
  const importFallbackFocusRef = useRef<HTMLElement>(null);
  const modalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const modalFallbackFocusRef = useRef<HTMLElement>(null);
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const updateableSkillIds = skillUpdates
    .filter((update) => update.updateAvailable && !update.error)
    .map((update) => update.id);
  const availableUpdateCount = updateableSkillIds.length;
  const dismissModal = () => {
    if (selectedUpdatePlan) {
      onCloseUpdatePreview();
    } else if (deleteCandidate) {
      setDeleteCandidate(undefined);
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
      bulkUpdatePlans ||
      externalImport ||
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
      if (activeTool && !githubOperation && !target.closest(".library-drawer")) {
        onCloseTool?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeTool, githubOperation, onCloseTool, openActionId]);

  useEffect(() => {
    if (activeTool === "import") {
      return;
    }
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
    const matchesUsage =
      usageFilter === "all" ||
      (usageFilter === "used" ? usage.length > 0 : usage.length === 0);
    const matchesTarget =
      targetFilter === "all" ||
      (targetFilter === "not-installed"
        ? installs.length === 0
        : installs.some((install) => install.status === targetFilter));
    const matchesUpdate =
      updateFilter === "all" || Boolean(updatesById.get(skill.id)?.updateAvailable);

    return matchesSearch && matchesSource && matchesUsage && matchesTarget && matchesUpdate;
  });
  const resetFilters = () => {
    updateControls({
      search: "",
      sourceFilter: "all",
      usageFilter: "all",
      targetFilter: "all",
      updateFilter: "all"
    });
  };

  const toggleActionMenu = (skillId: string, button: HTMLButtonElement) => {
    if (openActionId === skillId) {
      setOpenAction(undefined);
      return;
    }

    const rect = button.getBoundingClientRect();
    const popoverWidth = Math.min(420, window.innerWidth - 32);
    const estimatedHeight = 250;
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
    usageFilter !== "all" ||
    targetFilter !== "all" ||
    updateFilter !== "all";
  const usedSkillCount = librarySkills.filter((skill) => (skillUsage[skill.id] ?? []).length > 0).length;
  const unusedSkillCount = Math.max(librarySkills.length - usedSkillCount, 0);
  const cleanupGroups = useMemo(
    () => buildSkillCleanupGroups(skillInventory),
    [skillInventory]
  );
  const automaticCleanupRequests = useMemo(
    () =>
      cleanupGroups
        .map(automaticSkillCleanupRequest)
        .filter((request): request is SkillCleanupRequest => Boolean(request)),
    [cleanupGroups]
  );
  const manualCleanupCount = cleanupGroups.filter(
    (group) => group.resolution === "manual"
  ).length;
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
  const cleanupCandidate = cleanupDraft
    ? cleanupGroups.find((group) => group.skillKey === cleanupDraft.skillKey)
    : undefined;
  const externalImportGroup = externalImport
    ? cleanupGroups.find((group) => group.skillKey === externalImport.skillKey)
    : undefined;
  const externalImportItems =
    externalImportGroup?.activeItems.filter(
      (item) => item.status === "external" && item.externalOwnership
    ) ?? [];
  const cleanupUsesExistingLibrary = Boolean(
    cleanupCandidate?.items.some((item) => item.status === "library" || item.status === "managed") ||
      (cleanupDraft && librarySkills.some((skill) => skill.id === cleanupDraft.libraryId))
  );

  const openCleanupReview = (group: (typeof cleanupGroups)[number]) => {
    const libraryId = group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey;
    const manageableItems = group.activeItems.filter((item) => item.status !== "managed");
    const canonical =
      manageableItems.find((item) => item.status === "library") ?? manageableItems[0];
    if (!canonical) {
      return;
    }
    setCleanupDraft({
      skillKey: group.skillKey,
      libraryId,
      canonicalPath: canonical.path,
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
    try {
      await onAutoConsolidateSkillGroups(requests);
    } finally {
      setAutomaticCleanupKey(undefined);
    }
  };

  const selectLocalSkillFolder = async () => {
    const sourcePath = await onSelectLocalSkillFolder();
    if (sourcePath) {
      setLocalSkillPath(sourcePath);
    }
  };

  return (
    <section className="skill-library-panel" aria-label="Skill library">
      <div className="library-control-deck">
        <div className="library-quick-tabs" role="tablist" aria-label="Skill status filters">
          <button
            className={`library-quick-tab${updateFilter === "all" && usageFilter === "all" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={updateFilter === "all" && usageFilter === "all"}
            onClick={() => {
              updateControls({ updateFilter: "all", usageFilter: "all" });
            }}
          >
            All <strong>{librarySkills.length}</strong>
          </button>
          <button
            className={`library-quick-tab${updateFilter === "updates" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={updateFilter === "updates"}
            onClick={() => updateControls({ updateFilter: "updates" })}
          >
            Updates <strong>{availableUpdateCount}</strong>
          </button>
          <button
            className={`library-quick-tab${usageFilter === "used" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={usageFilter === "used"}
            onClick={() => {
              updateControls({ usageFilter: "used", updateFilter: "all" });
            }}
          >
            In use <strong>{usedSkillCount}</strong>
          </button>
          <button
            className={`library-quick-tab${usageFilter === "unused" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={usageFilter === "unused"}
            onClick={() => {
              updateControls({ usageFilter: "unused", updateFilter: "all" });
            }}
          >
            Unused <strong>{unusedSkillCount}</strong>
          </button>
        </div>
        <div className="library-toolbar">
          <label className="library-search">
            <span>Search</span>
            <Search size={16} strokeWidth={2.1} aria-hidden="true" />
            <input
              ref={searchInputRef}
              aria-label="Search skills"
              placeholder="Search skill name or description..."
              value={search}
              onChange={(event) => updateControls({ search: event.currentTarget.value })}
            />
          </label>
          {hasActiveFilters ? (
            <button className="secondary-action" type="button" onClick={resetFilters}>
              <RotateCcw size={15} strokeWidth={2.2} />
              Reset filters
            </button>
          ) : null}
          <select
            aria-label="Skill source filter"
            value={sourceFilter}
            onChange={(event) =>
              updateControls({ sourceFilter: event.currentTarget.value as typeof sourceFilter })
            }
          >
            <option value="all">Source: All</option>
            <option value="github">GitHub</option>
            <option value="local">Local</option>
          </select>
          <select
            aria-label="Skill target filter"
            value={targetFilter}
            onChange={(event) =>
              updateControls({ targetFilter: event.currentTarget.value as typeof targetFilter })
            }
          >
            <option value="all">Target: All</option>
            <option value="managed">Managed</option>
            <option value="library">Imported</option>
            <option value="unmanaged">Unmanaged</option>
            <option value="ignored">Ignored</option>
            <option value="not-installed">Not installed</option>
          </select>
          <button
            className="secondary-action library-toolbar-action"
            type="button"
            aria-label="Check updates"
            title="Check skill updates"
            disabled={updateCheckStatus?.state === "checking"}
            onClick={onCheckUpdates}
          >
            <RefreshCw size={15} strokeWidth={2.2} />
            <span>{updateCheckStatus?.state === "checking" ? "Checking..." : "Check updates"}</span>
          </button>
          <button
            className="secondary-action library-toolbar-action"
            type="button"
            aria-label="Update all skills"
            title="Update all skills"
            disabled={updateableSkillIds.length === 0}
            onClick={() => onPreviewAllLibrarySkillUpdates(updateableSkillIds)}
          >
            <Sparkles size={15} strokeWidth={2.2} />
            <span>Update all</span>
          </button>
        </div>
      </div>

      <section className="library-table" aria-label="Library skills">
        <div className="library-table__head">
          <span>Skill</span>
          <span>Source</span>
          <span>Version</span>
          <span className="library-column-label">
            Updates
            <InfoTip label="Shows whether this skill tracks its source and whether an update is available." />
          </span>
          <span>Usage</span>
          <span className="library-column-label">
            Installs
            <InfoTip label="Shows whether each Target install matches the Library copy. This is separate from source updates." />
          </span>
          <span>Actions</span>
        </div>
        <div className="library-table__body">
          {isLoading && librarySkills.length === 0 ? (
            <div className="inline-state inline-state--loading library-empty" role="status">
              <span className="inline-state__icon" aria-hidden="true" />
              <span>Loading skills</span>
            </div>
          ) : null}
          {!isLoading && librarySkills.length === 0 ? (
            <p className="muted library-empty">Import a skill from a folder or GitHub to start the library.</p>
          ) : null}
          {librarySkills.length > 0 && filteredSkills.length === 0 ? (
            <p className="muted library-empty">No skills match the current filters.</p>
          ) : null}
          {filteredSkills.map((skill) => {
            const updateInfo = updatesById.get(skill.id);
                const installs = installsFor(skill.id);
                const staleCopies = installs.filter(
                  (install) => install.installMethod === "copied" && install.contentMatchesLibrary === false
                );
            const sourceDraft = sourceDrafts[skill.id] ?? {
              sourceType: skill.sourceType,
              source: skill.source ?? ""
            };
            const hasUpdateSource = Boolean(skill.source);
            const isTracked = skill.updatePolicy === "tracked";
            const updateLabel = !isTracked
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
            const hasUpdate = isTracked && Boolean(updateInfo?.updateAvailable);
            const hasError = isTracked && Boolean(updateInfo?.error);
            const rowAction = hasUpdate
              ? "update"
              : staleCopies.length > 0
                ? "sync"
                : hasError
                  ? "retry"
                  : undefined;
            const usageCount = (skillUsage[skill.id] ?? []).length;
            const revisionLabel = shortRevision(skill);
            const versionLabel = skill.remoteRef ?? revisionLabel;
            const versionDetail = skill.remoteRef
              ? revisionLabel
              : hasUpdateSource
                ? isTracked
                  ? "Tracked source"
                  : "Source retained"
                : "Library revision";
            return (
              <div
                aria-label={`Library item ${skill.id}`}
                className="library-table-row"
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
                    <strong className="skill-title">{skill.name}</strong>
                    <PreviewText className="skill-description" text={skill.description || skill.id} />
                  </div>
                </div>
                <div className="library-source-cell">
                  {skill.sourceType === "github" && /^https?:\/\//i.test(skill.source ?? "") ? (
                    <button
                      className="resource-chip resource-chip--github library-source-open"
                      type="button"
                      aria-label={`Open GitHub source for ${skill.id}`}
                      onClick={() => onOpenSource(skill.source!)}
                    >
                      <GitBranch size={13} strokeWidth={2.2} />
                      <span>GitHub</span>
                      <ExternalLink size={11} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <span className={`resource-chip resource-chip--${skill.sourceType}`}>
                      <Folder size={13} strokeWidth={2.2} />
                      {skill.sourceType === "github" ? "GitHub" : "Local"}
                    </span>
                  )}
                  <PreviewText
                    ariaLabel={`Full source for ${skill.id}`}
                    className="library-source-address"
                    displayText={sourceName(skill)}
                    text={sourceLabel(skill)}
                    tooltipClassName="library-source-tooltip"
                  />
                </div>
                <div className="library-version-cell">
                  <strong>{versionLabel}</strong>
                  <small>{versionDetail}</small>
                </div>
                <div className="library-update-cell">
                  <strong
                    aria-label={hasUpdate ? "Update available" : updateLabel}
                    className={`resource-status${hasUpdate ? " is-warning" : ""}${
                      hasError ? " is-error" : ""
                    }`}
                  >
                    {!isTracked ? (
                      <Link2Off size={13} strokeWidth={2.2} />
                    ) : hasError ? (
                      <TriangleAlert size={13} strokeWidth={2.2} />
                    ) : hasUpdate ? (
                      <Sparkles size={13} strokeWidth={2.2} />
                    ) : !hasUpdateSource ? (
                      <Folder size={13} strokeWidth={2.2} />
                    ) : (
                      <CheckCircle2 size={13} strokeWidth={2.2} />
                    )}
                    <span>{updateLabel}</span>
                  </strong>
                  {updateInfo?.latestRevision ? (
                    <small>
                      {updateInfo.latestRevision.slice(0, 7)} {hasUpdate ? "available" : "current"}
                    </small>
                  ) : null}
                </div>
                <div className="library-usage-cell">
                  <strong className="usage-summary">
                    <Users size={13} strokeWidth={2.2} />
                    {usageCount} {usageCount === 1 ? "profile" : "profiles"}
                  </strong>
                  <small>
                    {(skillUsage[skill.id] ?? []).length > 0
                      ? (skillUsage[skill.id] ?? []).join(", ")
                      : "Not used"}
                  </small>
                </div>
                <div className="library-installs-cell">
                  {installs.length === 0 ? <strong className="library-install-empty">Not installed</strong> : null}
                  {installs.slice(0, 1).map((install) => (
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
                            ? "Live link"
                            : install.contentMatchesLibrary === false
                              ? "Needs sync"
                              : "Synced"
                          : install.status === "library"
                            ? "Imported"
                            : install.status === "ignored"
                              ? "Ignored"
                              : "Unmanaged"}
                      </strong>
                    </span>
                  ))}
                </div>
                <div className="library-actions-cell">
                  {rowAction ? (
                    <button
                      className={`icon-action library-row-update-action${
                        rowAction === "update" || rowAction === "sync" ? " is-update" : " is-error"
                      }`}
                      type="button"
                      aria-label={
                        rowAction === "update"
                          ? `Review update ${skill.id}`
                          : rowAction === "sync"
                            ? `Sync ${staleCopies.length === 1 ? "install" : `${staleCopies.length} installs`} of ${skill.id}`
                            : `Retry update check ${skill.id}`
                      }
                      disabled={updateCheckStatus?.state === "checking"}
                      onClick={(event) => {
                        if (rowAction !== "sync") {
                          modalFallbackFocusRef.current = event.currentTarget;
                        }
                        if (rowAction === "sync") {
                          onSyncSkillInstalls(skill.id);
                        } else {
                          onPreviewLibrarySkillUpdate(skill.id);
                        }
                      }}
                    >
                      {rowAction === "update" ? (
                        <Sparkles size={15} strokeWidth={2.2} />
                      ) : rowAction === "retry" ? (
                        <TriangleAlert size={15} strokeWidth={2.2} />
                      ) : (
                        <RefreshCw size={15} strokeWidth={2.2} />
                      )}
                      <span>{rowAction === "update" ? "Update" : rowAction === "sync" ? "Sync" : "Retry"}</span>
                    </button>
                  ) : null}
                  <div className="row-action-menu">
                    <button
                      className="icon-action"
                      type="button"
                      aria-label={`More actions for ${skill.id}`}
                      aria-expanded={openActionId === skill.id}
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
                          aria-label={`Actions for ${skill.id}`}
                          style={{ left: openAction.left, top: openAction.top }}
                        >
                          {hasUpdateSource && isTracked ? (
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
                              <span>
                                <strong>{hasUpdate ? "Preview update" : "Check update"}</strong>
                                <small>
                                  {hasUpdate
                                    ? "Review changes before updating."
                                    : "Preview changes from the tracked source."}
                                </small>
                              </span>
                            </button>
                          ) : null}
                          <div className="row-action-source">
                            <div className="row-action-source-title">
                              <Settings2 size={14} strokeWidth={2.2} />
                              Update source
                              <InfoTip label="Use a local skill folder or a GitHub tree directory. The library stores the source path, not duplicated skill copies per profile." />
                            </div>
                            <div className="row-action-update-policy">
                              <span>
                                <strong>Track updates</strong>
                                <small>
                                  {isTracked
                                    ? "Include in manual and automatic checks."
                                    : hasUpdateSource
                                      ? "Excluded from all update checks."
                                      : "Add an update source before tracking."}
                                </small>
                              </span>
                              <button
                                aria-checked={isTracked}
                                aria-label={`Track updates for ${skill.id}`}
                                className={`settings-switch${isTracked ? " is-on" : ""}`}
                                disabled={!hasUpdateSource}
                                role="switch"
                                type="button"
                                onClick={() => {
                                  onSetUpdatePolicy({
                                    id: skill.id,
                                    policy: isTracked ? "untracked" : "tracked"
                                  });
                                  setOpenAction(undefined);
                                }}
                              >
                                <span className="settings-switch__track" aria-hidden="true">
                                  <span />
                                </span>
                                <strong>{isTracked ? "On" : "Off"}</strong>
                              </button>
                            </div>
                            <div className="library-source-editor row-action-source-editor">
                              <select
                                aria-label={`Update source type for ${skill.id}`}
                                value={sourceDraft.sourceType}
                                onChange={(event) =>
                                  setSourceDrafts({
                                    ...sourceDrafts,
                                    [skill.id]: {
                                      ...sourceDraft,
                                      sourceType: event.currentTarget.value as SkillSourceType
                                    }
                                  })
                                }
                              >
                                <option value="local">Local folder</option>
                                <option value="github">GitHub directory</option>
                              </select>
                              <input
                                aria-label={`Update source for ${skill.id}`}
                                placeholder={
                                  sourceDraft.sourceType === "github"
                                    ? "https://github.com/owner/repo/tree/main/path/to/skill"
                                    : "/path/to/skill"
                                }
                                value={sourceDraft.source}
                                onChange={(event) =>
                                  setSourceDrafts({
                                    ...sourceDrafts,
                                    [skill.id]: {
                                      ...sourceDraft,
                                      source: event.currentTarget.value
                                    }
                                  })
                                }
                              />
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={!sourceDraft.source.trim()}
                                onClick={() => {
                                  onSetUpdateSource({
                                    id: skill.id,
                                    sourceType: sourceDraft.sourceType,
                                    source: sourceDraft.source.trim()
                                  });
                                  setOpenAction(undefined);
                                }}
                              >
                                Save source
                              </button>
                            </div>
                          </div>
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
                            <span>
                              <strong>Remove from library</strong>
                              <small>Remove the shared library copy only.</small>
                            </span>
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

      {selectedUpdatePlan && selectedUpdatePlan.changes.length > 0 ? (
        <div className="preview-modal-backdrop" onClick={onCloseUpdatePreview}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog skill-update-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Update preview for ${selectedUpdatePlan.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Update {selectedUpdatePlan.name}</div>
                <p className="muted">
                  {selectedUpdatePlan.changes.length} file {selectedUpdatePlan.changes.length === 1 ? "change" : "changes"}
                  {selectedUpdatePlan.latestRevision
                    ? ` · ${(selectedUpdatePlan.currentRevision ?? "current").slice(0, 7)} → ${selectedUpdatePlan.latestRevision.slice(0, 7)}`
                    : ""}
                </p>
              </div>
            </header>
            <div className="update-change-list">
              {selectedUpdatePlan.changes.map((change) => (
                <details key={change.path} open>
                  <summary>{change.path}</summary>
                  <DiffViewer path={change.path} diff={change.diff} />
                </details>
              ))}
            </div>
            <footer className="preview-actions">
              <button ref={modalInitialFocusRef} className="secondary-action" type="button" onClick={onCloseUpdatePreview}>
                Cancel
              </button>
              <button
                className="primary-action"
                type="button"
                aria-label={`Apply update ${selectedUpdatePlan.id}`}
                onClick={() => onUpdateLibrarySkill(selectedUpdatePlan.id)}
              >
                Update skill
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
            aria-label="Delete library skill"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Remove from library</div>
                <p className="muted">
                  {(skillUsage[deleteCandidate.id] ?? []).length > 0
                    ? `${deleteCandidate.name} is used by ${(skillUsage[deleteCandidate.id] ?? []).join(", ")}. Remove it from those profiles first.`
                    : (() => {
                        const installCount = installsFor(deleteCandidate.id).filter(
                          (item) => item.status === "managed"
                        ).length;
                        return installCount > 0
                          ? `Remove ${deleteCandidate.name} and ${installCount} managed target ${installCount === 1 ? "install" : "installs"}? Unmanaged copies are kept.`
                          : `Remove ${deleteCandidate.name} from the shared library?`;
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
                Cancel
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
                  Review profiles
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
                    ? "Remove skill and installs"
                    : "Remove skill"}
                </button>
              )}
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
            aria-label="Review all skill updates"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Review all skill updates</div>
                <p className="muted">Review every tracked change before updating the shared library.</p>
              </div>
            </header>
            <div className="bulk-update-list">
              {bulkUpdatePlans.map((plan) => (
                <details key={plan.id} open={plan.errors.length > 0}>
                  <summary>
                    <strong>{plan.name}</strong>
                    <span>{plan.errors.length > 0 ? "Blocked" : `${plan.changes.length} file changes`}</span>
                  </summary>
                  {plan.errors.map((error) => <p className="error" key={error}>{error}</p>)}
                  {plan.changes.map((change) => <code key={change.path}>{change.path}</code>)}
                </details>
              ))}
            </div>
            <footer className="preview-actions">
              <button ref={modalInitialFocusRef} className="secondary-action" type="button" onClick={onCloseBulkUpdatePreview}>Cancel</button>
              <button
                className="primary-action"
                type="button"
                disabled={bulkUpdatePlans.every((plan) => plan.errors.length > 0 || plan.changes.length === 0)}
                onClick={() => onUpdateAllLibrarySkills(bulkUpdatePlans.filter((plan) => plan.changes.length > 0 && plan.errors.length === 0).map((plan) => plan.id))}
              >
                Apply {bulkUpdatePlans.filter((plan) => plan.changes.length > 0 && plan.errors.length === 0).length} updates
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
            aria-label="Import external skill"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  Import {externalImportGroup.primary?.name ?? externalImport.skillKey}
                </div>
                <p className="muted">
                  Create an independent Library copy. Skills CLI files and lock data stay unchanged.
                </p>
              </div>
            </header>
            <fieldset className="cleanup-review-group external-source-group">
              <legend>Source copy</legend>
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
                    <strong>{cleanupLocationLabel(item)}</strong>
                    <PreviewText
                      ariaLabel={`Full external source path ${item.path}`}
                      className="cleanup-option-path"
                      text={item.path}
                      tooltipClassName="library-source-tooltip"
                    />
                  </span>
                  <em>
                    {item.externalOwnership?.state === "broken-link"
                      ? "Missing"
                      : `Content ${item.contentHash.slice(0, 7)}`}
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
                Cancel
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
                {localImportOperation ? "Importing..." : "Import copy"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {cleanupDraft && cleanupCandidate ? (
        <div className="preview-modal-backdrop" onClick={() => setCleanupDraft(undefined)}>
          <section
            ref={modalDialogRef}
            className="profile-form-dialog cleanup-review-dialog"
            role="dialog"
            aria-label="Review skill cleanup"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Manage {cleanupCandidate.primary?.name ?? cleanupDraft.skillKey}</div>
                <p className="muted">
                  {cleanupUsesExistingLibrary
                    ? "Use the existing Library version and choose which local copies it should manage."
                    : "Choose the local copy to keep in Library, then choose where to install that managed version."}
                </p>
              </div>
            </header>
            <div className="cleanup-review-content">
              {cleanupUsesExistingLibrary ? (
                <div className="cleanup-library-source" role="status">
                  <span className="resource-avatar" aria-hidden="true">
                    <BookOpenText size={16} strokeWidth={2.2} />
                  </span>
                  <span>
                    <strong>Existing Library version</strong>
                    <small>The shared Library copy remains the source of truth.</small>
                  </span>
                </div>
              ) : (
                <fieldset className="cleanup-review-group">
                  <legend>
                    Version to keep in Library
                    <small>Choose the copy whose contents you want to preserve.</small>
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
                          <strong>{cleanupLocationLabel(item)}</strong>
                          <PreviewText
                            ariaLabel={`Full source path ${item.path}`}
                            className="cleanup-option-path"
                            text={item.path}
                            tooltipClassName="library-source-tooltip"
                          />
                          {item.description ? (
                            <PreviewText
                              ariaLabel={`Full description for ${item.path}`}
                              className="cleanup-option-description"
                              text={item.description}
                            />
                          ) : null}
                        </span>
                        <code>Content {item.contentHash.slice(0, 7)}</code>
                      </label>
                    ))}
                </fieldset>
              )}
              <fieldset className="cleanup-review-group">
                <legend>
                  Locations to manage
                  <small>Selected copies are backed up, then replaced by the Library version.</small>
                </legend>
                {cleanupCandidate.items.map((item) => (
                  <label className="cleanup-review-option" key={`location-${item.path}`}>
                    <input
                      type="checkbox"
                      checked={cleanupDraft.selectedPaths.includes(item.path)}
                      disabled={
                        item.status === "managed" ||
                        item.status === "ignored" ||
                        (!cleanupUsesExistingLibrary && cleanupDraft.canonicalPath === item.path)
                      }
                      onChange={() => setCleanupDraft({
                        ...cleanupDraft,
                        selectedPaths: cleanupDraft.selectedPaths.includes(item.path)
                          ? cleanupDraft.selectedPaths.filter((path) => path !== item.path)
                          : cleanupDraft.selectedPaths.concat(item.path)
                      })}
                    />
                    <span>
                      <strong>{cleanupLocationLabel(item)}</strong>
                      <PreviewText
                        ariaLabel={`Full managed path ${item.path}`}
                        className="cleanup-option-path"
                        text={item.path}
                        tooltipClassName="library-source-tooltip"
                      />
                    </span>
                    <em>
                      {item.status === "managed"
                        ? "Already managed"
                        : item.status === "ignored"
                          ? "Ignored"
                          : !cleanupUsesExistingLibrary && cleanupDraft.canonicalPath === item.path
                            ? "Source copy"
                            : "Replace"}
                    </em>
                  </label>
                ))}
              </fieldset>
              <p className="cleanup-safety-note">
                <strong>{cleanupDraft.selectedPaths.length} {cleanupDraft.selectedPaths.length === 1 ? "location" : "locations"}</strong>
                {" "}will use <strong>{cleanupCandidate.primary?.name ?? cleanupDraft.skillKey}</strong> from Library. Originals are backed up first.
              </p>
            </div>
            <footer className="preview-actions">
              <button ref={modalInitialFocusRef} className="secondary-action" type="button" onClick={() => setCleanupDraft(undefined)}>Cancel</button>
              <button
                className="primary-action"
                type="button"
                disabled={cleanupDraft.selectedPaths.length === 0}
                onClick={() => {
                  onConsolidateSkillGroup({
                    skillKey: cleanupDraft.skillKey,
                    libraryId: cleanupDraft.libraryId,
                    canonicalPath: cleanupDraft.canonicalPath,
                    locations: cleanupCandidate.items
                      .filter((item) => cleanupDraft.selectedPaths.includes(item.path))
                      .map((item) => ({ targetId: item.foundIn[0] ?? "", path: item.path }))
                  });
                  setCleanupDraft(undefined);
                }}
              >
                Back up and manage
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {activeTool === "discoveries" ? (
        <section className="library-drawer" aria-label="Environment skills">
          <div className="library-drawer__header">
            <div>
              <strong>
                Local Skill Cleanup
                <InfoTip label="Scans supported local targets for skills that can be imported into the shared library, ignored, or kept outside AgentEnv management." />
              </strong>
            </div>
            <button
              className="icon-action"
              type="button"
              aria-label="Close library tool"
              disabled={Boolean(automaticCleanupKey)}
              onClick={onCloseTool}
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
          <section className="resource-section target-discovery-section">
            <div className="cleanup-section-heading">
              <div>
                <div className="resource-heading">
                  Cleanup groups
                  <InfoTip label="Each group represents one skill found across local agent folders. Safe groups can be managed automatically; content conflicts and external ownership require review." />
                </div>
                <small>
                  {automaticCleanupRequests.length} auto-ready
                  {manualCleanupCount > 0 ? ` · ${manualCleanupCount} need review` : ""}
                </small>
              </div>
              {automaticCleanupRequests.length > 0 ? (
                <button
                  className="primary-action cleanup-auto-action"
                  type="button"
                  aria-label={`Auto-manage ${automaticCleanupRequests.length}`}
                  disabled={Boolean(automaticCleanupKey)}
                  onClick={() => void runAutomaticCleanup("all", automaticCleanupRequests)}
                >
                  <Sparkles
                    className={automaticCleanupKey === "all" ? "is-spinning" : undefined}
                    size={15}
                    strokeWidth={2.2}
                    aria-hidden="true"
                  />
                  {automaticCleanupKey === "all" ? "Managing..." : "Auto-manage"}
                </button>
              ) : null}
            </div>
            <div className="resource-list resource-list--unmanaged">
              {cleanupGroups.length === 0 ? (
                <p className="muted library-empty">
                  No target skills detected. Install skills into a supported target and scan again.
                </p>
              ) : null}
              {cleanupGroups.map((group) => {
                const hasIgnored = group.items.some((skill) => skill.status === "ignored");
                const allIgnored = group.activeItems.length === 0;
                const canIgnore = group.activeItems.some((skill) => skill.status !== "managed");
                const automaticRequest = automaticSkillCleanupRequest(group);
                const chipLabel =
                  group.state === "ignored"
                    ? "Ignored"
                    : group.state === "conflict"
                      ? "Conflict"
                      : group.state === "duplicate"
                        ? "Duplicate"
                        : group.state === "external"
                          ? "External"
                          : group.state === "stale"
                            ? "Out of sync"
                            : group.state === "library"
                              ? "Imported"
                              : group.state === "managed"
                                ? "Managed"
                                : "Unmanaged";
                const actionLabel = group.state === "conflict" ? "Resolve conflict" : "Review";

                return (
                  <div
                    aria-label={`Cleanup group ${group.skillKey}`}
                    className="resource-row cleanup-group-row"
                    key={group.skillKey}
                    role="group"
                  >
                    <div className="cleanup-group-status">
                      <span className={`resource-chip resource-chip--${group.state}`}>
                        {chipLabel}
                      </span>
                      {group.resolution !== "resolved" ? (
                        <span className="cleanup-resolution-detail">
                          <span
                            className={`cleanup-resolution cleanup-resolution--${group.resolution}`}
                          >
                            {group.resolution === "automatic" ? "Auto-ready" : "Review"}
                          </span>
                          <InfoTip label={group.resolutionReason} />
                        </span>
                      ) : null}
                    </div>
                    <div className="resource-row__main">
                      <PreviewText
                        ariaLabel={`Full skill name ${group.skillKey}`}
                        className="cleanup-group-name"
                        text={group.primary?.name ?? group.skillKey}
                      />
                      <PreviewText
                        ariaLabel={`Full cleanup summary ${group.skillKey}`}
                        className="cleanup-group-summary"
                        displayText={`${group.primary?.description || group.skillKey} · ${group.items.length} ${group.items.length === 1 ? "location" : "locations"}`}
                        text={`${group.primary?.description || group.skillKey} · ${group.items.length} ${group.items.length === 1 ? "location" : "locations"}`}
                      />
                      <PreviewText
                        ariaLabel={`Full cleanup locations ${group.skillKey}`}
                        className="cleanup-group-locations"
                        displayText={group.items
                          .map((skill) => `${cleanupLocationLabel(skill)} · ${skill.path}`)
                          .join(" | ")}
                        text={group.items
                          .map((skill) => `${cleanupLocationLabel(skill)} · ${skill.path}`)
                          .join("\n")}
                        tooltipClassName="library-source-tooltip"
                      />
                      {group.state === "external" ? (
                        <span className="cleanup-group-owner">
                          Managed externally by Skills CLI
                        </span>
                      ) : null}
                    </div>
                    <div className="cleanup-group-actions">
                      {automaticRequest ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Auto-manage group ${group.skillKey}`}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => void runAutomaticCleanup(group.skillKey, [automaticRequest])}
                        >
                          {automaticCleanupKey === group.skillKey ? "Managing..." : "Manage"}
                        </button>
                      ) : group.state === "external" && !group.items.some((item) => item.libraryId) ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Import copy ${group.skillKey}`}
                          disabled={Boolean(automaticCleanupKey) || !group.activeItems.some(
                            (item) =>
                              item.status === "external" &&
                              item.externalOwnership?.state !== "broken-link"
                          )}
                          onClick={() => {
                            const source = group.activeItems.find(
                              (item) =>
                                item.status === "external" &&
                                item.externalOwnership?.state !== "broken-link"
                            );
                            if (source) {
                              setExternalImport({
                                skillKey: group.skillKey,
                                sourcePath: source.path
                              });
                            }
                          }}
                        >
                          Import copy
                        </button>
                      ) : group.resolution === "manual" && group.state !== "external" ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`${actionLabel} ${group.skillKey}`}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => openCleanupReview(group)}
                        >
                          {actionLabel}
                        </button>
                      ) : null}
                      {canIgnore && !hasIgnored ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Ignore group ${group.skillKey}`}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => onIgnoreSkillGroup(group.skillKey)}
                        >
                          Ignore
                        </button>
                      ) : null}
                      {hasIgnored ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Unignore group ${group.skillKey}`}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => onUnignoreSkillGroup(group.skillKey)}
                        >
                          {allIgnored ? "Unignore" : "Restore ignored"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <section className="cleanup-history-section" aria-label="Cleanup history">
              <div className="resource-heading">
                Cleanup history
                <InfoTip label="Every cleanup creates a restorable backup. Restoring returns the affected local copies to their state before cleanup." />
              </div>
              {cleanupBackups.length === 0 ? (
                <p className="muted library-empty">No cleanup backups yet.</p>
              ) : (
                <div className="resource-list resource-list--unmanaged cleanup-history-list">
                  {cleanupBackups.map((backup) => (
                    <div className="resource-row cleanup-history-row" key={backup.id}>
                      <span className="resource-chip resource-chip--managed">Backup</span>
                      <div className="resource-row__main">
                        <PreviewText
                          ariaLabel={`Full cleanup history name ${backup.libraryId}`}
                          className="cleanup-history-name"
                          text={backup.libraryId}
                        />
                        <PreviewText
                          ariaLabel={`Full cleanup history details ${backup.libraryId}`}
                          className="cleanup-history-details"
                          displayText={`${backup.operation === "remove" ? "Removal" : "Cleanup"} · ${backup.locationCount} ${backup.locationCount === 1 ? "location" : "locations"} · ${new Date(backup.createdAt).toLocaleString()}`}
                          text={`${backup.operation === "remove" ? "Removal" : "Cleanup"} · ${backup.locationCount} ${backup.locationCount === 1 ? "location" : "locations"} · ${new Date(backup.createdAt).toLocaleString()}`}
                        />
                      </div>
                      <div className="cleanup-group-actions">
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Restore cleanup ${backup.libraryId}`}
                          disabled={Boolean(automaticCleanupKey)}
                          onClick={() => onRestoreCleanup(backup.id)}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          Restore
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
                aria-label="Import skills"
                aria-modal="true"
                tabIndex={-1}
              >
                <div className="library-drawer__header">
                  <strong>Import skills</strong>
                  <button
                    className="icon-action"
                    type="button"
                    aria-label="Close import"
                    disabled={Boolean(githubOperation) || localImportOperation}
                    onClick={onCloseTool}
                  >
                    <X size={16} strokeWidth={2.2} />
                  </button>
                </div>

                {!githubScanResult ? (
                  <div className="library-import-content">
                    <section className="resource-section library-import-panel">
                      <div className="resource-heading">Local folder</div>
                      <div className="library-import-grid">
                        <label>
                          <span>Selected folder</span>
                          <input
                            aria-label="Local skill folder path"
                            placeholder="No folder selected"
                            readOnly
                            value={localSkillPath}
                          />
                        </label>
                        <button
                          className="secondary-action"
                          aria-label="Choose local skill folder"
                          type="button"
                          disabled={localImportOperation || Boolean(githubOperation)}
                          onClick={() => {
                            void selectLocalSkillFolder();
                          }}
                        >
                          Choose folder
                        </button>
                        <button
                          className="primary-action library-import-action"
                          type="button"
                          disabled={
                            !localSkillPath.trim() ||
                            localImportOperation ||
                            Boolean(githubOperation) ||
                            localImportBlocked
                          }
                          onClick={() => void importLocalSkill()}
                        >
                          {localImportOperation ? "Importing..." : localImportLabel}
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
                          <span>{localImportImpact}</span>
                        </div>
                      ) : null}
                    </section>
                    <section className="resource-section library-import-panel">
                      <div className="resource-heading">
                        GitHub
                        <InfoTip label="Paste a skill, directory, or repository URL." />
                      </div>
                      <label className="github-scan-field">
                        <span>GitHub URL</span>
                        <input
                          aria-label="GitHub skill URL"
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
                        <strong>{githubScanResult.candidates.length} found</strong>
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
                        Change
                      </button>
                    </div>
                    {githubScanResult.truncated ? (
                      <div className="inline-state inline-state--warning" role="status">
                        <TriangleAlert size={15} aria-hidden="true" />
                        Results are incomplete. GitHub truncated this repository tree.
                      </div>
                    ) : null}
                    <label className="github-select-all">
                      <input
                        type="checkbox"
                        aria-label="Select all discovered skills"
                        checked={
                          githubScanResult.candidates.some((candidate) => candidate.status === "ready") &&
                          githubScanResult.candidates
                            .filter((candidate) => candidate.status === "ready")
                            .every((candidate) => githubSelectedIds.includes(candidate.id))
                        }
                        onChange={(event) =>
                          setGithubSelectedIds(
                            event.currentTarget.checked
                              ? githubScanResult.candidates
                                  .filter((candidate) => candidate.status === "ready")
                                  .map((candidate) => candidate.id)
                              : []
                          )
                        }
                      />
                      <span>Select all</span>
                      <strong>{githubSelectedIds.length} selected</strong>
                    </label>
                    <div className="github-candidate-list">
                      {githubScanResult.candidates.length === 0 ? (
                        <div className="inline-state">No skills found</div>
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
                              aria-label={`Select ${candidate.name}`}
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
                                ariaLabel={`Full GitHub path ${candidate.id}`}
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
                                aria-label={`Library ID for ${candidate.name}`}
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
                                {candidate.status === "duplicate" ? "Duplicate" : "Imported"}
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
                    Cancel
                  </button>
                  {!githubScanResult ? (
                    <button
                      className="primary-action"
                      type="button"
                      disabled={!githubUrl.trim() || Boolean(githubOperation) || localImportOperation}
                      onClick={() => {
                        void scanGitHub();
                      }}
                    >
                      {githubOperation === "scanning" ? "Scanning..." : "Scan"}
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
                      {githubOperation === "importing" ? "Importing..." : `Import ${githubSelectedIds.length}`}
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
