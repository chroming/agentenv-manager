import { LoaderCircle, Maximize2 } from "lucide-react";
import { useMemo, useRef, useState, type RefObject } from "react";
import type {
  SkillImportConflictResolution,
  SkillImportPreview
} from "../../shared/types";
import { useI18n } from "../i18n";
import { DiffViewer } from "./DiffViewer";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { Button } from "./ui";

export interface PendingSkillImport {
  preview: SkillImportPreview;
  resolve: (resolution: SkillImportConflictResolution | undefined) => void;
  committing?: boolean;
}

interface SkillImportConflictDialogProps {
  pending: PendingSkillImport;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onDismiss(): void;
  onConfirm(resolution: SkillImportConflictResolution): void;
}

type ImportDecision = "keep-existing" | "replace" | "keep-both";

export const SkillImportConflictDialog = ({
  pending,
  dialogRef,
  initialFocusRef,
  onDismiss,
  onConfirm
}: SkillImportConflictDialogProps) => {
  const { t, formatDate } = useI18n();
  const expandPreviewRef = useRef<HTMLButtonElement>(null);
  const preferredConflict = useMemo(
    () =>
      pending.preview.conflicts.find((conflict) => conflict.sourceUpdateAvailable) ??
      pending.preview.conflicts.find((conflict) => conflict.identical) ??
      pending.preview.conflicts[0],
    [pending.preview.conflicts]
  );
  const [selectedConflictId, setSelectedConflictId] = useState(
    preferredConflict.existing.id
  );
  const [decision, setDecision] = useState<ImportDecision>(
    preferredConflict.contentIdentical ? "keep-both" : "replace"
  );
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const selectedConflict =
    pending.preview.conflicts.find(
      (conflict) => conflict.existing.id === selectedConflictId
    ) ?? preferredConflict;
  const confirm = () => {
    if (selectedConflict.sourceUpdateAvailable) {
      onConfirm({
        action: "update-source",
        existingId: selectedConflict.existing.id
      });
    } else if (selectedConflict.identical) {
      onConfirm({ action: "reuse", existingId: selectedConflict.existing.id });
    } else if (decision === "keep-existing") {
      onConfirm({
        action: "keep-existing",
        existingId: selectedConflict.existing.id
      });
    } else if (decision === "replace") {
      onConfirm({ action: "replace", existingId: selectedConflict.existing.id });
    } else {
      onConfirm({
        action: "keep-both",
        id: pending.preview.suggestedDuplicateId
      });
    }
  };
  const confirmLabel = pending.committing
    ? t("Importing...")
    : selectedConflict.sourceUpdateAvailable
      ? t("Update source")
      : selectedConflict.identical
        ? t("Use existing")
        : decision === "keep-existing"
          ? t("Keep Library copy")
          : decision === "replace"
            ? t("Replace Skill")
            : t("Save another Skill");

  return (
    <>
      <div
        className={`preview-modal-backdrop skill-import-conflict-backdrop${diffWorkspaceOpen ? " is-suspended" : ""}`}
        data-dismiss-policy="intentional"
      >
      <section
        ref={dialogRef}
        className="profile-form-dialog skill-import-conflict-dialog ui-dialog-shell"
        role="dialog"
        aria-hidden={diffWorkspaceOpen || undefined}
        aria-modal={diffWorkspaceOpen ? undefined : "true"}
        inert={diffWorkspaceOpen || undefined}
        aria-label={t("Review duplicate Skill")}
        aria-busy={pending.committing}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">
              {t(
                selectedConflict.match === "id"
                  ? "A Skill with this Library ID already exists"
                  : "A Skill with this name already exists"
              )}
            </div>
            <p className="muted ui-dialog-description">
              {selectedConflict.sourceUpdateAvailable
                ? t("The content matches, and the incoming Skill adds a tracked online source.")
                : selectedConflict.identical
                  ? t("The incoming Skill is identical to the Library copy.")
                  : t("Review the versions, sources, and file changes before choosing which copy to keep.")}
            </p>
          </div>
          <span
            className={`skill-import-match-state${selectedConflict.identical ? " is-identical" : " is-different"}`}
          >
            {t(
              selectedConflict.sourceUpdateAvailable
                ? "Source available"
                : selectedConflict.identical
                  ? "Identical"
                  : "Different"
            )}
          </span>
        </header>

        <div className="ui-dialog-body skill-import-conflict-dialog__body">
          {pending.preview.conflicts.length > 1 ? (
            <div
              className="skill-import-existing-picker"
              role="radiogroup"
              aria-label={t("Existing Skills with the same name")}
            >
              {pending.preview.conflicts.map((conflict) => (
                <button
                  type="button"
                  disabled={pending.committing}
                  role="radio"
                  aria-checked={conflict.existing.id === selectedConflict.existing.id}
                  className={
                    conflict.existing.id === selectedConflict.existing.id
                      ? "is-selected"
                      : ""
                  }
                  key={conflict.existing.id}
                  onClick={() => {
                    setSelectedConflictId(conflict.existing.id);
                    setDecision(conflict.contentIdentical ? "keep-both" : "replace");
                  }}
                >
                  <strong>{conflict.existing.id}</strong>
                  <span>
                    {t(
                      conflict.sourceUpdateAvailable
                        ? "Source available"
                        : conflict.identical
                          ? "Identical"
                          : "Different"
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="skill-import-comparison-summary">
            {[
              { label: t("Library copy"), item: selectedConflict.existing },
              { label: t("Incoming copy"), item: pending.preview.incoming }
            ].map(({ label, item }) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{item.name}</strong>
                <dl>
                  <div>
                    <dt>{t("Version")}</dt>
                    <dd>{item.version ?? t("Not declared")}</dd>
                  </div>
                  <div>
                    <dt>{t("Hash")}</dt>
                    <dd>
                      <code title={item.contentHash}>
                        {item.contentHash.slice(0, 12)}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Source")}</dt>
                    <dd title={item.source}>
                      {item.sourceType === "github" || item.sourceType === "git"
                        ? item.source
                        : t("Local")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Modified")}</dt>
                    <dd title={item.upstream?.updatedAt ?? item.modifiedAt}>
                      {item.upstream?.updatedAt || item.modifiedAt
                        ? formatDate(item.upstream?.updatedAt ?? item.modifiedAt!)
                        : t("Unknown")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("ID")}</dt>
                    <dd>
                      <code>{item.id}</code>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="skill-import-file-review">
            <div className="skill-import-file-review__header">
              <div>
                <strong>{t("SKILL.md preview")}</strong>
                <span>
                  {selectedConflict.changes.length === 0
                    ? t("No file changes")
                    : t("{{count}} changed files", {
                        count: selectedConflict.changes.length
                      })}
                </span>
              </div>
              {selectedConflict.changes.length > 0 ? (
                <Button
                  ref={expandPreviewRef}
                  icon={<Maximize2 size={14} />}
                  size="compact"
                  variant="ghost"
                  onClick={() => setDiffWorkspaceOpen(true)}
                >
                  {t("Expand preview")}
                </Button>
              ) : null}
            </div>
            {selectedConflict.changes.length > 0 ? (
              <div className="diff-list">
                {selectedConflict.changes.map((change) => (
                  <div className="diff-file" key={change.path}>
                    <div className="diff-file-meta">
                      <strong>{change.path}</strong>
                    </div>
                    <DiffViewer path={change.path} diff={change.diff} />
                  </div>
                ))}
              </div>
            ) : (
              <pre className="skill-import-identical-preview">
                {pending.preview.incoming.skillMarkdown}
              </pre>
            )}
          </div>

          {!selectedConflict.contentIdentical ? (
            <div
              className="skill-import-decisions"
              role="radiogroup"
              aria-label={t("Import decision")}
            >
              <label className={decision === "keep-existing" ? "is-selected" : ""}>
                <input
                  type="radio"
                  disabled={pending.committing}
                  name="skill-import-decision"
                  checked={decision === "keep-existing"}
                  onChange={() => setDecision("keep-existing")}
                />
                <span>
                  <strong>{t("Keep Library copy")}</strong>
                  <small>
                    {t("Skip this import. The current Library copy stays unchanged.")}
                  </small>
                </span>
              </label>
              <label className={decision === "replace" ? "is-selected" : ""}>
                <input
                  type="radio"
                  disabled={pending.committing}
                  name="skill-import-decision"
                  checked={decision === "replace"}
                  onChange={() => setDecision("replace")}
                />
                <span>
                  <strong>{t("Replace Library copy")}</strong>
                  <small>
                    {t(
                      "Profiles keep the same Skill reference. The current Library copy is backed up."
                    )}
                  </small>
                </span>
              </label>
              <label className={decision === "keep-both" ? "is-selected" : ""}>
                <input
                  type="radio"
                  disabled={pending.committing}
                  name="skill-import-decision"
                  checked={decision === "keep-both"}
                  onChange={() => setDecision("keep-both")}
                />
                <span>
                  <strong>{t("Keep both")}</strong>
                  <small>
                    {t("Save the incoming Skill under a different Library ID.")}
                  </small>
                </span>
                <span className="skill-import-decision-id">
                  <span>{t("Library ID")}</span>
                  <code title={pending.preview.suggestedDuplicateId}>
                    {pending.preview.suggestedDuplicateId}
                  </code>
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <footer className="preview-actions ui-dialog-footer">
          <button
            ref={initialFocusRef}
            className="secondary-action"
            type="button"
            disabled={pending.committing}
            onClick={onDismiss}
          >
            {t("Cancel")}
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={Boolean(pending.committing)}
            onClick={confirm}
          >
            {pending.committing ? (
              <LoaderCircle
                className="is-spinning"
                size={15}
                aria-hidden="true"
              />
            ) : null}
            <span>{confirmLabel}</span>
          </button>
        </footer>
      </section>
      </div>
      <DiffWorkspaceDialog
        changes={selectedConflict.changes}
        open={diffWorkspaceOpen}
        returnFocusRef={expandPreviewRef}
        title={t("SKILL.md preview")}
        onClose={() => setDiffWorkspaceOpen(false)}
      />
    </>
  );
};
