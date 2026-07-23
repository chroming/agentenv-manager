import {
  Activity,
  ArchiveRestore,
  ArrowRight,
  Clock3,
  CopyPlus,
  Monitor,
  RefreshCw,
  TerminalSquare
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  BackupSummary,
  NativeMcpConnection,
  RollbackPreview,
  StopManagingMode,
  StopManagingPreview,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { HistoryView } from "./HistoryView";
import { InfoTip } from "./InfoTip";
import { OverflowTooltip } from "./OverflowTooltip";
import { PreviewDialog } from "./PreviewDialog";
import { targetIconFor } from "./ProfileSidebar";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ControlGroup, IconButton, PageHeader } from "./ui";
import { isTargetInstalled } from "../../shared/targetHealth";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  mcpConnections: NativeMcpConnection[];
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

const installationEvidenceName = (
  evidence: TargetInfo["health"]["installationEvidence"][number],
  t: ReturnType<typeof useI18n>["t"]
) => evidence.kind === "command"
  ? t("{{name}} command", { name: evidence.label.replace(/ command$/, "") })
  : t("{{name}} app", { name: evidence.label.replace(/ app$/, "") });

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
  mcpConnections,
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
    <section className="target-page" aria-label={t("Agents")}>
      <PageHeader
        className="page-header workspace-page-header"
        title={t("Agents")}
        help={<InfoTip label={t("Agents are local coding tools. Manage environments from Profiles and inspect runtime paths here only when diagnosing a problem.")} />}
        actions={(
          <ControlGroup className="target-page-actions" aria-label={t("Agent actions")}>
            <Button
              ref={recoveryTriggerRef}
              className="secondary-action target-recovery-trigger"
              size="prominent"
              aria-haspopup="dialog"
              disabled={busy}
              icon={<ArchiveRestore size={15} strokeWidth={2.2} />}
              onClick={() => setIsRecoveryOpen(true)}
            >
              {t("Recovery")}
              <span aria-label={t(backups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: backups.length })}>{backups.length}</span>
            </Button>
            <Button
              className="secondary-action"
              size="prominent"
              disabled={busy}
              icon={<RefreshCw size={15} strokeWidth={2.2} />}
              onClick={() => { void onRefresh(); }}
            >
              {busy ? t("Refreshing...") : t("Refresh")}
            </Button>
          </ControlGroup>
        )}
      />

      <div className="target-list">
        {targets.length > 0 ? (
          <div className="target-list__header" aria-hidden="true">
            <span />
            <span>{t("Agent")}</span>
            <span>{t("Status")}</span>
            <span>{t("Management")}</span>
            <span>{t("Profile")}</span>
            <span>{t("Last applied")}</span>
            <span>{t("Actions")}</span>
          </div>
        ) : null}
        {targets.length === 0 ? (
          <div className="inline-state inline-state--panel">
            <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
            <span>{t("No enabled Agents")}</span>
          </div>
        ) : null}
        {targets.map((target) => {
          const state = statesByTarget.get(target.id);
          const isManaged = state?.status === "managed";
          const isExpanded = expandedTargetId === target.id;
          const icon = targetIconFor(target);
          return (
            <article aria-label={t("Agent {{name}}", { name: target.name })} className="target-card target-card--workflow" key={target.id}>
              <header className="target-workflow-header">
                <span className={`target-workflow-icon target-workflow-icon--${icon.flavor}`} aria-hidden="true">
                  {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <TerminalSquare size={20} />}
                </span>
                <span className="target-workflow-title">
                  <span className="target-workflow-name-line">
                    <strong>{target.name}</strong>
                  </span>
                  <OverflowTooltip
                    className="target-workflow-description"
                    focusable={false}
                    text={t(target.description)}
                  />
                </span>
                <span className={`target-health-status target-health-status--${target.health.status}`}>
                  {t(targetStatusLabel[target.health.status])}
                </span>
                <strong className="target-workflow-lifecycle">
                  {t(state?.lifecycleStatus ? lifecycleLabel[state.lifecycleStatus] : isManaged ? "Managed by AgentEnv" : "Not managed")}
                </strong>
                <span className="target-workflow-profile">
                  {state?.activeProfileName ?? t("None")}
                </span>
                <span className="target-workflow-last-applied">
                  <Clock3 size={12} />
                  {formatLastApplied(state?.lastAppliedAt, localeTag, t("Never applied"))}
                </span>
                <ControlGroup className="target-workflow-actions" aria-label={t("Agent actions")}>
                  <IconButton
                    className="target-capture-action"
                    size="compact"
                    variant="ghost"
                    label={t("Create profile from {{name}}", { name: target.name })}
                    disabled={busy || !isTargetInstalled(target.health)}
                    title={isTargetInstalled(target.health) ? t("Capture") : t("{{name}} is not detected", { name: target.name })}
                    onClick={() => onCreateProfileFromTarget(target.id)}
                  >
                    <CopyPlus size={15} strokeWidth={2.2} />
                  </IconButton>
                  <Button
                    className="target-profile-action"
                    size="compact"
                    aria-label={t("Open {{name}} in Profiles", { name: target.name })}
                    onClick={() => onManageTarget(target.id)}
                  >
                    <span>{t(isManaged ? "Open Profile" : "Choose Profile")}</span>
                    <ArrowRight size={14} strokeWidth={2.2} />
                  </Button>
                  <IconButton
                    className="target-diagnostics-toggle"
                    size="compact"
                    aria-expanded={isExpanded}
                    label={t(isExpanded ? "Hide {{name}} diagnostics" : "Show {{name}} diagnostics", { name: target.name })}
                    title={t("Diagnostics")}
                    onClick={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
                  >
                    <Activity size={15} strokeWidth={2.2} />
                  </IconButton>
                </ControlGroup>
              </header>
              {isExpanded ? (
                <section className="target-diagnostics" role="region" aria-label={t("{{name}} diagnostics", { name: target.name })}>
                  <div className="target-checks">
                    <div className="target-check">
                      <div>
                        <span>{t("Detected via")}</span>
                        <code title={target.health.installationEvidence.map((item) => item.path).join("\n")}>
                          {target.health.installationEvidence.length > 0
                            ? target.health.installationEvidence
                                .map((item) => installationEvidenceName(item, t))
                                .join(" · ")
                            : t("None")}
                        </code>
                      </div>
                      <strong>{t(target.health.installationFound ? "Detected" : "Not detected")}</strong>
                    </div>
                    {target.health.checks.map((check) => (
                      <div className="target-check" key={check.id}>
                        <div><span>{check.label}</span><code title={check.path}>{check.path}</code></div>
                        <strong>{t(check.exists ? (check.writable ? "Writable" : "Read-only") : "Missing")}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="target-native-mcps">
                    <div className="target-native-mcps__heading">
                      <strong>{t("MCP connections")}</strong>
                      <span>
                        {t("Configured in {{name}}", { name: target.name })}
                      </span>
                    </div>
                    {mcpConnections.filter(
                      (connection) => connection.targetId === target.id
                    ).length === 0 ? (
                      <p>{t("No MCP connections detected")}</p>
                    ) : (
                      <div className="target-native-mcps__list">
                        {mcpConnections
                          .filter(
                            (connection) => connection.targetId === target.id
                          )
                          .map((connection) => (
                            <div
                              key={`${connection.targetId}:${connection.name}`}
                            >
                              <span>
                                <strong>{connection.name}</strong>
                                <small title={connection.sourcePath}>
                                  {connection.sourcePath}
                                </small>
                              </span>
                              <span>
                                {t(connection.enabled ? "On" : "Off")}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
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
            <header className="profile-dialog-header target-recovery-dialog__header ui-dialog-header">
              <div>
                <div className="section-title">{t("Recovery")}</div>
                <p className="muted">{t("Backups created before managed applies.")}</p>
              </div>
              <span>{t(backups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: backups.length })}</span>
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
            <footer className="preview-actions ui-dialog-footer">
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
          <section ref={stopManagingDialogRef} className="profile-form-dialog stop-managing-dialog" role="dialog" aria-modal="true" aria-label={t("Stop managing Agent")} onClick={(event) => event.stopPropagation()}>
            <header className="profile-dialog-header ui-dialog-header">
              <div>
                <div className="section-title">{t("Stop managing {{name}}", { name: targets.find((target) => target.id === stopManagingTargetId)?.name ?? "" })}</div>
                <p className="muted">{t("Choose what should happen to the current Agent environment.")}</p>
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
            <footer className="preview-actions ui-dialog-footer">
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
