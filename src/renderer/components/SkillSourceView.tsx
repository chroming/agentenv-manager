import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  EyeOff,
  ExternalLink,
  GitMerge,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  SearchCheck,
  Trash2,
  X
} from "lucide-react";
import type {
  SkillSourceGroupCandidate,
  SkillSourceGroupView,
  SkillSourceCandidateIgnoreInput,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult
} from "../../shared/types";
import { useI18n } from "../i18n";
import type {
  SkillSourceKindFilter,
  SkillSourceResultFilter,
  SkillSourceScopeFilter
} from "../libraryViewState";
import type { SkillUpdateActivity } from "../skillUpdateActivity";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import {
  ActionMenu,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DisclosureIcon,
  IconButton,
  InteractiveStatus,
  statusToneFor,
  ModalFrame
} from "./ui";

interface SkillSourceViewProps {
  active: boolean;
  updateActivity?: SkillUpdateActivity;
  groups: SkillSourceGroupView[];
  loading: boolean;
  scopeFilter?: SkillSourceScopeFilter;
  sourceKindFilter?: SkillSourceKindFilter;
  resultFilter?: SkillSourceResultFilter;
  onSourceKindFilterChange?(filter: SkillSourceKindFilter): void;
  onResultFilterChange?(filter: SkillSourceResultFilter): void;
  onCheckGroup(sourceId: string): Promise<void>;
  onCheckMonitored(): Promise<void>;
  onRename(input: SkillSourceNameInput): Promise<void>;
  onSetMonitored?(sourceId: string, enabled: boolean): Promise<void>;
  onSetCandidateIgnored?(input: SkillSourceCandidateIgnoreInput): Promise<void>;
  onPreviewMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  onMerge(previewId: string): Promise<SkillSourceMergeResult>;
  onAdd(group: SkillSourceGroupView, candidate: SkillSourceGroupCandidate): Promise<boolean>;
  onUpdate(libraryId: string): Promise<void>;
  onReviewUpdates(libraryIds: string[]): Promise<void>;
  onDelete(libraryId: string): void;
  onOpenSource(url: string): void;
  onCopySource(source: string): void;
}

const stateLabel = (state: SkillSourceGroupCandidate["state"]) => {
  if (state === "current") return "Current";
  if (state === "update") return "Update available";
  if (state === "new") return "New";
  if (state === "ignored") return "Ignored";
  if (state === "removed") return "Removed upstream";
  if (state === "invalid") return "Invalid upstream";
  if (state === "conflict") return "Relationship conflict";
  if (state === "missing") return "Library copy missing";
  return "Not checked";
};

const sourceIsOpenable = (source: string) => /^https?:\/\//i.test(source);

const sourceRepositoryLabel = (repository: string) => {
  try {
    const url = new URL(repository);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (!path) return url.hostname;
    return url.hostname === "github.com" ? path : `${url.hostname}/${path}`;
  } catch {
    const scpPath = repository.includes(":") ? repository.slice(repository.indexOf(":") + 1) : repository;
    const segments = scpPath.replace(/\.git$/i, "").split(/[\\/]/).filter(Boolean);
    return segments.slice(-2).join("/") || repository;
  }
};

const sourceScopeLabel = (group: SkillSourceGroupView) =>
  group.sourceKind === "local" ? "Local folder" : `${group.ref} · /${group.directory || "."}`;

const sourceDefaultLabel = (group: SkillSourceGroupView) => {
  const repository = sourceRepositoryLabel(group.repository);
  const directory = group.directory.replace(/^\/+|\/+$/g, "");
  return directory ? `${repository} · /${directory}` : repository;
};

const sourceDirectoryLeaf = (group: SkillSourceGroupView) =>
  group.directory.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).at(-1);

const mergeErrorSummary = (message: string) => {
  if (/repository access failed|authentication failed|permission denied|publickey|host key verification/i.test(message)) {
    return "Could not access this repository. Check your Git credentials or SSH key.";
  }
  return "Could not check the merged source.";
};

