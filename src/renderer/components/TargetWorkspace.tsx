import {
  ArchiveRestore,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Monitor,
  Plus,
  RefreshCw,
  TerminalSquare
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  BackupSummary,
  RollbackPreview,
  StopManagingMode,
  StopManagingPreview,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { HistoryView } from "./HistoryView";
import { InfoTip } from "./InfoTip";
import { PreviewDialog } from "./PreviewDialog";
import { targetIconFor } from "./ProfileSidebar";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  backups: BackupSummary[];
  rollbackPreview?: RollbackPreview;
  rollbackError?: string;
  stopManagingPreview?: StopManagingPreview;
  busy: boolean;
  onRefresh(): Promise<void>;
  onManageTarget(targetId: string): void;
  onCreateProfileFromTarget(targetId: string): void;
  onPreviewRollback(backupId: string): void;
  onCancelRollback(): void;
  onRestoreRollback(): void;
  onPreviewStopManaging(targetId: string, mode: StopManagingMode): void;
  onCancelStopManaging(): void;
  onStopManaging(): void;
}

const targetStatusLabel: Record<TargetInfo["health"]["status"], string> = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  missing: "Missing",
  guarded: "Guarded"
};

const formatLastApplied = (value: string | undefined, locale: string, neverApplied: string) => {
  if (!value) return neverApplied;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
};

const lifecycleLabel: Record<TargetManagementState["lifecycleStatus"], string> = {
  unmanaged: "Not managed",
  applied: "Applied",
  pending: "Changes pending",
  drifted: "Drift detected",
  "recovery-required": "Recovery required"
};

