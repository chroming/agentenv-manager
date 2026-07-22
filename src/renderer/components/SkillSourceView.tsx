import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  GitMerge,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type {
  SkillSourceGroupCandidate,
  SkillSourceGroupView,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult
} from "../../shared/types";
import { useI18n } from "../i18n";
import type { SkillUpdateActivity } from "../skillUpdateActivity";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { Button, IconButton, ModalFrame, Switch } from "./ui";

interface SkillSourceViewProps {
  active: boolean;
  updateActivity?: SkillUpdateActivity;
  groups: SkillSourceGroupView[];
  loading: boolean;
  onCheckGroup(sourceId: string): Promise<void>;
  onCheckAll(): Promise<void>;
  onRename(input: SkillSourceNameInput): Promise<void>;
  onSetAutomaticChecks?(sourceId: string, enabled: boolean): Promise<void>;
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
  onCheckGroup,
  onCheckAll,
  onRename,
  onSetAutomaticChecks,
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [operation, setOperation] = useState<string>();
  const [automaticChecksOperation, setAutomaticChecksOperation] = useState<string>();
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
  const mergeDialogRef = useRef<HTMLElement>(null);
  const renameDialogRef = useRef<HTMLElement>(null);
  const selectionDragRef = useRef<{ selected: boolean; visited: Set<string> } | undefined>(undefined);
  const suppressSelectionClickRef = useRef(false);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const activeCheckingAll = checkingAll || updateActivity?.kind === "check-sources";
  const activeCheckingSourceId =
    updateActivity?.kind === "check-source" ? updateActivity.sourceId : undefined;
  const visibleGroups = useMemo(() => {
    if (!normalizedSearch) return groups;
    return groups.filter((group) =>
      group.displayName?.toLocaleLowerCase().includes(normalizedSearch) ||
      group.canonicalLink.toLocaleLowerCase().includes(normalizedSearch) ||
      group.candidates.some((candidate) =>
        candidate.name.toLocaleLowerCase().includes(normalizedSearch) ||
        candidate.libraryName?.toLocaleLowerCase().includes(normalizedSearch)
      )
    );
  }, [groups, normalizedSearch]);

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
  const canMergeSources = groups.length >= 2;

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

