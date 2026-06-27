import type { ActivationPreview } from "../../shared/types";

interface PreviewDialogProps {
  preview?: ActivationPreview;
}

export const PreviewDialog = ({ preview }: PreviewDialogProps) => {
  if (!preview) {
    return null;
  }

  return (
    <section className="preview-dialog" aria-label="Preview">
      <header className="preview-header">
        <div>
          <div className="section-title">Preview</div>
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
            <pre>{change.diff}</pre>
          </details>
        ))}
      </div>
    </section>
  );
};
