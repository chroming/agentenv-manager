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
      <div className="section-title">Preview</div>
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
