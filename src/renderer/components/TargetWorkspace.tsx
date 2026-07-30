import {
  Activity,
  ArchiveRestore,
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
import { PreviewDialog } from "./PreviewDialog";
import { targetIconFor } from "./ProfileSidebar";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ControlGroup, ModalFrame, PageHeader } from "./ui";
import { isTargetInstalled } from "../../shared/targetHealth";
import type { EnvironmentReviewSummary } from "../environmentReview";
import type { FreshnessState } from "../freshness";
import { EnvironmentStatusStrip } from "./EnvironmentStatusStrip";
import { FreshnessStatus } from "./FreshnessStatus";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  environmentReview: EnvironmentReviewSummary;
  targetNames: Record<string, string>;
  mcpConnections: NativeMcpConnection[];
  backups: BackupSummary[];
  rollbackPreview?: RollbackPreview;
  rollbackError?: string;
  stopManagingPreview?: StopManagingPreview;
  isLoading: boolean;
  busy: boolean;
  freshness: FreshnessState;
  onRefresh(): Promise<void>;
  onConfigure(targetId: string): void;
  onReviewEnvironment(): void;
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
  "applied-with-outside": "Local exceptions",
  pending: "Changes pending",
  drifted: "Changed outside AgentEnv",
  "recovery-required": "Recovery required"
};

