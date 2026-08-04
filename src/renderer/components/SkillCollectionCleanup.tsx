import { useCallback, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  Folder,
  LoaderCircle,
  TriangleAlert,
  XCircle
} from "lucide-react";
import {
  isSkillCollectionItemLibraryReady,
  type SkillCollectionLinkGroup
} from "../../shared/skillCleanup";
import type {
  SkillCollectionMemberDecisionUpdate,
  SkillInventoryEntry,
  UnmanagedSkillLocationUpdate
} from "../../shared/types";
import { useI18n } from "../i18n";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { Button } from "./ui";
import type {
  MoveSkillCollectionOptions,
  MoveSkillCollectionOutcome
} from "../skillCollectionMigrationAction";

type CollectionOperation = "import" | "keep" | "review" | "move";
export type CollectionResolutionStrategy = "keep-library" | "use-collection";
type CollectionItemProgress = {
  error?: string;
  state: "working" | "done" | "failed";
};

interface SkillCollectionActionsInput {
  onSetUnmanagedSkillLocations?(
    input: UnmanagedSkillLocationUpdate
  ): Promise<boolean>;
  onSetSkillCollectionDecision?(
    input: SkillCollectionMemberDecisionUpdate
  ): Promise<boolean>;
  onImportUnmanaged(
    path: string,
    sourceHandling?: "copy-only",
    deferFullRefresh?: boolean
  ): Promise<boolean>;
  onResolveCollectionConflict?(
    item: SkillInventoryEntry,
    strategy?: CollectionResolutionStrategy,
    deferFullRefresh?: boolean
  ): Promise<boolean>;
  onRefreshInventory(announce?: boolean): Promise<void>;
  onMoveSkillCollection?(
    collection: SkillCollectionLinkGroup,
    options?: MoveSkillCollectionOptions
  ): Promise<MoveSkillCollectionOutcome>;
  onClose(): void;
}

