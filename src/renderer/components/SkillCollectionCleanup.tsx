import { useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Folder, LoaderCircle } from "lucide-react";
import {
  isSkillCollectionItemLibraryReady,
  type SkillCollectionLinkGroup
} from "../../shared/skillCleanup";
import type {
  SkillInventoryEntry,
  SkillPathPolicyUpdate
} from "../../shared/types";
import { useI18n } from "../i18n";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";

type CollectionOperation = "import" | "keep" | "review" | "move";

interface SkillCollectionActionsInput {
  onSetSkillPathPolicies?(input: SkillPathPolicyUpdate): Promise<boolean>;
  onImportUnmanaged(
    path: string,
    sourceHandling?: "copy-only",
    deferFullRefresh?: boolean
  ): Promise<boolean>;
  onResolveCollectionConflict?(item: SkillInventoryEntry): Promise<boolean>;
  onRefreshInventory(announce?: boolean): Promise<void>;
  onMoveSkillCollection?(collection: SkillCollectionLinkGroup): Promise<boolean>;
  onClose(): void;
}

export const useSkillCollectionActions = ({
  onSetSkillPathPolicies,
  onImportUnmanaged,
  onResolveCollectionConflict,
  onRefreshInventory,
  onMoveSkillCollection,
  onClose
}: SkillCollectionActionsInput) => {
  const [operation, setOperation] = useState<CollectionOperation>();

  const changeRetention = async (
    collection: SkillCollectionLinkGroup,
    retained: boolean
  ) => {
    if (!onSetSkillPathPolicies || operation) return;
    setOperation(retained ? "keep" : "review");
    try {
      await onSetSkillPathPolicies({
        items: [{ path: collection.path, skillKey: "_collection" }],
        mode: retained ? "keep-shared" : undefined
      });
    } finally {
      setOperation(undefined);
    }
  };

  const importSkills = async (collection: SkillCollectionLinkGroup) => {
    if (operation) return;
    setOperation("import");
    try {
      const conflict = collection.items.find(
        (item) =>
          item.libraryId &&
          item.contentMatchesLibrary === false &&
          item.pathPolicy !== "use-library"
      );
      if (conflict) {
        if (onResolveCollectionConflict) {
          await onResolveCollectionConflict(conflict);
        } else {
          await onImportUnmanaged(conflict.path, "copy-only");
        }
        return;
      }
      for (const item of collection.items) {
        if (isSkillCollectionItemLibraryReady(item)) continue;
        if (!(await onImportUnmanaged(item.path, "copy-only", true))) return;
      }
      await onRefreshInventory(false);
    } finally {
      setOperation(undefined);
    }
  };

  const move = async (collection: SkillCollectionLinkGroup) => {
    if (!onMoveSkillCollection || operation || collection.state !== "ready") return;
    setOperation("move");
    try {
      if (await onMoveSkillCollection(collection)) onClose();
    } finally {
      setOperation(undefined);
    }
  };

  return { operation, changeRetention, importSkills, move };
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
        : collection.state === "kept"
          ? t("Kept")
          : collection.state === "conflict"
            ? t("Needs review")
            : t("{{count}} of {{total}} in Library", {
                count: collection.libraryReadyCount,
                total: collection.items.length
              });
    const stateClass =
      collection.state === "ready"
        ? "managed"
        : collection.state === "kept"
          ? "kept-outside"
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
          <button
            className="secondary-action cleanup-current-action"
            type="button"
            disabled={disabled}
            onClick={() => onReview(collection)}
          >
            {t("Review")}
          </button>
        </div>
      </div>
    );
  });
};

interface SkillCollectionDialogProps {
  collection?: SkillCollectionLinkGroup;
  operation?: CollectionOperation;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onChangeRetention(collection: SkillCollectionLinkGroup, retained: boolean): void;
  onImport(collection: SkillCollectionLinkGroup): void;
  onMove(collection: SkillCollectionLinkGroup): void;
}

export const SkillCollectionDialog = ({
  collection,
  operation,
  dialogRef,
  initialFocusRef,
  onClose,
  onChangeRetention,
  onImport,
  onMove
}: SkillCollectionDialogProps) => {
  const { formatDate, t } = useI18n();
  if (!collection) return null;

  return createPortal(
    <div className="preview-modal-backdrop" onClick={operation ? undefined : onClose}>
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
          <div className="skill-collection-members" role="list">
            {collection.items.map((item) => {
              const exact = Boolean(item.libraryId) && item.contentMatchesLibrary === true;
              const usesLibrary =
                Boolean(item.libraryId) && item.pathPolicy === "use-library";
              const conflict =
                Boolean(item.libraryId) &&
                item.contentMatchesLibrary === false &&
                !usesLibrary;
              return (
                <div
                  className="skill-collection-member"
                  key={`${item.skillKey}:${item.path}`}
                  role="listitem"
                >
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
                    exact || usesLibrary ? "managed" : conflict ? "conflict" : "pending"
                  }`}>
                    {t(exact
                      ? "In Library"
                      : usesLibrary
                        ? "Use Library version"
                      : conflict
                        ? "Different Library copy"
                        : "Not in Library")}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted skill-collection-dialog__note">
            {collection.state === "ready"
              ? t("Moving adds these Skills to each affected Agent's active Profile, applies those Profiles, verifies every Agent copy, then removes only the collection link.")
              : collection.state === "kept"
                ? t("This collection stays outside AgentEnv. Its source and runtime link remain unchanged.")
                : t("Choose a Library version for every Skill before moving. Same-name differences require an explicit choice.")}
          </p>
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <button
            ref={initialFocusRef}
            className="secondary-action"
            type="button"
            disabled={Boolean(operation)}
            onClick={onClose}
          >
            {t("Close")}
          </button>
          {collection.state === "kept" ? (
            <button
              className="secondary-action"
              type="button"
              aria-busy={operation === "review"}
              disabled={Boolean(operation)}
              onClick={() => onChangeRetention(collection, false)}
            >
              {operation === "review" ? (
                <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
              ) : null}
              {t("Review again")}
            </button>
          ) : (
            <button
              className="secondary-action"
              type="button"
              aria-busy={operation === "keep"}
              disabled={Boolean(operation)}
              onClick={() => onChangeRetention(collection, true)}
            >
              {operation === "keep" ? (
                <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
              ) : null}
              {t("Keep external")}
            </button>
          )}
          {collection.state !== "kept" ? (
            <button
              className="primary-action"
              type="button"
              aria-busy={operation === "import" || operation === "move"}
              disabled={Boolean(operation)}
              onClick={() => (
                collection.state === "ready" ? onMove(collection) : onImport(collection)
              )}
            >
              {operation === "import" || operation === "move" ? (
                <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
              ) : null}
              {collection.state === "ready"
                ? t("Move collection")
                : collection.state === "conflict"
                  ? t("Resolve differences")
                  : t("Add missing to Library")}
            </button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body
  );
};
