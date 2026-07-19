import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, FileText, Folder, LoaderCircle, Puzzle } from "lucide-react";
import type {
  ActivationPreview,
  RollbackPreview,
  StopManagingPreview
} from "../../shared/types";
import { DiffViewer } from "./DiffViewer";
import { OverflowTooltip } from "./OverflowTooltip";
import { useI18n, type TranslationValues } from "../i18n";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";

interface PreviewDialogProps {
  preview?: ActivationPreview | RollbackPreview | StopManagingPreview;
  title?: string;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  cancelDisabled?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  errorMessage?: string;
  targetNames?: TargetNameIndex;
  replacementAcknowledged?: boolean;
  onReplacementAcknowledgedChange?(acknowledged: boolean): void;
  omissionsAcknowledged?: boolean;
  onOmissionsAcknowledgedChange?(acknowledged: boolean): void;
  onOpenRecovery?(): void;
  onAdoptTargetChanges?(): void;
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

const prettifyIssue = (
  message: string,
  targetName: string,
  t: (message: string, values?: TranslationValues) => string
) => {
  const driftMatch = message.match(
    /^External changes detected in AgentEnv-managed ([^ ]+) [^:]+: (.+)$/
  );
  if (driftMatch) {
    const kind = driftMatch[1] === "instructions" ? "instructions" : driftMatch[1];
    return {
      title: t("{{target}} {{kind}} changed outside AgentEnv", { target: targetName, kind }),
      detail: driftMatch[2]
    };
  }

  const keptMatch = message.match(/^(Unmanaged|Ignored) local skill kept: (.+)$/);
  if (keptMatch) {
    return {
      title: t("{{status}} local skill kept", { status: t(keptMatch[1]) }),
      detail: keptMatch[2]
    };
  }

  const unmanagedSkillMatch = message.match(
    /^skill target already exists and is not AgentEnv-owned: (.+)$/i
  );
  if (unmanagedSkillMatch) {
    return {
      title: t("Existing unmanaged Skill will be replaced"),
      detail: unmanagedSkillMatch[1]
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

const resourceChangeIcon = (kind: ActivationPreview["resourceChanges"][number]["kind"]) => {
  if (kind === "skill") return <Puzzle size={16} strokeWidth={2.1} />;
  if (kind === "agent") return <Bot size={16} strokeWidth={2.1} />;
  if (kind === "directory") return <Folder size={16} strokeWidth={2.1} />;
  return <FileText size={16} strokeWidth={2.1} />;
};

export const PreviewDialog = ({
  preview,
  title = "Preview",
  confirmDisabled = false,
  confirmBusy = false,
  cancelDisabled = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  errorMessage,
  targetNames = {},
  replacementAcknowledged = false,
  onReplacementAcknowledgedChange,
  omissionsAcknowledged = false,
  onOmissionsAcknowledgedChange,
  onOpenRecovery,
  onAdoptTargetChanges,
  onCancel,
  onConfirm
}: PreviewDialogProps) => {
  const { t, formatDate } = useI18n();
  const plural = (count: number, noun: string) =>
    t(`{{count}} ${noun}${count === 1 ? "" : "s"}`, { count });
  const hasActions = Boolean(onCancel || onConfirm);
  const isModalOpen = Boolean(preview && hasActions);
  const dialogRef = useRef<HTMLElement>(null);
  const resourceListRef = useRef<HTMLDivElement>(null);
  const diffListRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [hiddenResourceCount, setHiddenResourceCount] = useState(0);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const updateResourceOverflow = () => {
    const list = resourceListRef.current;
    if (!list) {
      setHiddenResourceCount(0);
      return;
    }
    const visibleBottom = list.getBoundingClientRect().bottom;
    const hiddenCount = [...list.children].filter(
      (child) =>
        child instanceof HTMLElement &&
        child.getBoundingClientRect().bottom > visibleBottom + 1
    ).length;
    setHiddenResourceCount(hiddenCount);
  };

  const reviewConfigurationChanges = () => {
    const firstChange = diffListRef.current?.querySelector<HTMLDetailsElement>("details");
    const firstSummary = firstChange?.querySelector<HTMLElement>("summary");
    if (!firstChange || !firstSummary) return;
    firstChange.open = true;
    firstChange.scrollIntoView?.({ behavior: "smooth", block: "start" });
    window.setTimeout(() => firstSummary.focus({ preventScroll: true }), 180);
  };

  useEffect(() => {
    if (!preview) {
      setHiddenResourceCount(0);
      return undefined;
    }
    const frame = window.requestAnimationFrame(updateResourceOverflow);
    window.addEventListener("resize", updateResourceOverflow);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateResourceOverflow);
    };
  }, [preview]);

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
        ? targetNameFor(preview.targetId, targetNames, "Agent")
        : "Agent";
  const isActivationPreview = "profileId" in preview;
  const blockedItems = preview.errors.map((error) => prettifyIssue(error, targetName, t));
  const managedDriftErrors = preview.errors.filter((error) =>
    error.startsWith("External changes detected in AgentEnv-managed")
  );
  const replaceableTargetPaths = new Set(
    isActivationPreview ? (preview.replaceableTargetPaths ?? []) : []
  );
  const unmanagedReplacementErrors = preview.errors.filter((error) => {
    const path = error.match(
      /^skill target already exists and is not AgentEnv-owned: (.+)$/i
    )?.[1];
    return Boolean(path && replaceableTargetPaths.has(path));
  });
  const protectedReplacementErrors = [
    ...managedDriftErrors,
    ...unmanagedReplacementErrors
  ];
  const omissionReasons = new Set(
    isActivationPreview ? (preview.omissions ?? []).map((omission) => omission.reason) : []
  );
  const keepItems = preview.warnings
    .filter((warning) => !omissionReasons.has(warning))
    .map((warning) => prettifyIssue(warning, targetName, t));
  const resourceChanges = "resourceChanges" in preview ? preview.resourceChanges : [];
  const installChanges = resourceChanges.filter((change) => change.action === "install");
  const replaceChanges = resourceChanges.filter((change) => change.action === "replace");
  const removeChanges = resourceChanges.filter((change) => change.action === "remove");
  const fileCountLabel = plural(preview.changes.length, "file");
  const payload = isActivationPreview ? preview.effectivePayload : undefined;
  const sharedPreparations = isActivationPreview
    ? (preview.sharedSkillPreparations ?? [])
    : [];
  const sharedPreparationChanged = isActivationPreview
    ? preview.sharedSkillPreparationChanged === true
    : false;
  const payloadParts = payload
    ? [
        payload.instructions > 0 ? plural(payload.instructions, "instruction file") : undefined,
        payload.skills > 0 ? plural(payload.skills, "Skill") : undefined,
        payload.mcpServers > 0 ? plural(payload.mcpServers, "MCP server") : undefined,
        payload.agents > 0 ? plural(payload.agents, "Agent") : undefined,
        payload.nativeConfig > 0 ? plural(payload.nativeConfig, "native config") : undefined
      ].filter((item): item is string => Boolean(item))
    : [];
  const managedOutcomeText = isActivationPreview
    ? payloadParts.length > 0
      ? t("{{target}} will receive {{payload}}.", { target: targetName, payload: payloadParts.join(", ") })
      : t("{{target}} has no effective Profile payload.", { target: targetName })
    : "mode" in preview
      ? preview.mode === "keep-current"
        ? t("{{target}} files will stay in place and AgentEnv ownership will be removed.", { target: targetName })
        : t("{{target}} will be restored to its pre-takeover environment.", { target: targetName })
      : t("{{files}} reviewed before restore.", { files: fileCountLabel });
  const outcomeText = isActivationPreview && (payload?.observedMcpServers ?? 0) > 0
    ? `${managedOutcomeText} ${t(
        payload?.observedMcpServers === 1
          ? "1 MCP connection remains Agent-controlled."
          : "{{count}} MCP connections remain Agent-controlled.",
        { count: payload?.observedMcpServers ?? 0 }
      )}`
    : managedOutcomeText;
  const resourcePlan = resourceChanges.length > 0 ? (
    <section className="preview-resource-plan" aria-label={t("Resource changes")}>
      <header>
        <span className="preview-resource-plan__title">
          <strong>{t("Resource changes")}</strong>
          <span>{t("{{count}} total", { count: resourceChanges.length })}</span>
        </span>
        <span>{t("{{install}} install · {{replace}} replace · {{remove}} remove", {
          install: installChanges.length,
          replace: replaceChanges.length,
          remove: removeChanges.length
        })}</span>
      </header>
      <div
        ref={resourceListRef}
        className="preview-resource-plan__list"
        role="list"
        aria-label={t("Scrollable resource changes")}
        tabIndex={resourceChanges.length > 1 ? 0 : undefined}
        onScroll={updateResourceOverflow}
      >
        {resourceChanges.map((change) => (
          <article role="listitem" key={`${change.action}:${change.path}`}>
            <span className="preview-resource-plan__icon" aria-hidden="true">
              {resourceChangeIcon(change.kind)}
            </span>
            <span className="preview-resource-plan__identity">
              <strong>{change.name}</strong>
              <OverflowTooltip
                ariaLabel={t("Full resource path {{name}}", { name: change.name })}
                className="preview-resource-plan__path"
                text={change.path}
              />
            </span>
            <span className="preview-resource-plan__kind">{change.kind}</span>
            <span className={`change-kind change-kind--${change.action}`}>
              {t(
                change.action === "install"
                  ? "Install"
                  : change.action === "replace"
                    ? "Replace"
                    : "Remove"
              )}
            </span>
          </article>
        ))}
      </div>
      {hiddenResourceCount > 0 ? (
        <div className="preview-resource-plan__more" aria-hidden="true">
          <ChevronDown size={14} strokeWidth={2.2} />
          <span>{t("{{count}} more changes below", { count: hiddenResourceCount })}</span>
        </div>
      ) : null}
    </section>
  ) : null;

  const content = (
    <section
      ref={dialogRef}
      className={`preview-dialog${hasActions ? " preview-dialog--modal" : ""}`}
      role={hasActions ? "dialog" : undefined}
      aria-label={t("Preview")}
      aria-modal={hasActions ? true : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="preview-header ui-dialog-header">
        <div>
          <div className="section-title">{t(title)}</div>
          <p className="preview-outcome">{outcomeText}</p>
        </div>
        <time dateTime={preview.createdAt}>{formatDate(preview.createdAt)}</time>
      </header>
      {resourcePlan}
      <section className="preview-summary-grid" aria-label={t("Apply summary")}>
        {blockedItems.length > 0 ? (
          <section className="preview-summary-card is-blocked">
            <strong>{t("Blocking issues")}</strong>
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
            <strong>{t("Will preserve")}</strong>
            <span>{plural(keepItems.length, "unmanaged item")}</span>
          </section>
        ) : null}
        {preview.changes.length > 0 ? (
          <button
            className="preview-summary-card preview-summary-card--action"
            type="button"
            aria-label={t("Review {{files}}", { files: fileCountLabel })}
            onClick={reviewConfigurationChanges}
          >
            <strong>{t("Configuration changes")}</strong>
            <span>{t("{{files}} changed", { files: fileCountLabel })}</span>
            <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
        {sharedPreparationChanged ? (
          <section className="preview-summary-card">
            <strong>{t("Shared Skill cleanup")}</strong>
            <span>
              {t(
                sharedPreparations.length === 1
                  ? "1 Skill affected"
                  : "{{count}} Skills affected",
                { count: sharedPreparations.length }
              )}
            </span>
            {sharedPreparations.map((preparation) => (
              <p
                className="preview-shared-skill-change"
                key={`${preparation.skillKey}:${preparation.libraryId}`}
              >
                {preparation.skillKey}
                <small>
                  {preparation.disposition === "install"
                    ? t("After cleanup: install as {{name}}", { name: preparation.targetName })
                    : t("After cleanup: remove from this Agent")}
                </small>
              </p>
            ))}
          </section>
        ) : null}
      </section>
      {keepItems.length > 0 ? (
        <details className="preview-preserve-details">
          <summary>
            <span>{t("Review preserved items")}</span>
            <strong>{keepItems.length}</strong>
          </summary>
          <div>
            {keepItems.map((item) => (
              <p className="warning" key={`${item.title}${item.detail ?? ""}`}>
                <span>{item.title}</span>
                {item.detail ? (
                  <OverflowTooltip
                    ariaLabel={t("Full preserved path")}
                    className="preview-preserve-path"
                    text={item.detail}
                  />
                ) : null}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {protectedReplacementErrors.length > 0 && onReplacementAcknowledgedChange ? (
        <section className="preview-drift-recovery" aria-label={t("Protected Agent changes")}>
          <div>
            <strong>{t("Existing Agent resources are protected")}</strong>
            <p>{t("Cancel keeps the Agent unchanged. Continuing creates a backup, then replaces the resources shown above.")}</p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={replacementAcknowledged}
              onChange={(event) => onReplacementAcknowledgedChange(event.currentTarget.checked)}
            />
            {t("I understand; back up and replace these changes")}
          </label>
          {onOpenRecovery ? (
            <div className="preview-drift-actions">
              {onAdoptTargetChanges && managedDriftErrors.length > 0 ? (
                <button className="secondary-action" type="button" onClick={onAdoptTargetChanges}>
                  {t("Adopt compatible changes")}
                </button>
              ) : null}
              <button className="secondary-action" type="button" onClick={onOpenRecovery}>
                {t("Open recovery history")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {preview && "omissions" in preview && (preview.omissions?.length ?? 0) > 0 ? (
        <section className="preview-drift-recovery preview-omission-review" aria-label={t("Compatibility omissions")}>
          <div>
            <strong>{t("Not included for {{target}}", { target: targetName })}</strong>
            <p>{t("These native Profile resources are not compatible with the selected Agent.")}</p>
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
              {t("I understand these resources will not be applied to {{target}}", { target: targetName })}
            </label>
          ) : null}
        </section>
      ) : null}
      <div className="diff-list" ref={diffListRef}>
        {preview.changes.map((change) => (
          <details key={change.path}>
            <summary>
              <span>{change.path}</span>
              <strong className={`change-kind change-kind--${changeKind(change).toLowerCase()}`}>
                {t(changeKind(change))}
              </strong>
            </summary>
            <div className="diff-file-meta">
              <span>{t("{{lines}} before", { lines: plural(lineCount(change.before), "line") })}</span>
              <span>{t("{{lines}} after", { lines: plural(lineCount(change.after), "line") })}</span>
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
        <footer className="preview-actions ui-dialog-footer">
          <button
            ref={cancelButtonRef}
            className="secondary-action"
            type="button"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            {t(cancelLabel)}
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={confirmDisabled}
            aria-busy={confirmBusy}
            onClick={onConfirm}
          >
            {confirmBusy ? (
              <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            ) : null}
            {t(confirmLabel)}
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
