import { useEffect, useRef } from "react";
import type {
  ActivationPreview,
  RollbackPreview,
  StopManagingPreview
} from "../../shared/types";
import { DiffViewer } from "./DiffViewer";

interface PreviewDialogProps {
  preview?: ActivationPreview | RollbackPreview | StopManagingPreview;
  title?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  errorMessage?: string;
  managedDriftAcknowledged?: boolean;
  onManagedDriftAcknowledgedChange?(acknowledged: boolean): void;
  omissionsAcknowledged?: boolean;
  onOmissionsAcknowledgedChange?(acknowledged: boolean): void;
  onOpenRecovery?(): void;
  onAdoptInstructions?(): void;
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
  cancelDisabled = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  errorMessage,
  managedDriftAcknowledged = false,
  onManagedDriftAcknowledgedChange,
  omissionsAcknowledged = false,
  onOmissionsAcknowledgedChange,
  onOpenRecovery,
  onAdoptInstructions,
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
    if (dialogRef.current) {
      dialogRef.current.scrollTop = 0;
    }
    cancelButtonRef.current?.focus({ preventScroll: true });

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

  const targetName =
    "targetName" in preview
      ? preview.targetName
      : "targetId" in preview
        ? targetLabel(preview.targetId)
        : "Target";
  const isActivationPreview = "profileId" in preview;
  const blockedItems = preview.errors.map((error) => prettifyIssue(error, targetName));
  const managedDriftErrors = preview.errors.filter((error) =>
    error.startsWith("External changes detected in AgentEnv-managed")
  );
  const omissionReasons = new Set(
    isActivationPreview ? (preview.omissions ?? []).map((omission) => omission.reason) : []
  );
  const keepItems = preview.warnings
    .filter((warning) => !omissionReasons.has(warning))
    .map((warning) => prettifyIssue(warning, targetName));
  const resourceChanges = "resourceChanges" in preview ? preview.resourceChanges : [];
  const installChanges = resourceChanges.filter((change) => change.action === "install");
  const replaceChanges = resourceChanges.filter((change) => change.action === "replace");
  const removeChanges = resourceChanges.filter((change) => change.action === "remove");
  const fileCountLabel = plural(preview.changes.length, "file");
  const resourceCountLabel = plural(resourceChanges.length, "resource");
  const payload = isActivationPreview ? preview.effectivePayload : undefined;
  const payloadParts = payload
    ? [
        payload.instructions > 0 ? plural(payload.instructions, "instruction file") : undefined,
        payload.skills > 0 ? plural(payload.skills, "Skill") : undefined,
        payload.mcpServers > 0 ? plural(payload.mcpServers, "MCP server") : undefined,
        payload.agents > 0 ? plural(payload.agents, "Agent") : undefined,
        payload.nativeConfig > 0 ? plural(payload.nativeConfig, "native config") : undefined
      ].filter((item): item is string => Boolean(item))
    : [];
  const outcomeText = isActivationPreview
    ? payloadParts.length > 0
      ? `${targetName} will receive ${payloadParts.join(", ")}.`
      : `${targetName} has no effective Profile payload.`
    : "mode" in preview
      ? preview.mode === "keep-current"
        ? `${targetName} files will stay in place and AgentEnv ownership will be removed.`
        : `${targetName} will be restored to its pre-takeover environment.`
      : `${fileCountLabel} reviewed before restore.`;

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
          <p className="preview-outcome">{outcomeText}</p>
        </div>
        <time dateTime={preview.createdAt}>{new Date(preview.createdAt).toLocaleString()}</time>
      </header>
      <section className="preview-summary-grid" aria-label="Apply summary">
        {blockedItems.length > 0 ? (
          <section className="preview-summary-card is-blocked">
            <strong>Blocking issues</strong>
            <span>{plural(blockedItems.length, "issue")}</span>
            {blockedItems.map((item) => (
              <p className="error" key={`${item.title}${item.detail ?? ""}`}>
                {item.title}
                {item.detail ? <small>{item.detail}</small> : null}
              </p>
            ))}
          </section>
        ) : null}
        {keepItems.length > 0 ? (
          <section className="preview-summary-card">
            <strong>Will preserve</strong>
            <span>{plural(keepItems.length, "unmanaged item")}</span>
            {keepItems.map((item) => (
              <p className="warning" key={`${item.title}${item.detail ?? ""}`}>
                {item.title}
                {item.detail ? <small>{item.detail}</small> : null}
              </p>
            ))}
          </section>
        ) : null}
        {preview.changes.length > 0 ? (
          <section className="preview-summary-card">
            <strong>Configuration changes</strong>
            <span>{`${fileCountLabel} changed`}</span>
          </section>
        ) : null}
        {resourceChanges.length > 0 ? (
          <section className="preview-summary-card">
            <strong>Resource changes</strong>
            <span>{`${installChanges.length} install · ${replaceChanges.length} replace · ${removeChanges.length} remove`}</span>
          </section>
        ) : null}
      </section>
      {managedDriftErrors.length > 0 && onManagedDriftAcknowledgedChange ? (
        <section className="preview-drift-recovery" aria-label="External change recovery">
          <div>
            <strong>External changes are protected</strong>
            <p>
              Cancel keeps the target unchanged. Continuing creates a backup, then replaces the
              managed resources shown above.
            </p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={managedDriftAcknowledged}
              onChange={(event) => onManagedDriftAcknowledgedChange(event.currentTarget.checked)}
            />
            I understand; back up and replace these changes
          </label>
          {onOpenRecovery ? (
            <div className="preview-drift-actions">
              {onAdoptInstructions ? (
                <button className="secondary-action" type="button" onClick={onAdoptInstructions}>
                  Adopt live instructions
                </button>
              ) : null}
              <button className="secondary-action" type="button" onClick={onOpenRecovery}>
                Open recovery history
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {preview && "omissions" in preview && (preview.omissions?.length ?? 0) > 0 ? (
        <section className="preview-drift-recovery preview-omission-review" aria-label="Cross-target omissions">
          <div>
            <strong>Not included for {targetName}</strong>
            <p>These native Profile resources are not compatible with the selected Target.</p>
          </div>
          <ul>
            {preview.omissions?.map((omission) => (
              <li key={`${omission.kind}:${omission.name}`}>
                <strong>{omission.name}</strong>
                <span>{omission.reason}</span>
              </li>
            ))}
          </ul>
          {onOmissionsAcknowledgedChange ? (
            <label>
              <input
                type="checkbox"
                checked={omissionsAcknowledged}
                onChange={(event) => onOmissionsAcknowledgedChange(event.currentTarget.checked)}
              />
              I understand these resources will not be applied to {targetName}
            </label>
          ) : null}
        </section>
      ) : null}
      {resourceChanges.length > 0 ? (
        <section className="preview-resource-plan" aria-label="Resource changes">
          <header>
            <strong>Resource changes</strong>
            <span>{resourceCountLabel}</span>
          </header>
          <div>
            {resourceChanges.map((change) => (
              <article key={`${change.action}:${change.path}`}>
                <span className={`change-kind change-kind--${change.action}`}>
                  {change.action}
                </span>
                <span className="preview-resource-plan__identity">
                  <strong>{change.name}</strong>
                  <small title={change.path}>{change.path}</small>
                </span>
                <span className="preview-resource-plan__kind">{change.kind}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
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
      {errorMessage ? (
        <p className="error preview-action-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {hasActions ? (
        <footer className="preview-actions">
          <button
            ref={cancelButtonRef}
            className="secondary-action"
            type="button"
            disabled={cancelDisabled}
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
