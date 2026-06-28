import { useEffect, useRef } from "react";
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

const FOCUSABLE_SELECTOR = [
  "summary",
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

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

const lineCount = (text: string) => {
  if (text.length === 0) {
    return 0;
  }
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
};

const changeKind = (change: ActivationPreview["changes"][number]) => {
  if (change.before.length === 0 && change.after.length > 0) {
    return "Add";
  }
  if (change.before.length > 0 && change.after.length === 0) {
    return "Remove";
  }
  return "Replace";
};

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
  const isModalOpen = Boolean(preview && hasActions);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isModalOpen) {
      return undefined;
    }

    const invokingControl =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      const modalDialogs = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-modal="true"]'
      );
      const topmostDialog = modalDialogs.item(modalDialogs.length - 1);
      if (!dialog || topmostDialog !== dialog) {
        return;
      }

      if (event.key === "Escape") {
        if (onCancelRef.current) {
          event.preventDefault();
          onCancelRef.current();
        }
        return;
      }

      const focusableControls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusableControls.length === 0) {
        return;
      }

      const firstControl = focusableControls[0];
      const lastControl = focusableControls.at(-1);
      if (!focusableControls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        if (event.shiftKey) {
          lastControl?.focus();
        } else {
          firstControl.focus();
        }
        return;
      }

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (invokingControl?.isConnected) {
        invokingControl.focus();
      }
    };
  }, [isModalOpen]);

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
      ref={dialogRef}
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
            <summary>
              <span>{change.path}</span>
              <strong className={`change-kind change-kind--${changeKind(change).toLowerCase()}`}>
                {changeKind(change)}
              </strong>
            </summary>
            <div className="diff-file-meta">
              <span>{plural(lineCount(change.before), "line")} before</span>
              <span>{plural(lineCount(change.after), "line")} after</span>
            </div>
            <DiffViewer path={change.path} diff={change.diff} />
          </details>
        ))}
      </div>
      {hasActions ? (
        <footer className="preview-actions">
          <button
            ref={cancelButtonRef}
            className="secondary-action"
            type="button"
            onClick={onCancel}
          >
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