export const SkillSourceView = ({
  active,
  updateActivity,
  groups,
  loading,
  scopeFilter = "monitored",
  sourceKindFilter = "all",
  resultFilter = "all",
  onSourceKindFilterChange = () => undefined,
  onResultFilterChange = () => undefined,
  onCheckGroup,
  onCheckMonitored,
  onRename,
  onSetMonitored,
  onSetCandidateIgnored,
  onPreviewMerge,
  onMerge,
  onAdd,
  onUpdate,
  onReviewUpdates,
  onDelete,
  onOpenSource,
  onCopySource
}: SkillSourceViewProps) => {
  const { formatDate, t } = useI18n();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [operation, setOperation] = useState<string>();
  const [monitoringOperation, setMonitoringOperation] = useState<string>();
  const [mergeSelectionMode, setMergeSelectionMode] = useState(false);
  const [selectionDragging, setSelectionDragging] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [mergeDirectory, setMergeDirectory] = useState<string>();
  const [mergePreview, setMergePreview] = useState<SkillSourceMergePreview>();
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const [renameSource, setRenameSource] = useState<SkillSourceGroupView>();
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string>();
  const [sourceMenu, setSourceMenu] = useState<{
    sourceId: string;
    style: CSSProperties;
  }>();
  const mergeDialogRef = useRef<HTMLElement>(null);
  const renameDialogRef = useRef<HTMLElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const sourceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const selectionDragRef = useRef<{ selected: boolean; visited: Set<string> } | undefined>(undefined);
  const suppressSelectionClickRef = useRef(false);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const activeCheckingAll = checkingAll || updateActivity?.kind === "check-sources";
  const activeCheckingSourceId =
    updateActivity?.kind === "check-source" ? updateActivity.sourceId : undefined;
  const monitoredSourceCount = groups.filter(
    (group) => group.automaticChecks !== false
  ).length;
  const activeFilterCount = [sourceKindFilter, resultFilter].filter(
    (filter) => filter !== "all"
  ).length;
  const visibleGroups = useMemo(() => {
    return groups.filter((group) => {
      const isMonitored = group.automaticChecks !== false;
      const matchesScope =
        scopeFilter === "all" ||
        (scopeFilter === "monitored" ? isMonitored : !isMonitored);
      const matchesKind =
        sourceKindFilter === "all" ||
        (sourceKindFilter === "local"
          ? group.sourceKind === "local"
          : group.sourceKind !== "local");
      const changes =
        group.counts.updates + group.counts.new + group.counts.removed;
      const matchesResult =
        resultFilter === "all" ||
        (resultFilter === "changes" && changes > 0) ||
        (resultFilter === "failed" &&
          (Boolean(group.error) || group.observationState === "error")) ||
        (resultFilter === "not-checked" && !group.checkedAt && !group.error);
      const matchesSearch =
        !normalizedSearch ||
        group.displayName?.toLocaleLowerCase().includes(normalizedSearch) ||
        group.canonicalLink.toLocaleLowerCase().includes(normalizedSearch) ||
        group.candidates.some((candidate) =>
          candidate.name.toLocaleLowerCase().includes(normalizedSearch) ||
          candidate.libraryName?.toLocaleLowerCase().includes(normalizedSearch)
        );
      return matchesScope && matchesKind && matchesResult && matchesSearch;
    });
  }, [
    groups,
    normalizedSearch,
    resultFilter,
    scopeFilter,
    sourceKindFilter
  ]);

  const selectedMergeGroups = useMemo(
    () => groups.filter((group) => mergeSelection.has(group.sourceId)),
    [groups, mergeSelection]
  );
  const mergeIsLocal = selectedMergeGroups.length > 0 && selectedMergeGroups.every(
    (group) => group.sourceKind === "local"
  );
  const computedMergeDirectory = useMemo(() => {
    if (selectedMergeGroups.length < 2) return "";
    const paths = selectedMergeGroups.map((group) =>
      (mergeIsLocal ? group.repository : group.directory).split("/").filter(Boolean)
    );
    const common: string[] = [];
    for (let index = 0; index < Math.min(...paths.map((path) => path.length)); index += 1) {
      const segment = paths[0]![index];
      if (!paths.every((path) => path[index] === segment)) break;
      common.push(segment!);
    }
    return `${mergeIsLocal ? "/" : ""}${common.join("/")}`;
  }, [mergeIsLocal, selectedMergeGroups]);
  const activeMergeDirectory = mergeDirectory ?? computedMergeDirectory;
  const mergePreviewIsCurrent = mergeIsLocal
    ? mergePreview?.mergedSource.repository === activeMergeDirectory
    : mergePreview?.mergedSource.directory === activeMergeDirectory;
  const visibleSourceIds = useMemo(
    () => new Set(visibleGroups.map((group) => group.sourceId)),
    [visibleGroups]
  );
  const canMergeSources = visibleGroups.length >= 2;

  const exitMergeSelection = () => {
    setMergeSelectionMode(false);
    setMergeSelection(new Set());
    setSelectionDragging(false);
    selectionDragRef.current = undefined;
  };

  useEffect(() => {
    if (!selectionDragging) return;
    const finishSelectionDrag = () => {
      selectionDragRef.current = undefined;
      setSelectionDragging(false);
      window.setTimeout(() => {
        suppressSelectionClickRef.current = false;
      }, 0);
    };
    window.addEventListener("pointerup", finishSelectionDrag, { once: true });
    window.addEventListener("pointercancel", finishSelectionDrag, { once: true });
    return () => {
      window.removeEventListener("pointerup", finishSelectionDrag);
      window.removeEventListener("pointercancel", finishSelectionDrag);
    };
  }, [selectionDragging]);

  useEffect(() => {
    if (!filtersOpen) return;
    const dismissFilters = (event: PointerEvent) => {
      const target = event.target as Node;
      if (filterPanelRef.current?.contains(target) || filterTriggerRef.current?.contains(target)) {
        return;
      }
      setFiltersOpen(false);
    };
    const dismissFiltersOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFiltersOpen(false);
      filterTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissFilters);
    document.addEventListener("keydown", dismissFiltersOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissFilters);
      document.removeEventListener("keydown", dismissFiltersOnEscape);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (!sourceMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !sourceMenuRef.current?.contains(event.target) &&
        !sourceMenuTriggerRef.current?.contains(event.target)
      ) {
        setSourceMenu(undefined);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSourceMenu(undefined);
      sourceMenuTriggerRef.current?.focus();
    };
    const dismissForViewportChange = () => setSourceMenu(undefined);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [sourceMenu]);

  useEffect(() => {
    if (!mergeSelectionMode || mergeOpen || renameSource) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      exitMergeSelection();
    };
    document.addEventListener("keydown", exitOnEscape);
    return () => document.removeEventListener("keydown", exitOnEscape);
  }, [mergeOpen, mergeSelectionMode, renameSource]);

  useEffect(() => {
    if (!canMergeSources && mergeSelectionMode) exitMergeSelection();
  }, [canMergeSources, mergeSelectionMode]);

  useEffect(() => {
    setMergeSelection((current) => {
      const next = new Set([...current].filter((sourceId) => visibleSourceIds.has(sourceId)));
      return next.size === current.size ? current : next;
    });
  }, [visibleSourceIds]);

  const setSourceSelected = (sourceId: string, selected: boolean) => {
    setMergeSelection((current) => {
      const next = new Set(current);
      if (selected) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  };

  const extendSelectionDrag = (sourceId: string) => {
    const drag = selectionDragRef.current;
    if (!drag || drag.visited.has(sourceId)) return;
    drag.visited.add(sourceId);
    setSourceSelected(sourceId, drag.selected);
  };

  const beginSelectionDrag = (
    event: ReactPointerEvent<HTMLLabelElement>,
    sourceId: string,
    selected: boolean
  ) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    suppressSelectionClickRef.current = true;
    selectionDragRef.current = { selected: !selected, visited: new Set() };
    setSelectionDragging(true);
    extendSelectionDrag(sourceId);
  };

  const scrollSelectionList = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionDragRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = 36;
    if (event.clientY < bounds.top + edge) event.currentTarget.scrollBy({ top: -18 });
    else if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollBy({ top: 18 });
  };

  const closeMerge = (force = false, clearSelection = false) => {
    if (mergeBusy && !force) return;
    setMergeOpen(false);
    if (clearSelection) exitMergeSelection();
    setMergeDirectory(undefined);
    setMergePreview(undefined);
    setMergeError(undefined);
  };

  useModalDialog({
    open: mergeOpen,
    dialogRef: mergeDialogRef,
    dismissDisabled: mergeBusy,
    onDismiss: closeMerge,
    focusKey: mergePreview?.id ?? "merge-source"
  });

  const closeRename = () => {
    if (renameBusy) return;
    setRenameSource(undefined);
    setRenameValue("");
    setRenameError(undefined);
  };

  useModalDialog({
    open: Boolean(renameSource),
    dialogRef: renameDialogRef,
    dismissDisabled: renameBusy,
    onDismiss: closeRename,
    focusKey: renameSource?.sourceId ?? "rename-source"
  });

  const openRename = (group: SkillSourceGroupView) => {
    setSourceMenu(undefined);
    setRenameSource(group);
    setRenameValue(group.displayName ?? "");
    setRenameError(undefined);
  };

  const confirmRename = async () => {
    if (!renameSource) return;
    setRenameBusy(true);
    setRenameError(undefined);
    try {
      await onRename({
        sourceId: renameSource.sourceId,
        name: renameValue.trim() || undefined
      });
      setRenameSource(undefined);
      setRenameValue("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameBusy(false);
    }
  };

  const runCheck = async (sourceId: string) => {
    setSourceMenu(undefined);
    setChecking((current) => new Set(current).add(sourceId));
    try {
      await onCheckGroup(sourceId);
    } finally {
      setChecking((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const toggleMonitoring = async (group: SkillSourceGroupView) => {
    if (!onSetMonitored) return;
    setSourceMenu(undefined);
    setMonitoringOperation(group.sourceId);
    try {
      await onSetMonitored(group.sourceId, group.automaticChecks === false);
    } finally {
      setMonitoringOperation(undefined);
    }
  };

  const toggleSourceMenu = (sourceId: string, trigger: HTMLButtonElement) => {
    if (sourceMenu?.sourceId === sourceId) {
      setSourceMenu(undefined);
      return;
    }
    sourceMenuTriggerRef.current = trigger;
    const bounds = trigger.getBoundingClientRect();
    const width = 220;
    const height = 116;
    setSourceMenu({
      sourceId,
      style: {
        left: Math.max(10, Math.min(bounds.right - width, window.innerWidth - width - 10)),
        top: bounds.bottom + height + 8 <= window.innerHeight
          ? bounds.bottom + 6
          : Math.max(10, bounds.top - height - 6)
      }
    });
  };

  const previewMerge = async (directory: string) => {
    setMergeBusy(true);
    setMergeError(undefined);
    try {
      const preview = await onPreviewMerge({
        sourceIds: [...mergeSelection],
        ...(mergeIsLocal ? { rootPath: directory } : { directory })
      });
      setMergeDirectory(mergeIsLocal ? preview.mergedSource.repository : preview.mergedSource.directory);
      setMergePreview(preview);
      return preview;
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setMergeBusy(false);
    }
  };

  const openMerge = () => {
    const directory = computedMergeDirectory;
    setMergeDirectory(directory);
    setMergePreview(undefined);
    setMergeError(undefined);
    setMergeOpen(true);
    void previewMerge(directory);
  };

  const confirmMerge = async () => {
    const directory = mergeDirectory ?? computedMergeDirectory;
    setMergeBusy(true);
    setMergeError(undefined);
    try {
      const currentPreview = (mergeIsLocal
        ? mergePreview?.mergedSource.repository
        : mergePreview?.mergedSource.directory) === directory
        ? mergePreview
          : await onPreviewMerge({
            sourceIds: [...mergeSelection],
            ...(mergeIsLocal ? { rootPath: directory } : { directory })
          });
      if (!currentPreview) throw new Error("Skill source merge preview is unavailable");
      setMergeDirectory(mergeIsLocal
        ? currentPreview.mergedSource.repository
        : currentPreview.mergedSource.directory);
      setMergePreview(currentPreview);
      if (currentPreview.blockers.length > 0) return;
      await onMerge(currentPreview.id);
      closeMerge(true, true);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
    } finally {
      setMergeBusy(false);
    }
  };

  const runCheckMonitored = async () => {
    setCheckingAll(true);
    try {
      await onCheckMonitored();
    } finally {
      setCheckingAll(false);
    }
  };

  const runAdd = async (group: SkillSourceGroupView, candidate: SkillSourceGroupCandidate) => {
    const key = `add\0${group.canonicalLink}\0${candidate.sourceSubpath}`;
    setOperation(key);
    try {
      await onAdd(group, candidate);
    } finally {
      setOperation(undefined);
    }
  };

  const setCandidateIgnored = async (
    group: SkillSourceGroupView,
    candidate: SkillSourceGroupCandidate,
    ignored: boolean
  ) => {
    if (!onSetCandidateIgnored) return;
    const key = `${ignored ? "ignore" : "unignore"}\0${group.sourceId}\0${candidate.sourceSubpath}`;
    setOperation(key);
    try {
      await onSetCandidateIgnored({
        sourceId: group.sourceId,
        sourceSubpath: candidate.sourceSubpath,
        ignored
      });
    } finally {
      setOperation(undefined);
    }
  };

  const runUpdate = async (libraryId: string) => {
    const key = `update\0${libraryId}`;
    setOperation(key);
    try {
      await onUpdate(libraryId);
    } finally {
      setOperation(undefined);
    }
  };

  const runReviewUpdates = async (libraryIds: string[]) => {
    const key = `review\0${libraryIds.join("\0")}`;
    setOperation(key);
    try {
      await onReviewUpdates(libraryIds);
    } finally {
      setOperation(undefined);
    }
  };

  const toggleExpanded = (sourceId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  return (
    <section
      className={`skill-source-view${active ? "" : " is-inactive"}`}
      aria-label={t("Skills by source")}
      aria-hidden={!active}
    >
      <div className={`skill-source-toolbar${mergeSelectionMode ? " is-merge-selection" : ""}`}>
        <label className="library-search ui-composite-field">
          <span>{t("Search")}</span>
          <Search size={16} strokeWidth={2.1} aria-hidden="true" />
          <input
            aria-label={t("Search sources and skills")}
            placeholder={t("Search source or skill...")}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <Button
          aria-expanded={filtersOpen}
          className={`library-filter-trigger${activeFilterCount > 0 ? " has-filters" : ""}`}
          icon={<ListFilter size={15} strokeWidth={2.2} />}
          ref={filterTriggerRef}
          onClick={() => setFiltersOpen((current) => !current)}
        >
          {t("Filters")}
          {activeFilterCount > 0 ? (
            <strong aria-label={t("{{count}} active filters", { count: activeFilterCount })}>
              {activeFilterCount}
            </strong>
          ) : null}
        </Button>
        <Button
          aria-label={t("Check updates")}
          busy={activeCheckingAll}
          busyLabel={t("Checking...")}
          className="library-toolbar-action"
          icon={<SearchCheck size={15} strokeWidth={2.2} />}
          title={t("Check updates")}
          disabled={activeCheckingAll || checking.size > 0 || Boolean(activeCheckingSourceId) || Boolean(operation) || monitoredSourceCount === 0}
          onClick={() => void runCheckMonitored()}
        >
          {t("Check updates")}
        </Button>
        {canMergeSources ? (
          <Button
            icon={<GitMerge size={15} strokeWidth={2.2} />}
            disabled={(mergeSelectionMode && mergeSelection.size < 2) || activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
            onClick={() => mergeSelectionMode ? openMerge() : setMergeSelectionMode(true)}
          >
            {mergeSelectionMode
              ? `${t("Merge selected")} (${mergeSelection.size})`
              : t("Merge")}
          </Button>
        ) : null}
        {mergeSelectionMode ? (
          <IconButton
            className="skill-source-exit-selection"
            label={t("Exit merge selection")}
            onClick={exitMergeSelection}
            size="default"
            variant="ghost"
          >
            <X />
          </IconButton>
        ) : null}
        {filtersOpen ? (
          <div
            className="library-filter-panel skill-source-filter-panel"
            ref={filterPanelRef}
            role="group"
            aria-label={t("Source filters")}
          >
            <label>
              <span>{t("Type")}</span>
              <select
                aria-label={t("Source type filter")}
                value={sourceKindFilter}
                onChange={(event) =>
                  onSourceKindFilterChange(
                    event.currentTarget.value as SkillSourceKindFilter
                  )}
              >
                <option value="all">{t("All types")}</option>
                <option value="online">{t("Online")}</option>
                <option value="local">{t("Local")}</option>
              </select>
            </label>
            <label>
              <span>{t("Result")}</span>
              <select
                aria-label={t("Source result filter")}
                value={resultFilter}
                onChange={(event) =>
                  onResultFilterChange(
                    event.currentTarget.value as SkillSourceResultFilter
                  )}
              >
                <option value="all">{t("All results")}</option>
                <option value="changes">{t("Changes")}</option>
                <option value="failed">{t("Failed")}</option>
                <option value="not-checked">{t("Not checked")}</option>
              </select>
            </label>
            <Button
              className="library-filter-reset"
              icon={<RotateCcw size={15} strokeWidth={2.2} />}
              disabled={activeFilterCount === 0}
              onClick={() => {
                onSourceKindFilterChange("all");
                onResultFilterChange("all");
              }}
            >
              {t("Reset")}
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className={`skill-source-list${mergeSelectionMode ? " can-merge" : ""}${selectionDragging ? " is-selecting" : ""}`}
        onPointerMove={scrollSelectionList}
      >
        {groups.length > 0 ? (
          <div className={`skill-source-table-head${mergeSelectionMode ? " can-merge" : ""}`}>
            {mergeSelectionMode ? <span aria-hidden="true" /> : null}
            <span>{t("Source")}</span>
            <span>{t("Skills")}</span>
            <span>{t("Last checked")}</span>
            <span>{t("Status")}</span>
            <span aria-label={t("More")} />
          </div>
        ) : null}
        {loading && groups.length === 0 ? (
          <div className="inline-state inline-state--loading skill-source-empty" role="status">
            <span className="inline-state__icon" aria-hidden="true" />
            <span>{t("Loading sources")}</span>
          </div>
        ) : null}
        {!loading && groups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No sources yet")}</strong>
            <span>{t("Import skills from a folder or repository to manage their sources here.")}</span>
          </div>
        ) : null}
        {groups.length > 0 && visibleGroups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No sources match the current filters")}</strong>
          </div>
        ) : null}
        {visibleGroups.map((group) => {
          const isExpanded = expanded.has(group.sourceId);
          const isChecking = checking.has(group.sourceId) || activeCheckingSourceId === group.sourceId;
          const isSelected = mergeSelection.has(group.sourceId);
          const hasAttention = group.counts.updates + group.counts.new + group.counts.removed > 0;
          const groupName = group.displayName ?? sourceDefaultLabel(group);
          const repositoryLabel = sourceRepositoryLabel(group.repository);
          const directoryLeaf = sourceDirectoryLeaf(group);
          const primaryLabel = group.displayName ?? repositoryLabel;
          const primaryScope = !group.displayName && directoryLeaf
            ? `/${directoryLeaf}`
            : undefined;
          const reviewableUpdateIds = group.candidates.flatMap((candidate) =>
            candidate.state === "update" &&
            candidate.libraryId &&
            candidate.globallyEnabled !== false &&
            candidate.updatePolicy !== "untracked"
              ? [candidate.libraryId]
              : []
          );
          const reviewingGroup =
            operation === `review\0${reviewableUpdateIds.join("\0")}` ||
            (updateActivity?.kind === "preview-skills" &&
              reviewableUpdateIds.some((id) => updateActivity.skillIds.includes(id)));
          const changedCount = group.counts.updates + group.counts.new + group.counts.removed;
          const sourceStatus = isChecking
            ? "Checking..."
            : group.error
              ? "Check failed"
              : group.counts.updates > 0
                ? "Update available"
                : changedCount > 0
                  ? "Changes available"
                  : group.checkedAt
                    ? "Up to date"
                    : "Not checked";
          const semanticStatus = isChecking
            ? "working"
            : group.error
              ? "error"
              : group.counts.updates > 0
                ? "update-available"
                : changedCount > 0
                  ? "changes-available"
                  : "neutral";
          const statusClassName = `skill-source-status${group.error ? " is-error" : ""}${hasAttention ? " has-attention" : ""}`;
          const statusIcon = isChecking ? (
            <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
          ) : group.error || hasAttention ? (
            <CircleAlert size={13} strokeWidth={2.2} />
          ) : group.checkedAt ? (
            <CheckCircle2 size={13} strokeWidth={2.2} />
          ) : (
            <RefreshCw size={13} strokeWidth={2.2} />
          );
          const statusLabel = group.error ? (
                <OverflowTooltip
                  className="skill-source-status-label"
                  text={group.error}
                  displayText={t(sourceStatus)}
                />
              ) : (
                <span className="skill-source-status-label">{t(sourceStatus)}</span>
              );
          const reviewStatus = !isChecking && reviewableUpdateIds.length > 0
            ? () => void runReviewUpdates(reviewableUpdateIds)
            : !isChecking && group.error
              ? () => void runCheck(group.sourceId)
              : !isChecking && hasAttention
                ? () => toggleExpanded(group.sourceId)
                : undefined;
          const reviewStatusLabel = reviewableUpdateIds.length > 0
            ? t("Review source updates")
            : group.error
              ? t("Retry source check")
              : hasAttention
                ? t("Review source changes")
                : undefined;
          return (
            <article
              className={`skill-source-group${isExpanded ? " is-expanded" : ""}${isSelected ? " is-selected" : ""}${hasAttention ? " has-attention" : ""}`}
              key={group.sourceId}
              onPointerEnter={() => extendSelectionDrag(group.sourceId)}
            >
              <div
                className="skill-source-group-row"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("button, input, label, a, select, [role='menuitem']")) return;
                  toggleExpanded(group.sourceId);
                }}
              >
                {mergeSelectionMode ? (
                  <label
                    className="skill-source-select"
                    onPointerDown={(event) => beginSelectionDrag(
                      event,
                      group.sourceId,
                      isSelected
                    )}
                    onClick={(event) => {
                      if (!suppressSelectionClickRef.current) return;
                      event.preventDefault();
                      suppressSelectionClickRef.current = false;
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label={t("Select source {{name}}", {
                        name: groupName
                      })}
                      checked={isSelected}
                      onChange={(event) => {
                        setSourceSelected(group.sourceId, event.currentTarget.checked);
                      }}
                    />
                  </label>
                ) : null}
                <button
                  className="skill-source-disclosure"
                  type="button"
                  aria-label={t(isExpanded ? "Collapse source" : "Expand source")}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpanded(group.sourceId)}
                >
                  <DisclosureIcon open={isExpanded} size={16} />
                </button>
                <span className="skill-source-artwork" aria-hidden="true">
                  <ResourceIconArtwork
                    fallbackIconKey={group.sourceKind === "local" ? "folder" : "github"}
                    size={18}
                    sourceUrl={group.canonicalLink}
                  />
                </span>
                <div className="skill-source-identity">
                  <div className="skill-source-title-row">
                    <button
                      className="skill-source-link"
                      type="button"
                      aria-label={groupName}
                      onClick={() => sourceIsOpenable(group.canonicalLink)
                        ? onOpenSource(group.canonicalLink)
                        : onCopySource(group.canonicalLink)}
                    >
                      <OverflowTooltip
                        className="skill-source-link-text"
                        displayText={primaryLabel}
                        focusable={false}
                        text={group.canonicalLink}
                      />
                      {primaryScope ? (
                        <span className="skill-source-link-scope" aria-hidden="true">
                          {primaryScope}
                        </span>
                      ) : null}
                      {sourceIsOpenable(group.canonicalLink) ? (
                        <ExternalLink size={12} strokeWidth={2.2} />
                      ) : (
                        <Copy size={12} strokeWidth={2.2} />
                      )}
                    </button>
                  </div>
                  <span className="skill-source-checked">
                    {group.displayName
                      ? `${sourceRepositoryLabel(group.repository)} · ${sourceScopeLabel(group)}`
                      : sourceScopeLabel(group)}
                  </span>
                </div>
                <div className="skill-source-counts" aria-label={t("Source summary")}>
                  <span className="is-total"><span>{t("Total")}</span><strong>{group.counts.total}</strong></span>
                  <OverflowTooltip
                    className={`is-change${changedCount > 0 ? " has-value" : ""}`}
                    displayText={`${t("Changes")} ${changedCount}`}
                    text={[
                      `${t("Updates")} ${group.counts.updates}`,
                      `${t("New")} ${group.counts.new}`,
                      `${t("Removed")} ${group.counts.removed}`
                    ].join(" · ")}
                  />
                </div>
                <span className="skill-source-last-checked">
                  {group.error
                    ? t("Last check failed")
                    : group.checkedAt
                      ? formatDate(group.checkedAt)
                      : "—"}
                </span>
                <InteractiveStatus
                  busy={reviewingGroup}
                  className={statusClassName}
                  disabled={activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
                  icon={statusIcon}
                  label={statusLabel}
                  reviewLabel={reviewStatusLabel}
                  statusKind={semanticStatus}
                  tone={statusToneFor(semanticStatus)}
                  onReview={reviewStatus ? (event) => {
                    event.stopPropagation();
                    reviewStatus();
                  } : undefined}
                />
                <div className="skill-source-more">
                  <IconButton
                    busy={monitoringOperation === group.sourceId}
                    label={t("Source actions for {{name}}", { name: groupName })}
                    size="compact"
                    variant="ghost"
                    aria-expanded={sourceMenu?.sourceId === group.sourceId}
                    aria-haspopup="menu"
                    onClick={(event) => toggleSourceMenu(group.sourceId, event.currentTarget)}
                  >
                    <MoreHorizontal />
                  </IconButton>
                  {sourceMenu?.sourceId === group.sourceId ? createPortal(
                    <ActionMenu
                      ariaLabel={t("Source actions for {{name}}", { name: groupName })}
                      className="skill-source-action-menu"
                      menuRef={sourceMenuRef}
                      style={sourceMenu.style}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        aria-busy={isChecking}
                        disabled={isChecking || activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
                        onClick={() => void runCheck(group.sourceId)}
                      >
                        {isChecking ? (
                          <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                        ) : (
                          <RefreshCw size={15} strokeWidth={2.1} aria-hidden="true" />
                        )}
                        <span>{t("Check source")}</span>
                      </button>
                      {onSetMonitored ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={monitoringOperation === group.sourceId || isChecking || activeCheckingAll}
                          onClick={() => void toggleMonitoring(group)}
                        >
                          <RefreshCw size={15} strokeWidth={2.1} aria-hidden="true" />
                          <span>
                            {t(group.automaticChecks === false
                              ? "Include in routine checks"
                              : "Exclude from routine checks")}
                          </span>
                        </button>
                      ) : null}
                      <button type="button" role="menuitem" onClick={() => openRename(group)}>
                        <Pencil size={15} strokeWidth={2.1} aria-hidden="true" />
                        <span>{t("Rename source")}</span>
                      </button>
                    </ActionMenu>,
                    document.body
                  ) : null}
                </div>
              </div>

              {isExpanded ? (
                <div className="skill-source-candidates">
                  <div className="skill-source-candidate-head" aria-hidden="true">
                    <span>{t("Skill")}</span>
                    <span>{t("Upstream")}</span>
                    <span>{t("Library")}</span>
                    <span>{t("Status")}</span>
                    <span>{t("Action")}</span>
                  </div>
                  {group.candidates.map((candidate) => {
                    const addKey = `add\0${group.canonicalLink}\0${candidate.sourceSubpath}`;
                    const ignoreKey =
                      `ignore\0${group.sourceId}\0${candidate.sourceSubpath}`;
                    const unignoreKey =
                      `unignore\0${group.sourceId}\0${candidate.sourceSubpath}`;
                    const updateKey = candidate.libraryId ? `update\0${candidate.libraryId}` : "";
                    const isAdding = operation === addKey;
                    const isIgnoring = operation === ignoreKey;
                    const isUnignoring = operation === unignoreKey;
                    const isUpdating =
                      operation === updateKey ||
                      (updateActivity?.kind === "preview-skill" &&
                        updateActivity.skillId === candidate.libraryId);
                    return (
                      <div
                        className={`skill-source-candidate is-${candidate.state}${candidate.globallyEnabled === false ? " is-disabled" : ""}`}
                        key={`${candidate.sourceSubpath}\0${candidate.libraryId ?? "remote"}`}
                      >
                        <div className="skill-source-candidate-name">
                          <strong>{candidate.name}</strong>
                          <OverflowTooltip
                            className="skill-source-candidate-path"
                            text={candidate.directory || group.directory || "."}
                          />
                        </div>
                        <div className="skill-source-candidate-meta">
                          <span className="skill-source-candidate-field-label">{t("Upstream")}</span>
                          <strong>{candidate.version ?? candidate.contentRevision?.slice(0, 7) ?? "—"}</strong>
                          <span>{candidate.upstreamUpdatedAt ? formatDate(candidate.upstreamUpdatedAt) : "—"}</span>
                        </div>
                        <div className="skill-source-candidate-meta">
                          <span className="skill-source-candidate-field-label">{t("Library")}</span>
                          <strong>{candidate.libraryName ?? t("Not in Library")}</strong>
                          <span>
                            {[candidate.libraryVersion ?? candidate.libraryId, candidate.libraryUpdatedAt
                              ? formatDate(candidate.libraryUpdatedAt)
                              : undefined]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </span>
                        </div>
                        <div className={`skill-source-state is-${candidate.state}`}>
                          {candidate.state === "current" ? (
                            <CheckCircle2 size={14} strokeWidth={2.2} />
                          ) : candidate.state === "invalid" || candidate.state === "conflict" ? (
                            <CircleAlert size={14} strokeWidth={2.2} />
                          ) : null}
                          <OverflowTooltip
                            className="skill-source-state-label"
                            displayText={t(stateLabel(candidate.state))}
                            text={candidate.detail ?? t(stateLabel(candidate.state))}
                          />
                        </div>
                        <div className="skill-source-candidate-action">
                          {candidate.state === "new" ? (
                            <>
                              <button
                                aria-busy={isAdding}
                                className="text-action"
                                type="button"
                                disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                                onClick={() => void runAdd(group, candidate)}
                              >
                                {isAdding ? <LoaderCircle className="is-spinning" size={13} /> : null}
                                <span>{t("Add")}</span>
                              </button>
                              {onSetCandidateIgnored ? (
                                <IconButton
                                  busy={isIgnoring}
                                  className="skill-source-ignore-action"
                                  label={t("Ignore {{name}} for this source", {
                                    name: candidate.name
                                  })}
                                  size="compact"
                                  variant="ghost"
                                  disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                                  onClick={() => void setCandidateIgnored(group, candidate, true)}
                                >
                                  <EyeOff />
                                </IconButton>
                              ) : null}
                            </>
                          ) : candidate.state === "ignored" ? (
                            <button
                              aria-busy={isUnignoring}
                              className="text-action"
                              type="button"
                              disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                              onClick={() => void setCandidateIgnored(group, candidate, false)}
                            >
                              {isUnignoring ? <LoaderCircle className="is-spinning" size={13} /> : null}
                              <span>{t("Unignore")}</span>
                            </button>
                          ) : candidate.state === "update" &&
                            candidate.libraryId &&
                            candidate.globallyEnabled !== false &&
                            candidate.updatePolicy !== "untracked" ? (
                            <button
                              aria-busy={isUpdating}
                              className="text-action"
                              type="button"
                              aria-label={t("Update {{name}}", { name: candidate.libraryId })}
                              disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                              onClick={() => void runUpdate(candidate.libraryId!)}
                            >
                              {isUpdating ? <LoaderCircle className="is-spinning" size={13} /> : null}
                              <span>{t("Update")}</span>
                            </button>
                          ) : candidate.state === "removed" && candidate.libraryId ? (
                            <button
                              className="text-action text-action--danger"
                              type="button"
                              disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                              onClick={() => onDelete(candidate.libraryId!)}
                            >
                              <Trash2 size={13} strokeWidth={2.2} />
                              <span>{t("Delete")}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {mergeOpen ? (
        <ModalFrame
          ariaLabel={t("Confirm source merge")}
          className="skill-source-merge-dialog ui-dialog-shell"
          dialogRef={mergeDialogRef}
          dismissPolicy="intentional"
          dismissDisabled={mergeBusy}
          onDismiss={closeMerge}
        >
          <DialogHeader
            title={t("Confirm source merge")}
            description={t("Review and adjust the shared source before merging selected groups.")}
          />
          <DialogBody className="skill-source-merge-body">
            <div className="skill-source-merge-summary">
              <div><span>{t("Selected sources")}</span><strong>{mergeSelection.size}</strong></div>
              <div><span>{t("Library Skills")}</span><strong>{mergePreview?.affectedSkillCount ?? "—"}</strong></div>
              <div><span>{t("Discovered")}</span><strong>{mergePreview?.discoveredSkillCount ?? "—"}</strong></div>
            </div>
            <label className="skill-source-merge-field">
              <span>{t(mergeIsLocal ? "Merged source folder" : "Merged source directory")}</span>
              <input
                value={activeMergeDirectory}
                placeholder={t(mergeIsLocal ? "Local folder" : "Repository root")}
                onChange={(event) => {
                  setMergeDirectory(event.currentTarget.value);
                  setMergeError(undefined);
                }}
              />
            </label>
            <div className={`skill-source-merge-result${mergePreviewIsCurrent ? " is-preview" : ""}`}>
              <span>{t("Resulting source")}</span>
              <OverflowTooltip
                className="skill-source-merge-path"
                focusable={false}
                text={mergeIsLocal
                  ? activeMergeDirectory
                  : `${sourceRepositoryLabel(selectedMergeGroups[0]!.repository)} · ${selectedMergeGroups[0]!.ref} · /${activeMergeDirectory || "."}`}
              />
            </div>
            {mergeBusy && !mergePreview ? (
              <div className="inline-state inline-state--loading" role="status">
                <span className="inline-state__icon" aria-hidden="true" />
                <span>{t("Checking merged source...")}</span>
              </div>
            ) : null}
            {!mergePreviewIsCurrent && mergePreview ? (
              <p className="skill-source-merge-notice">{t("The edited source will be checked before merging.")}</p>
            ) : null}
            {mergePreviewIsCurrent && mergePreview ? mergePreview.warnings.map((warning) => (
              <p className="skill-source-merge-notice" key={warning}>{t(warning)}</p>
            )) : null}
            {mergePreviewIsCurrent && mergePreview ? mergePreview.blockers.map((blocker) => (
              <p className="skill-source-merge-notice is-error" key={blocker}>{blocker}</p>
            )) : null}
            {mergeError ? (
              <div className="skill-source-merge-notice is-error" role="alert">
                <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
                <OverflowTooltip
                  ariaLabel={t("Full merge error")}
                  className="skill-source-merge-error"
                  displayText={t(mergeErrorSummary(mergeError))}
                  text={mergeError}
                  tooltipClassName="library-source-tooltip"
                />
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter className="preview-actions">
            <Button disabled={mergeBusy} onClick={() => closeMerge()}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={mergeBusy}
              busyLabel={t("Preparing...")}
              disabled={mergeBusy || (mergePreviewIsCurrent && (mergePreview?.blockers.length ?? 0) > 0)}
              icon={<GitMerge size={15} />}
              onClick={() => void confirmMerge()}
            >
              {t("Confirm merge")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}

      {renameSource ? (
        <ModalFrame
          ariaLabel={t("Rename source")}
          className="skill-source-name-dialog ui-dialog-shell"
          dialogRef={renameDialogRef}
          dismissPolicy="intentional"
          dismissDisabled={renameBusy}
          onDismiss={closeRename}
        >
          <DialogHeader
            title={t("Rename source")}
            description={(
              <OverflowTooltip
                className="skill-source-name-location"
                displayText={`${sourceRepositoryLabel(renameSource.repository)} · ${sourceScopeLabel(renameSource)}`}
                focusable={false}
                text={renameSource.canonicalLink}
              />
            )}
          />
          <DialogBody className="skill-source-name-body">
            <label className="skill-source-merge-field">
              <span>{t("Source name")}</span>
              <input
                maxLength={80}
                placeholder={sourceDefaultLabel(renameSource)}
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.currentTarget.value);
                  setRenameError(undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void confirmRename();
                }}
              />
            </label>
            {renameError ? <p className="skill-source-merge-notice is-error">{renameError}</p> : null}
          </DialogBody>
          <DialogFooter className="preview-actions">
            <Button disabled={renameBusy} onClick={closeRename}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={renameBusy}
              busyLabel={t("Saving...")}
              disabled={renameBusy || renameValue.trim() === (renameSource.displayName ?? "")}
              onClick={() => void confirmRename()}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
