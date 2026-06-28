import { useEffect } from "react";
import type { ActivationPreview, RollbackPreview } from "../../shared/types";
import { DiffViewer } from "./DiffViewer";

interface PreviewDialogProps {
  preview?: ActivationPreview | RollbackPreview;
  title?: string;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel?(): void;
  onConfirm?(): void;
}

export const PreviewDialog = ({
  preview,
  title = "Preview",
  confirmDisabled = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm
}: PreviewDialogProps) => {
  if (!preview) {
    return null;
  }

  const hasActions = Boolean(onCancel || onConfirm);

  useEffect(() => {
    if (!hasActions || !onCancel) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hasActions, onCancel]);

  const content = (
    <section
      className={`preview-dialog${hasActions ? " preview-dialog--modal" : ""}`}
      role={hasActions ? "dialog" : undefined}
      aria-label="Preview"
      aria-modal={hasActions ? true : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="preview-header">
        <div>
          <div className="section-title">{title}</div>
          <p className="muted">{preview.changes.length} files in this diff</p>
        </div>
        <time dateTime={preview.createdAt}>{new Date(preview.createdAt).toLocaleString()}</time>
      </header>
      {preview.warnings.map((warning) => (
        <p className="warning" key={warning}>
          {warning}
        </p>
      ))}
      {preview.errors.map((error) => (
        <p className="error" key={error}>
          {error}
        </p>
      ))}
      <div className="diff-list">
        {preview.changes.map((change) => (
          <details key={change.path} open>
            <summary>{change.path}</summary>
            <DiffViewer path={change.path} diff={change.diff} />
          </details>
        ))}
      </div>
      {hasActions ? (
        <footer className="preview-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      ) : null}
    </section>
  );

  if (!hasActions) {
    return content;
  }

  return (
    <div className="preview-modal-backdrop" onClick={onCancel}>
      {content}
    </div>
  );
};
