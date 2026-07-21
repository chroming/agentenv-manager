import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import type {
  SkillSourceGroupCandidate,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { Button, ModalFrame } from "./ui";

interface SkillSourceViewProps {
  active: boolean;
  groups: SkillSourceGroupView[];
  loading: boolean;
  onCheckGroup(sourceId: string): Promise<void>;
  onCheckAll(): Promise<void>;
  onPreviewMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  onMerge(previewId: string): Promise<SkillSourceMergeResult>;
  onAdd(group: SkillSourceGroupView, candidate: SkillSourceGroupCandidate): Promise<boolean>;
  onUpdate(libraryId: string): void;
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
  `${group.ref} · /${group.directory || "."}`;

export const SkillSourceView = ({
  active,
  groups,
  loading,
  onCheckGroup,
  onCheckAll,
  onPreviewMerge,
  onMerge,
  onAdd,
  onUpdate,
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
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [mergeDirectory, setMergeDirectory] = useState<string>();
  const [mergePreview, setMergePreview] = useState<SkillSourceMergePreview>();
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const mergeDialogRef = useRef<HTMLElement>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normalizedSearch) return groups;
    return groups.filter((group) =>
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
  const computedMergeDirectory = useMemo(() => {
    if (selectedMergeGroups.length < 2) return "";
    const paths = selectedMergeGroups.map((group) => group.directory.split("/").filter(Boolean));
    const common: string[] = [];
    for (let index = 0; index < Math.min(...paths.map((path) => path.length)); index += 1) {
      const segment = paths[0]![index];
      if (!paths.every((path) => path[index] === segment)) break;
      common.push(segment!);
    }
    return common.join("/");
  }, [selectedMergeGroups]);
  const activeMergeDirectory = mergeDirectory ?? computedMergeDirectory;
  const mergePreviewIsCurrent = mergePreview?.mergedSource.directory === activeMergeDirectory;

  const closeMerge = (force = false, clearSelection = false) => {
    if (mergeBusy && !force) return;
    setMergeOpen(false);
    if (clearSelection) setMergeSelection(new Set());
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

  const previewMerge = async (directory: string) => {
    setMergeBusy(true);
    setMergeError(undefined);
    try {
      const preview = await onPreviewMerge({
        sourceIds: [...mergeSelection],
        directory
      });
      setMergeDirectory(preview.mergedSource.directory);
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
      const currentPreview = mergePreview?.mergedSource.directory === directory
        ? mergePreview
        : await onPreviewMerge({ sourceIds: [...mergeSelection], directory });
      setMergeDirectory(currentPreview.mergedSource.directory);
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
    const key = `${group.canonicalLink}\0${candidate.sourceSubpath}`;
    setOperation(key);
    try {
      await onAdd(group, candidate);
    } finally {
      setOperation(undefined);
    }
  };

  return (
    <section
      className={`skill-source-view${active ? "" : " is-inactive"}`}
      aria-label={t("Skills by source")}
      aria-hidden={!active}
    >
      <div className="skill-source-toolbar">
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
          className="secondary-action"
          type="button"
          disabled={checkingAll || checking.size > 0 || Boolean(operation) || groups.length === 0}
          onClick={() => void runCheckAll()}
        >
          {checkingAll ? (
            <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
          ) : (
            <RefreshCw size={15} strokeWidth={2.2} />
          )}
          <span>{t("Check all")}</span>
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={mergeSelection.size < 2 || checkingAll || Boolean(operation)}
          onClick={openMerge}
        >
          <GitMerge size={15} strokeWidth={2.2} />
          <span>{t("Merge selected")}{mergeSelection.size > 0 ? ` (${mergeSelection.size})` : ""}</span>
        </button>
      </div>

      <div className="skill-source-list">
        {loading && groups.length === 0 ? (
          <div className="inline-state inline-state--loading skill-source-empty" role="status">
            <span className="inline-state__icon" aria-hidden="true" />
            <span>{t("Loading sources")}</span>
          </div>
        ) : null}
        {!loading && groups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No repository sources yet")}</strong>
            <span>{t("Import skills from a repository to group and check them here.")}</span>
          </div>
        ) : null}
        {groups.length > 0 && visibleGroups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No sources match this search")}</strong>
          </div>
        ) : null}
        {visibleGroups.map((group) => {
          const isExpanded = expanded.has(group.sourceId);
          const isChecking = checking.has(group.sourceId);
          const isSelected = mergeSelection.has(group.sourceId);
          const hasAttention = group.counts.updates + group.counts.new + group.counts.removed > 0;
          return (
            <article
              className={`skill-source-group${isExpanded ? " is-expanded" : ""}${isSelected ? " is-selected" : ""}${hasAttention ? " has-attention" : ""}`}
              key={group.sourceId}
            >
              <div className="skill-source-group-row">
                <label className="skill-source-select">
                  <input
                    type="checkbox"
                    aria-label={t("Select source {{name}}", {
                      name: group.directory || t("Repository root")
                    })}
                    checked={isSelected}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setMergeSelection((current) => {
                        const next = new Set(current);
                        if (checked) next.add(group.sourceId);
                        else next.delete(group.sourceId);
                        return next;
                      });
                    }}
                  />
                </label>
                <button
                  className="skill-source-disclosure"
                  type="button"
                  aria-label={t(isExpanded ? "Collapse source" : "Expand source")}
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(group.sourceId)) next.delete(group.sourceId);
                    else next.add(group.sourceId);
                    return next;
                  })}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="skill-source-artwork" aria-hidden="true">
                  <ResourceIconArtwork
                    fallbackIconKey="github"
                    size={18}
                    sourceUrl={group.canonicalLink}
                  />
                </span>
                <div className="skill-source-identity">
                  <button
                    className="skill-source-link"
                    type="button"
                    onClick={() => sourceIsOpenable(group.canonicalLink)
                      ? onOpenSource(group.canonicalLink)
                      : onCopySource(group.canonicalLink)}
                  >
                    <OverflowTooltip
                      className="skill-source-link-text"
                      displayText={sourceRepositoryLabel(group.repository)}
                      focusable={false}
                      text={group.canonicalLink}
                    />
                    {sourceIsOpenable(group.canonicalLink) ? (
                      <ExternalLink size={12} strokeWidth={2.2} />
                    ) : (
                      <Copy size={12} strokeWidth={2.2} />
                    )}
                  </button>
                  <span className="skill-source-checked">
                    {sourceScopeLabel(group)} · {group.error
                      ? t("Last check failed")
                      : group.checkedAt
                        ? t("Checked {{date}}", { date: formatDate(group.checkedAt) })
                        : t("Not checked")}
                  </span>
                </div>
                <div className="skill-source-counts" aria-label={t("Source summary")}>
                  <span className="is-total"><strong>{group.counts.total}</strong>{t("Total")}</span>
                  <span className="is-update"><strong>{group.counts.updates}</strong>{t("Updates")}</span>
                  <span className="is-new"><strong>{group.counts.new}</strong>{t("New")}</span>
                  <span className="is-removed"><strong>{group.counts.removed}</strong>{t("Removed")}</span>
                </div>
                {group.error ? (
                  <OverflowTooltip
                    className="skill-source-error"
                    text={group.error}
                    displayText={t("Check failed")}
                  />
                ) : null}
                <button
                  className="secondary-action skill-source-check"
                  type="button"
                  disabled={isChecking || checkingAll || Boolean(operation)}
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
                    const key = `${group.canonicalLink}\0${candidate.sourceSubpath}`;
                    const isWorking = operation === key;
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
                          <strong>{candidate.version ?? candidate.contentRevision?.slice(0, 7) ?? "—"}</strong>
                          <span>{candidate.upstreamUpdatedAt ? formatDate(candidate.upstreamUpdatedAt) : "—"}</span>
                        </div>
                        <div className="skill-source-candidate-meta">
                          <strong>{candidate.libraryName ?? t("Not in Library")}</strong>
                          <span>{candidate.libraryVersion ?? candidate.libraryId ?? "—"}</span>
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
                              className="text-action"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
                              onClick={() => void runAdd(group, candidate)}
                            >
                              {isWorking ? <LoaderCircle className="is-spinning" size={13} /> : null}
                              <span>{t("Add")}</span>
                            </button>
                          ) : candidate.state === "update" && candidate.libraryId ? (
                            <button
                              className="text-action"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
                              onClick={() => onUpdate(candidate.libraryId!)}
                            >
                              <span>{t("Review update")}</span>
                            </button>
                          ) : candidate.state === "removed" && candidate.libraryId ? (
                            <button
                              className="text-action text-action--danger"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
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
          <header className="profile-form-dialog__header">
            <div>
              <strong>{t("Confirm source merge")}</strong>
              <span>{t("Review and adjust the shared source before merging selected groups.")}</span>
            </div>
          </header>
          <div className="skill-source-merge-body">
            <div className="skill-source-merge-summary">
              <div><span>{t("Selected sources")}</span><strong>{mergeSelection.size}</strong></div>
              <div><span>{t("Library Skills")}</span><strong>{mergePreview?.affectedSkillCount ?? "—"}</strong></div>
              <div><span>{t("Discovered")}</span><strong>{mergePreview?.discoveredSkillCount ?? "—"}</strong></div>
            </div>
            <label className="skill-source-merge-field">
              <span>{t("Merged source directory")}</span>
              <input
                value={activeMergeDirectory}
                placeholder={t("Repository root")}
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
                text={`${sourceRepositoryLabel(selectedMergeGroups[0]!.repository)} · ${selectedMergeGroups[0]!.ref} · /${activeMergeDirectory || "."}`}
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
            {mergePreviewIsCurrent ? mergePreview.warnings.map((warning) => (
              <p className="skill-source-merge-notice" key={warning}>{t(warning)}</p>
            )) : null}
            {mergePreviewIsCurrent ? mergePreview.blockers.map((blocker) => (
              <p className="skill-source-merge-notice is-error" key={blocker}>{blocker}</p>
            )) : null}
            {mergeError ? <p className="skill-source-merge-notice is-error">{mergeError}</p> : null}
          </div>
          <footer className="profile-form-dialog__actions">
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
    </section>
  );
};
