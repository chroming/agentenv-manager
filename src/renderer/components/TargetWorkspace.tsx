import {
  Activity,
  ArchiveRestore,
  Clock3,
  CopyPlus,
  MoreHorizontal,
  TerminalSquare
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ProductIcon } from "../productIcons";
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
import {
  ActionMenu,
  Button,
  ControlGroup,
  DialogBody,
  DialogFooter,
  DialogHeader,
  focusInitialActionMenuItem,
  IconButton,
  ModalFrame,
  PageHeader,
  RefreshAction
} from "./ui";
import { isTargetInstalled } from "../../shared/targetHealth";
import type { EnvironmentReviewSummary } from "../environmentReview";
import type { FreshnessState } from "../freshness";
import { EnvironmentStatusStrip } from "./EnvironmentStatusStrip";
import { OverflowTooltip } from "./OverflowTooltip";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  detectedDisabledAgentCount: number;
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
  onReorder?(targetIds: string[]): void;
  onChooseAgents(): void;
  onConfigure(targetId: string): void;
  onReviewEnvironment(): void;
  onCreateProfileFromTarget(targetId: string, returnFocus?: HTMLElement | null): void;
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
  guarded: "Guarded",
  unknown: "Check failed"
};

const executableStatusLabel: Record<TargetInfo["health"]["executableStatus"], string> = {
  found: "Detected",
  missing: "Not detected",
  unknown: "Check failed"
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
  "applied-with-local-override": "Local overrides",
  pending: "Changes pending",
  drifted: "Changed outside AgentEnv",
  "recovery-required": "Recovery required"
};

const TargetRowActions = ({
  target,
  busy,
  expanded,
  onCapture,
  onToggleDiagnostics
}: {
  target: TargetInfo;
  busy: boolean;
  expanded: boolean;
  onCapture(returnFocus?: HTMLElement | null): void;
  onToggleDiagnostics(): void;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const installed = isTargetInstalled(target.health);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 200;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    setStyle({
      left,
      position: "fixed",
      top: spaceBelow >= 110 ? rect.bottom + 5 : Math.max(8, rect.top - 92),
      width
    });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    focusInitialActionMenuItem(menuRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const dismissForViewportChange = () => setOpen(false);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [open]);

  const run = (action: () => void, restoreFocus = false) => {
    setOpen(false);
    action();
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };

  return (
    <ControlGroup className="target-workflow-actions" aria-label={t("Agent actions")}>
      <IconButton
        ref={triggerRef}
        className="target-more-action"
        label={t("More actions for {{name}}", { name: target.name })}
        size="compact"
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => open ? setOpen(false) : show()}
      >
        <MoreHorizontal aria-hidden="true" />
      </IconButton>
      {open && style ? createPortal(
        <ActionMenu
          ariaLabel={t("Agent actions")}
          className="target-row-action-menu"
          menuRef={menuRef}
          style={style}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!installed}
            title={installed ? undefined : t("{{name}} is not detected", { name: target.name })}
            onClick={() => run(() => onCapture(triggerRef.current))}
          >
            <CopyPlus size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("Capture")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-expanded={expanded}
            onClick={() => run(onToggleDiagnostics, true)}
          >
            <Activity size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t(expanded ? "Hide diagnostics" : "Diagnostics")}</span>
          </button>
        </ActionMenu>,
        document.body
      ) : null}
    </ControlGroup>
  );
};

