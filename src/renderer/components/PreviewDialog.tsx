import type { ActivationPreview, RollbackPreview } from "../../shared/types";
import { DiffViewer } from "./DiffViewer";

interface PreviewDialogProps {
  preview?: ActivationPreview | RollbackPreview;
  title?: string;
}

export const PreviewDialog = ({ preview, title = "Preview" }: PreviewDialogProps) => {
  if (!preview) {
    return null;
  }

  return (
    <section className="preview-dialog" aria-label="Preview">
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
    </section>
  );
};