export const TargetWorkspace = ({
  targets,
  targetStates,
  environmentReview,
  targetNames,
  mcpConnections,
  backups,
  rollbackPreview,
  rollbackError,
  stopManagingPreview,
  isLoading,
  busy,
  freshness,
  onRefresh,
  onConfigure,
  onReviewEnvironment,
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
        help={<InfoTip label={t("Configure each Agent through the same reusable Profile editor, then review every change before Apply.")} />}
        actions={(
          <ControlGroup className="target-page-actions" aria-label={t("Agent actions")}>
            <FreshnessStatus state={freshness} verb="Refreshed" />
            <Button
              ref={recoveryTriggerRef}
              className="secondary-action target-recovery-trigger"
              size="prominent"
              aria-haspopup="dialog"
              disabled={busy || isLoading}
              icon={<ArchiveRestore size={15} strokeWidth={2.2} />}
              onClick={() => setIsRecoveryOpen(true)}
            >
              {t("Recovery")}
              <span aria-label={t(backups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: backups.length })}>{backups.length}</span>
            </Button>
            <Button
              className="secondary-action"
              size="prominent"
              busy={busy}
              disabled={busy || isLoading}
              icon={<RefreshCw size={15} strokeWidth={2.2} />}
              onClick={() => { void onRefresh(); }}
            >
              {t("Refresh")}
            </Button>
          </ControlGroup>
        )}
      />

      <EnvironmentStatusStrip
        summary={environmentReview}
        targetNames={targetNames}
        busy={busy}
        onConfigure={onConfigure}
        onRefresh={() => {
          void onRefresh();
        }}
        onReviewShared={onReviewEnvironment}
      />

      <div className="target-list">
        {!isLoading && targets.length > 0 ? (
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
        {isLoading ? (
          <div className="inline-state inline-state--panel inline-state--loading" role="status">
            <span className="inline-state__icon" aria-hidden="true" />
            <span>{t("Detecting Agents")}</span>
          </div>
        ) : targets.length === 0 ? (
          <div className="inline-state inline-state--panel">
            <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
            <span>{t("No enabled Agents")}</span>
          </div>
        ) : null}
        {!isLoading ? targets.map((target) => {
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
                    <button
                      className="target-workflow-name-action"
                      type="button"
                      title={t("Configure {{name}}", { name: target.name })}
                      onClick={() => onConfigure(target.id)}
                    >
                      <strong>{target.name}</strong>
                    </button>
                  </span>
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
                  <Button
                    className="target-capture-action"
                    size="compact"
                    variant="ghost"
                    aria-label={t("Create profile from {{name}}", { name: target.name })}
                    disabled={busy || !isTargetInstalled(target.health)}
                    title={isTargetInstalled(target.health) ? t("Capture") : t("{{name}} is not detected", { name: target.name })}
                    icon={<CopyPlus size={15} strokeWidth={2.2} />}
                    onClick={() => onCreateProfileFromTarget(target.id)}
                  />
                  <Button
                    className="target-profile-action"
                    size="compact"
                    aria-label={t("Configure {{name}}", { name: target.name })}
                    onClick={() => onConfigure(target.id)}
                  >
                    <span>{t("Configure")}</span>
                  </Button>
                  <Button
                    className="target-diagnostics-toggle"
                    size="compact"
                    variant="ghost"
                    aria-expanded={isExpanded}
                    aria-label={t(isExpanded ? "Hide {{name}} diagnostics" : "Show {{name}} diagnostics", { name: target.name })}
                    title={t("Diagnostics")}
                    icon={<Activity size={15} strokeWidth={2.2} />}
                    onClick={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
                  />
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
        }) : null}
      </div>

      {isRecoveryOpen ? (
        <ModalFrame
          ariaLabel={t("Recovery")}
          className="target-recovery-dialog ui-dialog-shell"
          dialogRef={recoveryDialogRef}
          dismissDisabled={busy}
          onDismiss={() => setIsRecoveryOpen(false)}
        >
            <header className="profile-dialog-header target-recovery-dialog__header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Recovery")}</div>
                <p className="muted ui-dialog-description">{t("Backups created before managed applies.")}</p>
              </div>
              <span>{t(backups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: backups.length })}</span>
            </header>
            <div className="target-recovery-dialog__body ui-dialog-body">
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
              <Button
                ref={recoveryCloseRef}
                className="secondary-action"
                disabled={busy}
                onClick={() => setIsRecoveryOpen(false)}
              >
                {t("Close")}
              </Button>
            </footer>
        </ModalFrame>
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
        <ModalFrame
          ariaLabel={t("Stop managing Agent")}
          className="stop-managing-dialog ui-dialog-shell"
          dialogRef={stopManagingDialogRef}
          dismissDisabled={busy}
          onDismiss={() => setStopManagingTargetId(undefined)}
        >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Stop managing {{name}}", { name: targets.find((target) => target.id === stopManagingTargetId)?.name ?? "" })}</div>
                <p className="muted ui-dialog-description">{t("Choose what should happen to the current Agent environment.")}</p>
              </div>
            </header>
            <div className="ui-choice-list ui-dialog-body" role="radiogroup" aria-label={t("Stop managing behavior")}>
              <label className={`ui-choice-card${stopManagingMode === "keep-current" ? " is-selected" : ""}`}>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "keep-current"} onChange={() => setStopManagingMode("keep-current")} />
                <span><strong>{t("Keep current environment")}</strong><small>{t("Detach AgentEnv ownership and turn linked Skills into independent files.")}</small></span>
              </label>
              <label className={`ui-choice-card${stopManagingMode === "restore-pre-takeover" ? " is-selected" : ""}`}>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "restore-pre-takeover"} onChange={() => setStopManagingMode("restore-pre-takeover")} />
                <span><strong>{t("Restore environment before takeover")}</strong><small>{t("Replace current managed files with the earliest pre-takeover backup.")}</small></span>
              </label>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <Button ref={stopManagingCancelRef} variant="secondary" disabled={busy} onClick={() => setStopManagingTargetId(undefined)}>{t("Cancel")}</Button>
              <Button variant="primary" disabled={busy} onClick={() => {
                onPreviewStopManaging(stopManagingTargetId, stopManagingMode);
                setStopManagingTargetId(undefined);
              }}>{t("Review changes")}</Button>
            </footer>
        </ModalFrame>
      ) : null}
      {stopManagingPreview ? (
        <PreviewDialog
          preview={stopManagingPreview}
          title={t("Stop managing {{name}}", { name: stopManagingPreview.targetName })}
          confirmLabel={t(stopManagingPreview.mode === "keep-current" ? "Keep files and detach" : "Restore and detach")}
          confirmVariant="danger"
          confirmDisabled={busy || stopManagingPreview.errors.length > 0}
          cancelDisabled={busy}
          onCancel={onCancelStopManaging}
          onConfirm={onStopManaging}
        />
      ) : null}
    </section>
  );
};
