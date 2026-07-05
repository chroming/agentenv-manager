import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useId,
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
  ManageTargetSkillInput,
  SkillCleanupBackupSummary,
  SkillCleanupRequest,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput
} from "../../shared/types";
import { InfoTip } from "./InfoTip";
import { DiffViewer } from "./DiffViewer";
import {
  type SkillLibraryViewState,
  updateSkillLibraryControls
} from "../libraryViewState";

export type SkillUpdateCheckStatus = {
  state: "checking" | "success" | "error" | "info";
  message: string;
};

interface SkillLibraryPanelProps {
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
  onImportUnmanaged(sourcePath: string): void;
  onImportGitHubSkill(input: GitHubSkillImportInput): void;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onConsolidateSkillGroup(input: SkillCleanupRequest): void;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
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

interface DescriptionTooltipPosition {
  left: number;
  maxWidth: number;
  placement: "top" | "bottom";
  top: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

interface PreviewTextProps {
  ariaLabel?: string;
  className: string;
  displayText?: string;
  text: string;
  tooltipClassName?: string;
}

const PreviewText = ({
  ariaLabel,
  className,
  displayText,
  text,
  tooltipClassName = ""
}: PreviewTextProps) => {
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DescriptionTooltipPosition>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const maxWidth = Math.max(220, Math.min(420, window.innerWidth - 24));
    const measured = tooltipRef.current?.getBoundingClientRect();
    const width = Math.min(measured?.width ?? maxWidth, maxWidth);
    const height = measured?.height ?? 52;
    const gap = 8;
    const margin = 12;
    const preferredTop = triggerRect.bottom + gap;
    const placement =
      preferredTop + height <= window.innerHeight - margin ? "bottom" : "top";
    const unclampedTop =
      placement === "bottom" ? preferredTop : triggerRect.top - height - gap;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    setPosition({
      left: clamp(triggerRect.left, margin, Math.max(margin, window.innerWidth - width - margin)),
      maxWidth,
      placement,
      top: clamp(unclampedTop, margin, maxTop)
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, text, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const tooltipStyle = {
    left: position?.left ?? -9999,
    maxWidth: position?.maxWidth ?? 420,
    top: position?.top ?? -9999
  } as CSSProperties;

  return (
    <>
      <span
        aria-label={ariaLabel}
        aria-describedby={isOpen ? tooltipId : undefined}
        className={className}
        ref={triggerRef}
        tabIndex={0}
        onBlur={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {displayText ?? text}
      </span>
      {isOpen
        ? createPortal(
            <div
              className={`skill-description-tooltip skill-description-tooltip--${position?.placement ?? "bottom"}${tooltipClassName ? ` ${tooltipClassName}` : ""}`}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={tooltipStyle}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export const SkillLibraryPanel = ({
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
  onImportGitHubSkill,
  onManageTargetSkill,
  onConsolidateSkillGroup,
  onSetUpdateSource,
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
  const [githubId, setGithubId] = useState("");
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
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { sourceType: SkillSourceType; source: string }>
  >({});
  const modalDialogRef = useRef<HTMLElement>(null);
  const modalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const modalFallbackFocusRef = useRef<HTMLElement>(null);
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const updateableSkillIds = skillUpdates
    .filter((update) => update.updateAvailable && !update.error)
    .map((update) => update.id);
  const availableUpdateCount = updateableSkillIds.length;
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
      if (openActionId) {
        setOpenAction(undefined);
        return;
      }
      if (activeTool) {
        onCloseTool?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, onCloseTool, openActionId]);

  const dismissModal = () => {
    if (selectedUpdatePlan) {
      onCloseUpdatePreview();
    } else if (deleteCandidate) {
      setDeleteCandidate(undefined);
    } else if (bulkUpdatePlans) {
      onCloseBulkUpdatePreview();
    } else {
      setCleanupDraft(undefined);
    }
  };
  const modalOpen = Boolean(
    (selectedUpdatePlan && selectedUpdatePlan.changes.length > 0) ||
      deleteCandidate ||
      bulkUpdatePlans ||
      cleanupDraft
  );
  useModalDialog({
    open: modalOpen,
    dialogRef: modalDialogRef,
    initialFocusRef: modalInitialFocusRef,
    fallbackFocusRef: modalFallbackFocusRef,
    onDismiss: dismissModal
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
      if (activeTool && !target.closest(".library-drawer")) {
        onCloseTool?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeTool, onCloseTool, openActionId]);

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
  const cleanupGroups = useMemo(() => {
    const byKey = new Map<string, SkillInventoryEntry[]>();
    for (const skill of skillInventory) {
      const key = skill.skillKey ?? skill.id;
      byKey.set(key, [...(byKey.get(key) ?? []), skill]);
    }

    return [...byKey.entries()]
      .map(([skillKey, items]) => {
        const hashes = new Set(items.map((item) => item.contentHash).filter(Boolean));
        const statuses = new Set(items.map((item) => item.status));
        const state = statuses.has("ignored")
          ? "ignored"
          : hashes.size > 1
            ? "conflict"
            : items.length > 1
              ? "duplicate"
              : statuses.has("unmanaged")
                ? "unmanaged"
                : statuses.has("library")
                  ? "library"
                  : "managed";
        return {
          skillKey,
          items,
          state,
          primary: items[0]
        };
      })
      .sort((a, b) => (a.primary?.name ?? a.skillKey).localeCompare(b.primary?.name ?? b.skillKey));
  }, [skillInventory]);
  const cleanupCandidate = cleanupDraft
    ? cleanupGroups.find((group) => group.skillKey === cleanupDraft.skillKey)
    : undefined;

  const openCleanupReview = (group: (typeof cleanupGroups)[number]) => {
    const canonical = group.items.find((item) => item.status === "library") ?? group.items[0];
    const libraryId = group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey;
    setCleanupDraft({
      skillKey: group.skillKey,
      libraryId,
      canonicalPath: canonical.path,
      selectedPaths: group.items
        .filter((item) => item.status !== "managed" && item.status !== "ignored")
        .map((item) => item.path)
    });
  };

  const importGitHubSkill = () => {
    const url = githubUrl.trim();
    if (!url) {
      return;
    }
    onImportGitHubSkill({
      url,
      id: githubId.trim() || undefined
    });
    setGithubUrl("");
    setGithubId("");
  };

  const importLocalSkill = () => {
    const sourcePath = localSkillPath.trim();
    if (!sourcePath) {
      return;
    }
    onImportUnmanaged(sourcePath);
    setLocalSkillPath("");
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
            Source status
            <InfoTip label="Compares the Library copy with its tracked local or GitHub source." />
          </span>
          <span>Usage</span>
          <span className="library-column-label">
            Installs
            <InfoTip label="Shows whether each Target install matches the Library copy. This is separate from source updates." />
          </span>
          <span>Actions</span>
        </div>
        <div className="library-table__body">
          {librarySkills.length === 0 ? (
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
            const updateLabel = updateInfo?.error
              ? "Check failed"
              : updateInfo?.updateAvailable
                ? "Update available"
                : updateInfo
                  ? "Source current"
                  : hasUpdateSource
                    ? "Not checked"
                    : "Library only";
            const hasUpdate = Boolean(updateInfo?.updateAvailable);
            const hasError = Boolean(updateInfo?.error);
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
                ? "Tracked source"
                : "Library revision";
            return (
              <div
                aria-label={`Library item ${skill.id}`}
                className="library-table-row"
                key={skill.id}
                role="group"
              >
                <div className="library-resource-cell">
                  <span className="resource-avatar" aria-hidden="true">
                    <BookOpenText size={18} strokeWidth={2.2} />
                  </span>
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
                    className={`resource-status${hasUpdate ? " is-warning" : ""}${
                      hasError ? " is-error" : ""
                    }`}
                  >
                    {hasError ? (
                      <TriangleAlert size={13} strokeWidth={2.2} />
                    ) : hasUpdate ? (
                      <Sparkles size={13} strokeWidth={2.2} />
                    ) : !hasUpdateSource ? (
                      <Folder size={13} strokeWidth={2.2} />
                    ) : (
                      <CheckCircle2 size={13} strokeWidth={2.2} />
                    )}
                    {updateLabel}
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
                  {installs.length === 0 ? <small>Not installed</small> : null}
                  {installs.slice(0, 1).map((install) => (
                    <span className="library-install-entry" key={install.path}>
                      <span title={install.foundIn.map(targetName).join(", ")}>
                        {install.foundIn.map(targetName).join(", ")}
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
                  {installs.length > 1 ? <small>+{installs.length - 1} more installs</small> : null}
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
                          {hasUpdateSource ? (
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
                <div className="section-title">Review {cleanupCandidate.primary?.name ?? cleanupDraft.skillKey}</div>
                <p className="muted">Choose the canonical copy, then select each location AgentEnv should replace with the managed library version.</p>
              </div>
            </header>
            <div className="cleanup-review-content">
              <fieldset className="cleanup-review-group">
                <legend>Canonical copy</legend>
                {cleanupCandidate.items.map((item) => (
                  <label className="cleanup-review-option" key={`canonical-${item.path}`}>
                    <input
                      type="radio"
                      name="canonical-skill-copy"
                      checked={cleanupDraft.canonicalPath === item.path}
                      onChange={() => setCleanupDraft({ ...cleanupDraft, canonicalPath: item.path })}
                    />
                    <span><strong>{item.foundIn.join(", ")}</strong><small>{item.path}</small></span>
                    <code>{item.contentHash.slice(0, 7)}</code>
                  </label>
                ))}
              </fieldset>
              <fieldset className="cleanup-review-group">
                <legend>Locations to manage</legend>
                {cleanupCandidate.items.map((item) => (
                  <label className="cleanup-review-option" key={`location-${item.path}`}>
                    <input
                      type="checkbox"
                      checked={cleanupDraft.selectedPaths.includes(item.path)}
                      disabled={item.status === "managed"}
                      onChange={() => setCleanupDraft({
                        ...cleanupDraft,
                        selectedPaths: cleanupDraft.selectedPaths.includes(item.path)
                          ? cleanupDraft.selectedPaths.filter((path) => path !== item.path)
                          : cleanupDraft.selectedPaths.concat(item.path)
                      })}
                    />
                    <span><strong>{item.foundIn.join(", ")}</strong><small>{item.path}</small></span>
                    <em>{item.status === "managed" ? "Already managed" : "Replace"}</em>
                  </label>
                ))}
              </fieldset>
              <p className="cleanup-safety-note">A backup is created before any selected location is changed. It remains available in Cleanup history.</p>
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
                Back up and clean up
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
            <button className="icon-action" type="button" aria-label="Close library tool" onClick={onCloseTool}>
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
          <section className="resource-section target-discovery-section">
            <div>
            <div className="resource-heading">Cleanup groups</div>
            </div>
            <div className="resource-list resource-list--unmanaged">
              {cleanupGroups.length === 0 ? (
                <p className="muted library-empty">
                  No target skills detected. Install skills into a supported target and scan again.
                </p>
              ) : null}
              {cleanupGroups.map((group) => {
                const isIgnored = group.items.some((skill) => skill.status === "ignored");
                const canIgnore = isIgnored || group.items.some((skill) => skill.status !== "managed");
                const chipLabel =
                  group.state === "ignored"
                    ? "Ignored"
                    : group.state === "conflict"
                      ? "Conflict"
                      : group.state === "duplicate"
                        ? "Duplicate"
                        : group.state === "library"
                          ? "Imported"
                          : group.state === "managed"
                            ? "Managed"
                            : "Unmanaged";

                return (
                  <div
                    aria-label={`Cleanup group ${group.skillKey}`}
                    className="resource-row cleanup-group-row"
                    key={group.skillKey}
                    role="group"
                  >
                    <span className={`resource-chip resource-chip--${group.state}`}>
                      {chipLabel}
                    </span>
                    <div className="resource-row__main">
                      <span>{group.primary?.name ?? group.skillKey}</span>
                      <small>
                        {group.primary?.description || group.skillKey} · {group.items.length}{" "}
                        {group.items.length === 1 ? "location" : "locations"}
                      </small>
                      <small title={group.items.map((skill) => skill.path).join("\n")}>
                        {group.items
                          .map((skill) => `${skill.foundIn.join(", ")} · ${skill.path}`)
                          .join(" | ")}
                      </small>
                    </div>
                    <div className="cleanup-group-actions">
                      {group.state !== "managed" && group.state !== "ignored" ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Review cleanup ${group.skillKey}`}
                          onClick={() => openCleanupReview(group)}
                        >
                          Review cleanup
                        </button>
                      ) : null}
                      {canIgnore ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Ignore group ${group.skillKey}`}
                          onClick={() => onIgnoreSkillGroup(group.skillKey)}
                        >
                          Ignore
                        </button>
                      ) : null}
                      {isIgnored ? (
                        <button
                          className="secondary-action"
                          type="button"
                          aria-label={`Unignore group ${group.skillKey}`}
                          onClick={() => onUnignoreSkillGroup(group.skillKey)}
                        >
                          Unignore
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="resource-section cleanup-history-section" aria-label="Cleanup history">
            <div className="resource-heading">Cleanup history</div>
            {cleanupBackups.length === 0 ? (
              <p className="muted library-empty">No cleanup backups yet.</p>
            ) : (
              <div className="cleanup-history-list">
                {cleanupBackups.map((backup) => (
                  <div className="cleanup-history-row" key={backup.id}>
                    <span>
                      <strong>{backup.libraryId}</strong>
                      <small>
                        {backup.operation === "remove" ? "Removal" : "Cleanup"} · {backup.locationCount} locations · {new Date(backup.createdAt).toLocaleString()}
                      </small>
                    </span>
                    <button
                      className="secondary-action"
                      type="button"
                      aria-label={`Restore cleanup ${backup.libraryId}`}
                      onClick={() => onRestoreCleanup(backup.id)}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}

      {activeTool === "import" ? (
        <section className="library-drawer" aria-label="GitHub skill import">
          <div className="library-drawer__header">
            <div>
              <strong>
                Import Skill
                <InfoTip label="Add one shared skill to the library from a local folder, or track a public GitHub skill directory for future updates." />
              </strong>
            </div>
            <button className="icon-action" type="button" aria-label="Close library tool" onClick={onCloseTool}>
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
          <section className="resource-section library-import-panel">
            <div>
              <div className="resource-heading">
                Import from local folder
                <InfoTip label="Choose an existing skill folder that contains a SKILL.md file." />
              </div>
            </div>
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
                onClick={() => {
                  void selectLocalSkillFolder();
                }}
              >
                Choose folder
              </button>
              <button
                className="primary-action library-import-action"
                type="button"
                disabled={!localSkillPath.trim()}
                onClick={importLocalSkill}
              >
                Import local skill
              </button>
            </div>
          </section>
      <section className="resource-section library-import-panel">
        <div>
          <div className="resource-heading">
            Import from GitHub directory
            <InfoTip label="Paste a public GitHub tree URL. AgentEnv tracks the directory revision for future updates." />
          </div>
        </div>
        <div className="library-import-grid">
          <label>
            <span>GitHub URL</span>
            <input
              aria-label="GitHub skill URL"
              placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Library ID</span>
            <input
              aria-label="GitHub skill library id"
              placeholder="Optional"
              value={githubId}
              onChange={(event) => setGithubId(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-action library-import-action"
            type="button"
            disabled={!githubUrl.trim()}
            onClick={importGitHubSkill}
          >
            Import from GitHub
          </button>
        </div>
      </section>
        </section>
      ) : null}
    </section>
  );
};