export const TargetWorkspace = ({
  targets,
  targetStates,
  backups,
  rollbackPreview,
  rollbackError,
  stopManagingPreview,
  busy,
  onRefresh,
  onManageTarget,
  onCreateProfileFromTarget,
  onPreviewRollback,
  onCancelRollback,
  onRestoreRollback,
  onPreviewStopManaging,
  onCancelStopManaging,
  onStopManaging
}: TargetWorkspaceProps) => {
  const { localeTag, t } = useI18n();
  const [expandedTargetId, setExpandedTargetId] = useState<string>();
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [stopManagingTargetId, setStopManagingTargetId] = useState<string>();
  const [stopManagingMode, setStopManagingMode] = useState<StopManagingMode>("keep-current");
  const stopManagingReturnFocusRef = useRef<HTMLElement | null>(null);
  const stopManagingDialogRef = useRef<HTMLElement>(null);
  const stopManagingCancelRef = useRef<HTMLButtonElement>(null);
  const recoveryTriggerRef = useRef<HTMLButtonElement>(null);
  const recoveryDialogRef = useRef<HTMLElement>(null);
  const recoveryCloseRef = useRef<HTMLButtonElement>(null);
  const statesByTarget = new Map(targetStates.map((state) => [state.targetId, state]));

  useModalDialog({
    open: Boolean(stopManagingTargetId),
    dialogRef: stopManagingDialogRef,
    initialFocusRef: stopManagingCancelRef,
    fallbackFocusRef: stopManagingReturnFocusRef,
    onDismiss: () => setStopManagingTargetId(undefined),
    dismissDisabled: busy
  });

  useModalDialog({
    open: isRecoveryOpen,
    dialogRef: recoveryDialogRef,
    initialFocusRef: recoveryCloseRef,
    fallbackFocusRef: recoveryTriggerRef,
    onDismiss: () => setIsRecoveryOpen(false),
    dismissDisabled: busy
  });

  return (
    <section className="target-page" aria-label={t("Targets")}>
      <header className="page-header workspace-page-header">
        <div>
          <h2 aria-label={t("Targets")}>
            {t("Targets")}
            <InfoTip label={t("Targets are local agent runtimes. Manage profiles from Profiles and inspect runtime paths here only when diagnosing a problem.")} />
          </h2>
          <p>{t("Inspect local agent runtimes, management state, and recovery points.")}</p>
        </div>
        <div className="target-page-actions">
          <button
            ref={recoveryTriggerRef}
            className="secondary-action target-recovery-trigger"
            type="button"
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setIsRecoveryOpen(true)}
          >
            <ArchiveRestore size={15} strokeWidth={2.2} />
            {t("Recovery")}
            <span aria-label={t("{{count}} backups", { count: backups.length })}>{backups.length}</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => { void onRefresh(); }}
          >
            <RefreshCw size={15} strokeWidth={2.2} />
            {busy ? t("Refreshing...") : t("Refresh")}
          </button>
        </div>
      </header>

      <div className="target-list">
        {targets.length === 0 ? (
          <div className="inline-state inline-state--panel">
            <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
            <span>{t("No supported targets detected")}</span>
          </div>
        ) : null}
        {targets.map((target) => {
          const state = statesByTarget.get(target.id);
          const isManaged = state?.status === "managed";
          const isExpanded = expandedTargetId === target.id;
          const icon = targetIconFor(target);
          return (
            <article aria-label={t("Target {{name}}", { name: target.name })} className="target-card target-card--workflow" key={target.id}>
              <header className="target-workflow-header">
                <span className={`target-workflow-icon target-workflow-icon--${icon.flavor}`} aria-hidden="true">
                  {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <TerminalSquare size={20} />}
                </span>
                <span className="target-workflow-title">
                  <strong>{target.name}</strong>
                  <small>{target.description}</small>
                </span>
                <span className={`target-badge target-badge--${target.health.status}`}>
                  {t(targetStatusLabel[target.health.status])}
                </span>
                <span className="target-workflow-actions">
                  <button
                    className="primary-inline-action"
                    type="button"
                    aria-label={t("Create profile from {{name}}", { name: target.name })}
                    disabled={busy || !target.health.executableFound}
                    title={target.health.executableFound ? undefined : t("{{name}} command is missing", { name: target.name })}
                    onClick={() => onCreateProfileFromTarget(target.id)}
                  >
                    <Plus size={14} strokeWidth={2.2} />
                    {t("Capture current")}
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    aria-label={t("Open {{name}} in Profiles", { name: target.name })}
                    onClick={() => onManageTarget(target.id)}
                  >
                    {t("Manage")}
                    <ArrowRight size={14} strokeWidth={2.2} />
                  </button>
                </span>
              </header>

              <div className="target-state-grid">
                <span>
                  <small>{t("Management")}</small>
                  <strong>{t(state?.lifecycleStatus ? lifecycleLabel[state.lifecycleStatus] : isManaged ? "Managed by AgentEnv" : "Not managed")}</strong>
                </span>
                <span>
                  <small>{t("Active profile")}</small>
                  <strong>{state?.activeProfileName ?? t("None")}</strong>
                </span>
                <span>
                  <small>{t("Last applied")}</small>
                  <strong><Clock3 size={13} />{formatLastApplied(state?.lastAppliedAt, localeTag, t("Never applied"))}</strong>
                </span>
              </div>

              <button
                className="target-diagnostics-toggle"
                type="button"
                aria-expanded={isExpanded}
                aria-label={t(isExpanded ? "Hide {{name}} diagnostics" : "Show {{name}} diagnostics", { name: target.name })}
                onClick={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
              >
                {t("Diagnostics")}
                {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {isExpanded ? (
                <section className="target-diagnostics" role="region" aria-label={t("{{name}} diagnostics", { name: target.name })}>
                  <div className="target-config-path">
                    <span>{t("Config directory")}</span>
                    <code title={target.paths.configDir}>{target.paths.configDir}</code>
                  </div>
                  <div className="target-checks">
                    {target.health.checks.map((check) => (
                      <div className="target-check" key={check.id}>
                        <div><span>{check.label}</span><code title={check.path}>{check.path}</code></div>
                        <strong>{t(check.exists ? (check.writable ? "Writable" : "Read-only") : "Missing")}</strong>
                      </div>
                    ))}
                  </div>
                  {isManaged ? (
                    <footer className="target-diagnostics-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => {
                          stopManagingReturnFocusRef.current =
                            document.activeElement instanceof HTMLElement
                              ? document.activeElement
                              : null;
                          setStopManagingMode("keep-current");
                          setStopManagingTargetId(target.id);
                        }}
                      >
                        {t("Stop managing {{name}}", { name: target.name })}
                      </button>
                    </footer>
                  ) : null}
                </section>
              ) : null}
            </article>
          );
        })}
      </div>

      {isRecoveryOpen ? (
        <div className="preview-modal-backdrop" onClick={busy ? undefined : () => setIsRecoveryOpen(false)}>
          <section
            ref={recoveryDialogRef}
            className="profile-form-dialog target-recovery-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("Recovery")}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header target-recovery-dialog__header">
              <div>
                <div className="section-title">{t("Recovery")}</div>
                <p className="muted">{t("Backups created before managed applies.")}</p>
              </div>
              <span>{t("{{count}} backups", { count: backups.length })}</span>
            </header>
            <div className="target-recovery-dialog__body">
              <HistoryView
                backups={backups}
                busy={busy}
                rollbackPreview={undefined}
                onPreviewRollback={(backupId) => {
                  setIsRecoveryOpen(false);
                  onPreviewRollback(backupId);
                }}
                onRestoreRollback={onRestoreRollback}
              />
            </div>
            <footer className="preview-actions">
              <button
                ref={recoveryCloseRef}
                className="secondary-action"
                type="button"
                disabled={busy}
                onClick={() => setIsRecoveryOpen(false)}
              >
                {t("Close")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {rollbackPreview ? (
        <PreviewDialog
          preview={rollbackPreview}
          title={t("Rollback preview")}
          confirmLabel={t("Restore backup")}
          confirmDisabled={busy || rollbackPreview.errors.length > 0}
          cancelDisabled={busy}
          errorMessage={rollbackError}
          onCancel={busy ? undefined : onCancelRollback}
          onConfirm={onRestoreRollback}
        />
      ) : null}
      {stopManagingTargetId ? (
        <div className="preview-modal-backdrop" onClick={() => setStopManagingTargetId(undefined)}>
          <section ref={stopManagingDialogRef} className="profile-form-dialog stop-managing-dialog" role="dialog" aria-modal="true" aria-label={t("Stop managing Target")} onClick={(event) => event.stopPropagation()}>
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Stop managing {{name}}", { name: targets.find((target) => target.id === stopManagingTargetId)?.name ?? "" })}</div>
                <p className="muted">{t("Choose what should happen to the current Target environment.")}</p>
              </div>
            </header>
            <div className="stop-managing-options" role="radiogroup" aria-label={t("Stop managing behavior")}>
              <label>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "keep-current"} onChange={() => setStopManagingMode("keep-current")} />
                <span><strong>{t("Keep current environment")}</strong><small>{t("Detach AgentEnv ownership and turn linked Skills into independent files.")}</small></span>
              </label>
              <label>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "restore-pre-takeover"} onChange={() => setStopManagingMode("restore-pre-takeover")} />
                <span><strong>{t("Restore environment before takeover")}</strong><small>{t("Replace current managed files with the earliest pre-takeover backup.")}</small></span>
              </label>
            </div>
            <footer className="preview-actions">
              <button ref={stopManagingCancelRef} className="secondary-action" type="button" onClick={() => setStopManagingTargetId(undefined)}>{t("Cancel")}</button>
              <button className="danger-action" type="button" disabled={busy} onClick={() => {
                onPreviewStopManaging(stopManagingTargetId, stopManagingMode);
                setStopManagingTargetId(undefined);
              }}>{t("Review changes")}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {stopManagingPreview ? (
        <PreviewDialog
          preview={stopManagingPreview}
          title={t("Stop managing {{name}}", { name: stopManagingPreview.targetName })}
          confirmLabel={t(stopManagingPreview.mode === "keep-current" ? "Keep files and detach" : "Restore and detach")}
          confirmDisabled={busy || stopManagingPreview.errors.length > 0}
          cancelDisabled={busy}
          onCancel={onCancelStopManaging}
          onConfirm={onStopManaging}
        />
      ) : null}
    </section>
  );
};