export const TargetWorkspace = ({
  targets,
  detectedDisabledAgentCount,
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
  onReorder = () => undefined,
  onChooseAgents,
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
  const [draggedTargetId, setDraggedTargetId] = useState<string>();
  const [dragOverTargetId, setDragOverTargetId] = useState<string>();
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
  const showEnvironmentStatus = [
    "unavailable",
    "shared-review",
    "setup",
    "agent-review"
  ].includes(environmentReview.state);

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
        help={<InfoTip label={t("Inspect each Agent and apply a saved Profile only when you choose.")} />}
        actions={(
          <ControlGroup className="target-page-actions" aria-label={t("Agent actions")}>
            {environmentReview.installedAgentCount > 0 ? (
              <span className="target-page-summary">
                {t("{{agents}} Agents detected · {{profiles}} Profiles", {
                  agents: environmentReview.installedAgentCount,
                  profiles: environmentReview.usableProfileCount
                })}
              </span>
            ) : null}
            {backups.length > 0 ? (
              <Button
                ref={recoveryTriggerRef}
                disabled={busy || isLoading}
                icon={<ArchiveRestore size={15} strokeWidth={2.2} aria-hidden="true" />}
                onClick={() => setIsRecoveryOpen(true)}
              >
                {t("Recovery")}
              </Button>
            ) : null}
            <RefreshAction
              disabled={busy || isLoading || freshness.status === "refreshing"}
              label={t("Refresh")}
              state={freshness}
              onRefresh={() => { void onRefresh(); }}
            />
          </ControlGroup>
        )}
      />

      {showEnvironmentStatus ? (
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
      ) : null}

      <div className="target-list">
        {!isLoading && targets.length > 0 ? (
          <div className="target-list__header" aria-hidden="true">
            <span />
            <span>{t("Agent")}</span>
            <span>{t("Status")}</span>
            <span className="target-list__environment-headings">
              <span>{t("Management")}</span>
              <span>{t("Profile")}</span>
              <span className="target-list__environment-heading--compact">
                {t("Profile state")}
              </span>
            </span>
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
          <div className="target-empty-state">
            <span className="target-empty-state__icon" aria-hidden="true"><ProductIcon name="agents" size={18} /></span>
            <span className="target-empty-state__copy">
              <strong>{t("No enabled Agents")}</strong>
              <small>
                {detectedDisabledAgentCount > 0
                  ? t("{{count}} installed Agents are ready to enable.", {
                      count: detectedDisabledAgentCount
                    })
                  : t("Install a supported Agent, then Refresh.")}
              </small>
            </span>
            <Button size="compact" onClick={onChooseAgents}>{t("Choose Agents")}</Button>
          </div>
        ) : null}
        {!isLoading ? targets.map((target) => {
          const state = statesByTarget.get(target.id);
          const isManaged = state?.status === "managed";
          const isExpanded = expandedTargetId === target.id;
          const icon = targetIconFor(target);
          return (
            <article
              aria-label={t("Agent {{name}}", { name: target.name })}
              className={`target-card target-card--workflow${
                draggedTargetId === target.id ? " is-dragging" : ""
              }${dragOverTargetId === target.id ? " is-drag-over" : ""}`}
              key={target.id}
              onDragOver={(event) => {
                if (!draggedTargetId || draggedTargetId === target.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverTargetId(target.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedTargetId || draggedTargetId === target.id) return;
                const next = targets.map((item) => item.id).filter((id) => id !== draggedTargetId);
                const targetIndex = next.indexOf(target.id);
                next.splice(targetIndex, 0, draggedTargetId);
                onReorder(next);
                setDraggedTargetId(undefined);
                setDragOverTargetId(undefined);
              }}
            >
              <header className="target-workflow-header">
                <span
                  className={`target-workflow-icon target-workflow-icon--${icon.flavor}`}
                  aria-hidden="true"
                  draggable={targets.length > 1}
                  onDragEnd={() => {
                    setDraggedTargetId(undefined);
                    setDragOverTargetId(undefined);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", target.id);
                    setDraggedTargetId(target.id);
                  }}
                >
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
                <span className="target-workflow-environment">
                  <strong className="target-workflow-lifecycle">
                    {t(state?.lifecycleStatus ? lifecycleLabel[state.lifecycleStatus] : isManaged ? "Managed by AgentEnv" : "Not managed")}
                  </strong>
                  <span className="target-workflow-profile">
                    {state?.activeProfileName ?? t("None")}
                  </span>
                </span>
                <span className="target-workflow-last-applied">
                  <Clock3 size={12} />
                  {formatLastApplied(state?.lastAppliedAt, localeTag, t("Never applied"))}
                </span>
                <TargetRowActions
                  target={target}
                  busy={busy}
                  expanded={isExpanded}
                  onCapture={(returnFocus) =>
                    onCreateProfileFromTarget(target.id, returnFocus)}
                  onToggleDiagnostics={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
                />
              </header>
              {isExpanded ? (
                <section className="target-diagnostics" role="region" aria-label={t("{{name}} diagnostics", { name: target.name })}>
                  <div className="target-checks">
                    <div className="target-check">
                      <div>
                        <span>{t("Detected via")}</span>
                        <OverflowTooltip
                          className="target-check-path"
                          displayText={target.health.installationEvidence.length > 0
                            ? target.health.installationEvidence
                                .map((item) => installationEvidenceName(item, t))
                                .join(" · ")
                            : t("None")}
                          text={target.health.installationEvidence.map((item) => item.path).join("\n") || t("None")}
                        />
                      </div>
                      <strong>{t(target.health.installationFound ? "Detected" : "Not detected")}</strong>
                    </div>
                    <div className="target-check">
                      <div>
                        <span>{t("Command")}</span>
                        <OverflowTooltip
                          className="target-check-path"
                          displayText={
                            target.health.executablePath ??
                            target.health.executableOverride ??
                            target.health.executableCandidates.join(" · ")
                          }
                          text={[
                            target.health.executableOverride
                              ? `Override: ${target.health.executableOverride}`
                              : undefined,
                            `Candidates: ${target.health.executableCandidates.join(", ")}`,
                            target.health.executablePath
                              ? `Resolved: ${target.health.executablePath}`
                              : undefined,
                            target.health.executableError
                              ? `Error: ${target.health.executableError}`
                              : undefined
                          ].filter(Boolean).join("\n")}
                        />
                      </div>
                      <strong>{t(executableStatusLabel[target.health.executableStatus])}</strong>
                    </div>
                    {target.health.checks.map((check) => (
                      <div className="target-check" key={check.id}>
                        <div>
                          <span>{check.label}</span>
                          <OverflowTooltip className="target-check-path" text={check.path} />
                        </div>
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
                                <OverflowTooltip
                                  className="target-native-mcp-path"
                                  text={connection.sourcePath}
                                />
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
                      <Button
                        size="compact"
                        variant="secondary"
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
                      </Button>
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
            <DialogHeader
              className="target-recovery-dialog__header"
              title={t("Recovery")}
              description={t("Backups created before managed applies.")}
              actions={<span>{t(backups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: backups.length })}</span>}
            />
            <DialogBody className="target-recovery-dialog__body">
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
            </DialogBody>
            <DialogFooter className="preview-actions">
              <Button
                ref={recoveryCloseRef}
                disabled={busy}
                onClick={() => setIsRecoveryOpen(false)}
              >
                {t("Close")}
              </Button>
            </DialogFooter>
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
            <DialogHeader
              title={t("Stop managing {{name}}", { name: targets.find((target) => target.id === stopManagingTargetId)?.name ?? "" })}
              description={t("Choose what should happen to the current Agent environment.")}
            />
            <DialogBody className="ui-choice-list" role="radiogroup" aria-label={t("Stop managing behavior")}>
              <label className={`ui-choice-card${stopManagingMode === "keep-current" ? " is-selected" : ""}`}>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "keep-current"} onChange={() => setStopManagingMode("keep-current")} />
                <span><strong>{t("Keep current environment")}</strong><small>{t("Detach AgentEnv ownership and turn linked Skills into independent files.")}</small></span>
              </label>
              <label className={`ui-choice-card${stopManagingMode === "restore-pre-takeover" ? " is-selected" : ""}`}>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "restore-pre-takeover"} onChange={() => setStopManagingMode("restore-pre-takeover")} />
                <span><strong>{t("Restore environment before takeover")}</strong><small>{t("Replace current managed files with the earliest pre-takeover backup.")}</small></span>
              </label>
            </DialogBody>
            <DialogFooter className="preview-actions">
              <Button ref={stopManagingCancelRef} variant="secondary" disabled={busy} onClick={() => setStopManagingTargetId(undefined)}>{t("Cancel")}</Button>
              <Button variant="primary" disabled={busy} onClick={() => {
                onPreviewStopManaging(stopManagingTargetId, stopManagingMode);
                setStopManagingTargetId(undefined);
              }}>{t("Review changes")}</Button>
            </DialogFooter>
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
