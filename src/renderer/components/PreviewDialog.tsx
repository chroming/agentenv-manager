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

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const targetLabel = (targetId?: string) => {
  if (targetId === "opencode") return "OpenCode";
  if (targetId === "codex") return "Codex";
  if (targetId === "claude-code") return "Claude Code";
  return "Target";
};

const prettifyIssue = (message: string, targetName: string) => {
  const driftMatch = message.match(
    /^External changes detected in AgentEnv-managed ([^ ]+) [^:]+: (.+)$/
  );
  if (driftMatch) {
    const kind = driftMatch[1] === "instructions" ? "instructions" : driftMatch[1];
    return {
      title: `${targetName} ${kind} changed outside AgentEnv`,
      detail: driftMatch[2]
    };
  }

  const keptMatch = message.match(/^(Unmanaged|Ignored) local skill kept: (.+)$/);
  if (keptMatch) {
    return {
      title: `${keptMatch[1]} local skill kept`,
      detail: keptMatch[2]
    };
  }

  return { title: message };
};

const isInstallChange = (change: ActivationPreview["changes"][number]) =>
  change.before.trim().length === 0 || /\/skills?\//.test(change.path);

const isReplaceChange = (change: ActivationPreview["changes"][number]) =>
  !isInstallChange(change);

export const PreviewDialog = ({
  preview,
  title = "Preview",
  confirmDisabled = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm
}: PreviewDialogProps) => {
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

  if (!preview) {
    return null;
  }

  const targetName = "targetId" in preview ? targetLabel(preview.targetId) : "Target";
  const blockedItems = preview.errors.map((error) => prettifyIssue(error, targetName));
  const keepItems = preview.warnings.map((warning) => prettifyIssue(warning, targetName));
  const installChanges = "targetId" in preview ? preview.changes.filter(isInstallChange) : [];
  const replaceChanges = "targetId" in preview ? preview.changes.filter(isReplaceChange) : preview.changes;
  const fileCountLabel = plural(preview.changes.length, "file");

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
          <p className="muted">{fileCountLabel} in this diff</p>
        </div>
        <time dateTime={preview.createdAt}>{new Date(preview.createdAt).toLocaleString()}</time>
      </header>
      <section className="preview-summary-grid" aria-label="Apply summary">
        <section className={`preview-summary-card${blockedItems.length > 0 ? " is-blocked" : ""}`}>
          <strong>Blocked</strong>
          <span>{blockedItems.length > 0 ? plural(blockedItems.length, "issue") : "No blockers"}</span>
          {blockedItems.map((item) => (
            <p className="error" key={`${item.title}${item.detail ?? ""}`}>
              {item.title}
              {item.detail ? <small>{item.detail}</small> : null}
            </p>
          ))}
        </section>
        <section className="preview-summary-card">
          <strong>Will keep</strong>
          <span>{keepItems.length > 0 ? plural(keepItems.length, "item") : "Nothing unmanaged"}</span>
          {keepItems.map((item) => (
            <p className="warning" key={`${item.title}${item.detail ?? ""}`}>
              {item.title}
              {item.detail ? <small>{item.detail}</small> : null}
            </p>
          ))}
        </section>
        <section className="preview-summary-card">
          <strong>Will replace</strong>
          <span>{replaceChanges.length > 0 ? plural(replaceChanges.length, "file") : "No existing files"}</span>
        </section>
        <section className="preview-summary-card">
          <strong>Will install</strong>
          <span>{installChanges.length > 0 ? plural(installChanges.length, "resource") : "No new resources"}</span>
        </section>
      </section>
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