  const toggleAutomaticChecks = async (group: SkillSourceGroupView) => {
    if (!onSetAutomaticChecks) return;
    setAutomaticChecksOperation(group.sourceId);
    try {
      await onSetAutomaticChecks(group.sourceId, group.automaticChecks === false);
    } finally {
      setAutomaticChecksOperation(undefined);
    }
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

  const runCheckAll = async () => {
    setCheckingAll(true);
    try {
      await onCheckAll();
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
        <label className="library-search">
          <span>{t("Search")}</span>
          <Search size={16} strokeWidth={2.1} aria-hidden="true" />
          <input
            aria-label={t("Search sources and skills")}
            placeholder={t("Search source or skill...")}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <button
          aria-busy={activeCheckingAll}
          className="secondary-action"
          type="button"
          disabled={activeCheckingAll || checking.size > 0 || Boolean(activeCheckingSourceId) || Boolean(operation) || groups.length === 0}
          onClick={() => void runCheckAll()}
        >
          {activeCheckingAll ? (
            <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
          ) : (
            <RefreshCw size={15} strokeWidth={2.2} />
          )}
          <span>{t("Check all")}</span>
        </button>
        {canMergeSources ? (
          <button
            className="secondary-action"
            type="button"
            disabled={(mergeSelectionMode && mergeSelection.size < 2) || activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
            onClick={() => mergeSelectionMode ? openMerge() : setMergeSelectionMode(true)}
          >
            <GitMerge size={15} strokeWidth={2.2} />
            <span>{mergeSelectionMode
              ? `${t("Merge selected")} (${mergeSelection.size})`
              : t("Merge")}</span>
          </button>
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
      </div>

      <div
        className={`skill-source-list${mergeSelectionMode ? " can-merge" : ""}${selectionDragging ? " is-selecting" : ""}`}
        onPointerMove={scrollSelectionList}
      >
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
            <strong>{t("No sources match this search")}</strong>
          </div>
        ) : null}
        {visibleGroups.map((group) => {
          const isExpanded = expanded.has(group.sourceId);
          const isChecking = checking.has(group.sourceId) || activeCheckingSourceId === group.sourceId;
          const isSelected = mergeSelection.has(group.sourceId);
          const hasAttention = group.counts.updates + group.counts.new + group.counts.removed > 0;
          const groupName = group.displayName ?? sourceDefaultLabel(group);
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
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
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
                      onClick={() => sourceIsOpenable(group.canonicalLink)
                        ? onOpenSource(group.canonicalLink)
                        : onCopySource(group.canonicalLink)}
                    >
                      <OverflowTooltip
                        className="skill-source-link-text"
                        displayText={groupName}
                        focusable={false}
                        text={group.canonicalLink}
                      />
                      {sourceIsOpenable(group.canonicalLink) ? (
                        <ExternalLink size={12} strokeWidth={2.2} />
                      ) : (
                        <Copy size={12} strokeWidth={2.2} />
                      )}
                    </button>
                    <button
                      className="skill-source-rename"
                      type="button"
                      aria-label={t("Rename source {{name}}", {
                        name: groupName
                      })}
                      onClick={() => openRename(group)}
                    >
                      <Pencil size={13} strokeWidth={2.1} />
                    </button>
                  </div>
                  <span className="skill-source-checked">
                    {group.displayName
                      ? `${sourceRepositoryLabel(group.repository)} · ${sourceScopeLabel(group)}`
                      : group.ref} · {group.error
                      ? t("Last check failed")
                      : group.checkedAt
                        ? t("Checked {{date}}", { date: formatDate(group.checkedAt) })
                        : t("Not checked")}
                  </span>
                </div>
                <div className="skill-source-counts" aria-label={t("Source summary")}>
                  <span className="is-total"><strong>{group.counts.total}</strong>{t("Total")}</span>
                  <span className={`is-update${group.counts.updates > 0 ? " has-value" : ""}`}><strong>{group.counts.updates}</strong>{t("Updates")}</span>
                  <span className={`is-new${group.counts.new > 0 ? " has-value" : ""}`}><strong>{group.counts.new}</strong>{t("New")}</span>
                  <span className={`is-removed${group.counts.removed > 0 ? " has-value" : ""}`}><strong>{group.counts.removed}</strong>{t("Removed")}</span>
                </div>
                {group.error ? (
                  <OverflowTooltip
                    className="skill-source-error"
                    text={group.error}
                    displayText={t("Check failed")}
                  />
                ) : null}
                <div className="skill-source-group-actions">
                  <Switch
                    checked={group.automaticChecks !== false}
                    hidden={!onSetAutomaticChecks}
                    disabled={automaticChecksOperation === group.sourceId || isChecking || activeCheckingAll}
                    label={t("Automatic checks for {{name}}", { name: groupName })}
                    onClick={() => void toggleAutomaticChecks(group)}
                  >
                    {automaticChecksOperation === group.sourceId ? (
                      <LoaderCircle className="is-spinning" size={13} />
                    ) : null}
                    <span>{t("Auto")}</span>
                  </Switch>
                  {reviewableUpdateIds.length > 0 ? (
                    <button
                      aria-label={`${t("Review")} ${reviewableUpdateIds.length}`}
                      aria-busy={reviewingGroup}
                      className="secondary-action skill-source-review"
                      type="button"
                      disabled={isChecking || activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
                      onClick={() => void runReviewUpdates(reviewableUpdateIds)}
                    >
                      {reviewingGroup ? (
                        <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                      ) : (
                        <RefreshCw size={14} strokeWidth={2.2} />
                      )}
                      <span>{t("Review")} {reviewableUpdateIds.length}</span>
                    </button>
                  ) : null}
                  <button
                    aria-busy={isChecking}
                    className="secondary-action skill-source-check"
                    type="button"
                    disabled={isChecking || activeCheckingAll || Boolean(updateActivity) || Boolean(operation)}
                    onClick={() => void runCheck(group.sourceId)}
                  >
                    {isChecking ? (
                      <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                    ) : (
                      <RefreshCw size={14} strokeWidth={2.2} />
                    )}
                    <span>{t(group.error ? "Retry" : "Check")}</span>
                  </button>
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
                    const updateKey = candidate.libraryId ? `update\0${candidate.libraryId}` : "";
                    const isAdding = operation === addKey;
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
                          ) : candidate.state === "update" &&
                            candidate.libraryId &&
                            candidate.globallyEnabled !== false &&
                            candidate.updatePolicy !== "untracked" ? (
                            <button
                              aria-busy={isUpdating}
                              className="text-action"
                              type="button"
                              aria-label={t("Review update {{id}}", { id: candidate.libraryId })}
                              disabled={Boolean(operation) || Boolean(updateActivity) || activeCheckingAll || checking.size > 0}
                              onClick={() => void runUpdate(candidate.libraryId!)}
                            >
                              {isUpdating ? <LoaderCircle className="is-spinning" size={13} /> : null}
                              <span>{t("Review")}</span>
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
          className="skill-source-merge-dialog"
          dialogRef={mergeDialogRef}
          dismissDisabled={mergeBusy}
          onDismiss={closeMerge}
        >
          <header className="profile-dialog-header">
            <div>
              <div className="section-title">{t("Confirm source merge")}</div>
              <p className="muted">{t("Review and adjust the shared source before merging selected groups.")}</p>
            </div>
          </header>
          <div className="skill-source-merge-body">
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
          </div>
          <footer className="preview-actions">
            <Button disabled={mergeBusy} onClick={() => closeMerge()}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={mergeBusy || (mergePreviewIsCurrent && (mergePreview?.blockers.length ?? 0) > 0)}
              icon={mergeBusy ? <LoaderCircle className="is-spinning" size={15} /> : <GitMerge size={15} />}
              onClick={() => void confirmMerge()}
            >
              {t("Confirm merge")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}

      {renameSource ? (
        <ModalFrame
          ariaLabel={t("Rename source")}
          className="skill-source-name-dialog"
          dialogRef={renameDialogRef}
          dismissDisabled={renameBusy}
          onDismiss={closeRename}
        >
          <header className="profile-dialog-header">
            <div>
              <div className="section-title">{t("Rename source")}</div>
              <OverflowTooltip
                className="skill-source-name-location"
                displayText={`${sourceRepositoryLabel(renameSource.repository)} · ${sourceScopeLabel(renameSource)}`}
                focusable={false}
                text={renameSource.canonicalLink}
              />
            </div>
          </header>
          <div className="skill-source-name-body">
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
          </div>
          <footer className="preview-actions">
            <Button disabled={renameBusy} onClick={closeRename}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={renameBusy || renameValue.trim() === (renameSource.displayName ?? "")}
              icon={renameBusy ? <LoaderCircle className="is-spinning" size={15} /> : undefined}
              onClick={() => void confirmRename()}
            >
              {t("Save")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
    </section>
  );
};