export const useSkillCollectionActions = ({
  onSetUnmanagedSkillLocations,
  onSetSkillCollectionDecision,
  onImportUnmanaged,
  onResolveCollectionConflict,
  onRefreshInventory,
  onMoveSkillCollection,
  onClose
}: SkillCollectionActionsInput) => {
  const [operation, setOperation] = useState<CollectionOperation>();
  const [moveIssue, setMoveIssue] = useState<Exclude<MoveSkillCollectionOutcome, { status: "moved" }>>();
  const [itemProgress, setItemProgress] = useState<Record<string, CollectionItemProgress>>({});
  const clearMoveIssue = useCallback(() => setMoveIssue(undefined), []);
  const updateItemProgress = (
    path: string,
    state: CollectionItemProgress["state"],
    error?: string
  ) => {
    setItemProgress((current) => ({ ...current, [path]: { state, error } }));
  };

  const changeRetention = async (
    collection: SkillCollectionLinkGroup,
    retained: boolean
  ) => {
    if (!onSetUnmanagedSkillLocations || operation) return;
    setOperation(retained ? "keep" : "review");
    try {
      await onSetUnmanagedSkillLocations({
        items: [{ path: collection.path, coverage: "collection" }],
        unmanaged: retained
      });
    } finally {
      setOperation(undefined);
    }
  };

  const processItem = async (item: SkillInventoryEntry) => {
    if (operation) return;
    setOperation("review");
    updateItemProgress(item.path, "working");
    try {
      const conflict =
        Boolean(item.libraryId) &&
        item.contentMatchesLibrary === false &&
        item.collectionDecision !== "use-library";
      const completed = conflict && onResolveCollectionConflict
        ? await onResolveCollectionConflict(item)
        : await onImportUnmanaged(item.path, "copy-only");
      if (completed) {
        updateItemProgress(item.path, "done");
      } else {
        setItemProgress((current) => {
          const next = { ...current };
          delete next[item.path];
          return next;
        });
      }
      if (completed) await onRefreshInventory(false);
    } catch (error) {
      updateItemProgress(
        item.path,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setOperation(undefined);
    }
  };

  const applyStrategy = async (
    collection: SkillCollectionLinkGroup,
    strategy: CollectionResolutionStrategy
  ) => {
    if (operation) return;
    setOperation("import");
    try {
      for (const item of collection.items) {
        if (isSkillCollectionItemLibraryReady(item)) continue;
        updateItemProgress(item.path, "working");
        const conflict =
          Boolean(item.libraryId) &&
          item.contentMatchesLibrary === false &&
          item.collectionDecision !== "use-library";
        let completed = false;
        try {
          if (
            conflict &&
            strategy === "keep-library" &&
            onSetSkillCollectionDecision
          ) {
            completed = await onSetSkillCollectionDecision({
              path: item.path,
              useLibrary: true,
              sourceContentHash: item.contentHash
            });
          } else if (conflict && onResolveCollectionConflict) {
            completed = await onResolveCollectionConflict(item, strategy, true);
          } else {
            completed = await onImportUnmanaged(item.path, "copy-only", true);
          }
          updateItemProgress(
            item.path,
            completed ? "done" : "failed",
            completed ? undefined : "This Skill was not changed."
          );
        } catch (error) {
          updateItemProgress(
            item.path,
            "failed",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      await onRefreshInventory(false);
    } finally {
      setOperation(undefined);
    }
  };

  const move = async (collection: SkillCollectionLinkGroup) => {
    if (!onMoveSkillCollection || operation || collection.state !== "ready") return;
    setOperation("move");
    setMoveIssue(undefined);
    try {
      const outcome = await onMoveSkillCollection(collection, {
        saveDirtyProfile: moveIssue?.status === "needs-save"
      });
      if (outcome.status === "moved") {
        onClose();
      } else {
        setMoveIssue(outcome);
      }
    } finally {
      setOperation(undefined);
    }
  };

  return {
    operation,
    itemProgress,
    moveIssue,
    clearMoveIssue,
    changeRetention,
    processItem,
    applyStrategy,
    move
  };
};

interface SkillCollectionRowsProps {
  collections: SkillCollectionLinkGroup[];
  targetNames?: TargetNameIndex;
  disabled: boolean;
  onReview(collection: SkillCollectionLinkGroup): void;
}

export const SkillCollectionRows = ({
  collections,
  targetNames,
  disabled,
  onReview
}: SkillCollectionRowsProps) => {
  const { t } = useI18n();

  return collections.map((collection) => {
    const stateLabel =
      collection.state === "ready"
        ? t("Ready")
        : collection.state === "unmanaged"
          ? t("Unmanaged")
          : collection.state === "conflict"
            ? t("Needs review")
            : t("{{count}} of {{total}} in Library", {
                count: collection.libraryReadyCount,
                total: collection.items.length
              });
    const stateClass =
      collection.state === "ready"
        ? "managed"
        : collection.state === "unmanaged"
          ? "left-unmanaged"
          : collection.state === "conflict"
            ? "conflict"
            : "pending";
    const agentNames = collection.consumerTargetIds
      .map((targetId) => targetNameFor(targetId, targetNames ?? {}, targetId))
      .join(" + ");

    return (
      <div
        aria-label={t("Skill collection {{name}}", { name: collection.name })}
        className="resource-row cleanup-group-row cleanup-collection-row"
        key={collection.path}
        role="group"
      >
        <span className="resource-avatar cleanup-group-icon" aria-hidden="true">
          <Folder size={17} strokeWidth={2.1} />
        </span>
        <div className="resource-row__main">
          <div className="cleanup-group-heading">
            <span className="cleanup-group-name">{collection.name}</span>
            <span className="resource-chip resource-chip--library">
              {t("Collection link")}
            </span>
          </div>
          <PreviewText
            ariaLabel={t("Full collection summary {{name}}", {
              name: collection.name
            })}
            className="cleanup-group-summary"
            displayText={t("{{count}} Skills · {{agents}}", {
              count: collection.items.length,
              agents: agentNames || t("No installed Agents")
            })}
            text={[
              `${collection.items.length} Skills`,
              agentNames,
              collection.path,
              collection.canonicalPath
            ].filter(Boolean).join("\n")}
            tooltipClassName="library-source-tooltip"
          />
        </div>
        <span className={`resource-chip resource-chip--${stateClass} cleanup-group-state`}>
          {stateLabel}
        </span>
        <div className="cleanup-group-actions">
          <Button
            className="cleanup-current-action"
            size="compact"
            disabled={disabled}
            onClick={() => onReview(collection)}
          >
            {t("Review")}
          </Button>
        </div>
      </div>
    );
  });
};

interface SkillCollectionDialogProps {
  collection?: SkillCollectionLinkGroup;
  operation?: CollectionOperation;
  itemProgress?: Record<string, CollectionItemProgress>;
  moveIssue?: Exclude<MoveSkillCollectionOutcome, { status: "moved" }>;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onChangeRetention(collection: SkillCollectionLinkGroup, retained: boolean): void;
  onProcessItem(item: SkillInventoryEntry): void;
  onApplyStrategy(
    collection: SkillCollectionLinkGroup,
    strategy: CollectionResolutionStrategy
  ): void;
  onMove(collection: SkillCollectionLinkGroup): void;
}

export const SkillCollectionDialog = ({
  collection,
  operation,
  itemProgress = {},
  moveIssue,
  dialogRef,
  initialFocusRef,
  onClose,
  onChangeRetention,
  onProcessItem,
  onApplyStrategy,
  onMove
}: SkillCollectionDialogProps) => {
  const { formatDate, t } = useI18n();
  const [strategy, setStrategy] = useState<CollectionResolutionStrategy>("keep-library");
  if (!collection) return null;
  const unresolvedItems = collection.items.filter(
    (item) => !isSkillCollectionItemLibraryReady(item)
  );

  return createPortal(
    <div
      className="preview-modal-backdrop"
      data-dismiss-policy="intentional"
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog skill-collection-dialog ui-dialog-shell"
        role="dialog"
        aria-label={t("Review Skill collection {{name}}", { name: collection.name })}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">{collection.name}</div>
            <p className="muted ui-dialog-description">
              {t("This directory link exposes {{count}} Skills. AgentEnv treats the link as one migration boundary and never changes its source folder.", {
                count: collection.items.length
              })}
            </p>
          </div>
        </header>
        <div className="ui-dialog-body skill-collection-dialog__body">
          <div className="skill-collection-paths">
            <span>
              <small>{t("Runtime link")}</small>
              <PreviewText
                ariaLabel={t("Full collection link path")}
                className="skill-collection-path"
                text={collection.path}
                tooltipClassName="library-source-tooltip"
              />
            </span>
            <span>
              <small>{t("Source folder")}</small>
              <PreviewText
                ariaLabel={t("Full collection source path")}
                className="skill-collection-path"
                text={collection.canonicalPath}
                tooltipClassName="library-source-tooltip"
              />
            </span>
          </div>
          {unresolvedItems.length > 0 ? (
            <section className="skill-collection-strategy">
              <span>
                <strong>{t("Use one strategy")}</strong>
                <small>
                  {t("Apply the same version choice to {{count}} unresolved Skills.", {
                    count: unresolvedItems.length
                  })}
                </small>
              </span>
              <select
                aria-label={t("Collection version strategy")}
                disabled={Boolean(operation)}
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value as CollectionResolutionStrategy);
                }}
              >
                <option value="keep-library">{t("Keep Library versions")}</option>
                <option value="use-collection">{t("Use collection versions")}</option>
              </select>
              <Button
                busy={operation === "import"}
                disabled={Boolean(operation)}
                size="compact"
                variant="secondary"
                onClick={() => onApplyStrategy(collection, strategy)}
              >
                {t("Apply to {{count}}", { count: unresolvedItems.length })}
              </Button>
            </section>
          ) : null}
          <div className="skill-collection-members" role="list">
            {collection.items.map((item) => {
              const exact = Boolean(item.libraryId) && item.contentMatchesLibrary === true;
              const usesLibrary =
                Boolean(item.libraryId) &&
                item.collectionDecision === "use-library";
              const conflict =
                Boolean(item.libraryId) &&
                item.contentMatchesLibrary === false &&
                !usesLibrary;
              const progress = itemProgress[item.path];
              const ready = exact || usesLibrary;
              const status = progress?.state === "working"
                ? t("Processing")
                : progress?.state === "failed"
                  ? t("Failed")
                  : ready
                    ? t("Ready")
                    : conflict
                      ? t("Needs review")
                      : t("Ready to add");
              return (
                <div
                  className="skill-collection-member"
                  key={`${item.skillKey}:${item.path}`}
                  role="listitem"
                >
                  <span
                    className={`skill-collection-member__status skill-collection-member__status--${
                      progress?.state ?? (ready ? "done" : conflict ? "review" : "waiting")
                    }`}
                    role="status"
                    aria-label={t("{{name}}: {{status}}", { name: item.name, status })}
                  >
                    {progress?.state === "working" ? (
                      <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                    ) : progress?.state === "failed" ? (
                      <PreviewText
                        ariaLabel={t("Import failure for {{name}}", { name: item.name })}
                        className="skill-collection-member__failure"
                        displayContent={<XCircle size={16} strokeWidth={2.2} aria-hidden="true" />}
                        text={progress.error ?? t("Import failed")}
                        tooltipClassName="library-source-tooltip import-error-tooltip"
                      />
                    ) : ready || progress?.state === "done" ? (
                      <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                    ) : conflict ? (
                      <CircleAlert size={16} strokeWidth={2.1} aria-hidden="true" />
                    ) : (
                      <Circle size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <span className="skill-collection-member__name">{item.name}</span>
                    <small>
                      {item.version ?? item.modifiedAt
                        ? [
                            item.version,
                            item.modifiedAt ? formatDate(item.modifiedAt) : undefined
                          ].filter(Boolean).join(" · ")
                        : item.skillKey}
                    </small>
                  </span>
                  <span className={`resource-chip resource-chip--${
                    ready ? "managed" : conflict ? "conflict" : "pending"
                  }`}>
                    {t(exact
                      ? "In Library"
                      : usesLibrary
                        ? "Use Library version"
                      : conflict
                        ? "Different Library copy"
                        : "Not in Library")}
                  </span>
                  {!ready ? (
                    <Button
                      disabled={Boolean(operation)}
                      size="compact"
                      variant="secondary"
                      onClick={() => onProcessItem(item)}
                    >
                      {t(conflict ? "Review" : "Add")}
                    </Button>
                  ) : (
                    <span className="skill-collection-member__action-spacer" />
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted skill-collection-dialog__note">
            {collection.state === "ready"
                ? t("Moving saves these Skills in each affected Agent's active Profile and updates only their Agent Skill copies. Other saved Profile changes remain pending. Profiles set to Turn off stay off.")
              : collection.state === "unmanaged"
                ? t("AgentEnv observes this collection but will not change its source or runtime link.")
                : t("Choose a Library version for every Skill before moving. Same-name differences require an explicit choice.")}
          </p>
          {moveIssue ? (
            <div className="inline-state inline-state--error skill-collection-dialog__issue" role="alert">
              <TriangleAlert size={16} strokeWidth={2.1} aria-hidden="true" />
              <span className="inline-state__content">
                <strong>
                  {moveIssue.status === "needs-save"
                    ? t("Save Profile before moving")
                    : t("Could not move collection")}
                </strong>
                <small>{t(moveIssue.message)}</small>
              </span>
            </div>
          ) : null}
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <Button
            ref={initialFocusRef}
            disabled={Boolean(operation)}
            onClick={onClose}
          >
            {t("Close")}
          </Button>
          {collection.state === "unmanaged" ? (
            <Button
              busy={operation === "review"}
              disabled={Boolean(operation)}
              onClick={() => onChangeRetention(collection, false)}
            >
              {t("Manage with AgentEnv")}
            </Button>
          ) : (
            <Button
              busy={operation === "keep"}
              disabled={Boolean(operation)}
              onClick={() => onChangeRetention(collection, true)}
            >
              {t("Leave unmanaged")}
            </Button>
          )}
          {collection.state === "ready" ? (
            <Button
              variant="primary"
              busy={operation === "move"}
              disabled={Boolean(operation)}
              onClick={() => onMove(collection)}
            >
              {moveIssue?.status === "needs-save"
                ? t("Save Profile and move")
                : moveIssue
                  ? t("Retry move")
                  : t("Move collection")}
            </Button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body
  );
};
