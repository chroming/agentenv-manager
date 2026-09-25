import { TargetEnvironmentSummary } from "./TargetEnvironmentSummary";
import {
  Activity,
  ArchiveRestore,
  CopyPlus,
  Check,
  GripVertical,
  Layers3,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Power,
  ScanLine,
  Server,
  Settings2,
  UserRoundPlus,
  TerminalSquare,
  Unplug
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
  TargetManagementState,
  RemoteAgentEndpoint,
  RemoteDevice,
  RemoteDeviceProbe,
  SshConfigHost,
  SshConfigHostResolution,
  CreateRemoteDeviceInput,
  UpdateRemoteDeviceInput
} from "../../shared/types";
import { reorderPreferenceByDrop, reorderPreferenceByOffset } from "../../shared/uiState";
import { HistoryView } from "./HistoryView";
import { PreviewDialog } from "./PreviewDialog";
import { targetIconFor } from "./ProfileSidebar";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  ControlGroup,
  DialogBody,
  DialogFooter,
  DialogHeader,
  focusInitialActionMenuItem,
  IconButton,
  ModalFrame,
  RefreshAction,
  ToolbarOverflowMenu
} from "./ui";
import { isTargetInstalled } from "../../shared/targetHealth";
import type { EnvironmentReviewSummary } from "../environmentReview";
import type { FreshnessState } from "../freshness";
import { EnvironmentStatusStrip } from "./EnvironmentStatusStrip";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  RemoteDeviceManager,
  type RemoteDeviceManagerHandle
} from "./RemoteDeviceManager";
import { AgentAdvancedSetupDialog } from "./AgentAdvancedSetupDialog";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  remoteDevices: RemoteDevice[];
  remoteEndpoints: RemoteAgentEndpoint[];
  remoteTargets: TargetInfo[];
  remoteDeviceProbes: RemoteDeviceProbe[];
  remoteDevicesBusy: boolean;
  remoteBusyDeviceIds: string[];
  detectedDisabledAgentCount: number;
  targetStates: TargetManagementState[];
  environmentReview: EnvironmentReviewSummary;
  mcpConnections: NativeMcpConnection[];
  backups: BackupSummary[];
  rollbackPreview?: RollbackPreview;
  rollbackError?: string;
  stopManagingPreview?: StopManagingPreview;
  isLoading: boolean;
  busy: boolean;
  freshness: FreshnessState;
  suppressedAgentNames: string[];
  configRoots: Record<string, string>;
  commandOverrides: Record<string, string>;
  onRefresh(): Promise<void>;
  onAddRemoteDevice(input: CreateRemoteDeviceInput): Promise<{
    device: RemoteDevice;
    probe?: RemoteDeviceProbe;
  } | void>;
  onListSshConfigHosts(): Promise<SshConfigHost[]>;
  onResolveSshConfigHost(alias: string): Promise<SshConfigHostResolution>;
  onUpdateRemoteDevice(input: UpdateRemoteDeviceInput): Promise<{
    device: RemoteDevice;
    probe?: RemoteDeviceProbe;
  } | void>;
  onRemoveRemoteDevice(id: string): Promise<void>;
  onRefreshRemoteDevice(id: string): Promise<void>;
  onReorder?(targetIds: string[]): void;
  onChooseAgents(): void;
  onTurnOffAgent(targetId: string): Promise<boolean>;
  onRestoreAgentSuggestions(): Promise<void>;
  onChooseConfigRoot(targetId: string): Promise<void>;
  onResetConfigRoot(targetId: string): Promise<void>;
  onSetCommandOverride(targetId: string, command?: string): Promise<void>;
  onConfigure(targetId: string): void;
  onReviewEnvironment(): void;
  onReviewLocalSkills(): void;
  onCreateProfileFromTarget(targetId: string, returnFocus?: HTMLElement | null): void;
  onManageSkills(targetId: string): void;
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

const installationEvidenceName = (
  evidence: TargetInfo["health"]["installationEvidence"][number],
  t: ReturnType<typeof useI18n>["t"]
) => evidence.kind === "command"
  ? t("{{name}} command", { name: evidence.label.replace(/ command$/, "") })
  : t("{{name}} app", { name: evidence.label.replace(/ app$/, "") });

const executableSourceLabel = (
  health: TargetInfo["health"],
  t: ReturnType<typeof useI18n>["t"]
) => {
  if (health.executableStatus === "unknown") return t("Check failed");
  if (health.executableStatus === "missing") return t("Unavailable");
  if (health.executableSource === "bundled-runtime") return t("Bundled with app");
  if (health.executableSource === "override") return t("Custom command");
  return t("Command detected");
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
  "applied-with-local-override": "Local overrides",
  pending: "Changes pending",
  drifted: "Changed outside AgentEnv",
  "recovery-required": "Recovery required"
};

const TargetRowActions = ({
  target,
  busy,
  expanded,
  configureLabel,
  onConfigure,
  onRecovery,
  recoveryCount,
  onStopManaging,
  onAdvancedSetup,
  onTurnOff,
  turnOffDisabled,
  onCapture,
  onManageSkills,
  onToggleDiagnostics
}: {
  target: TargetInfo;
  busy: boolean;
  expanded: boolean;
  configureLabel: string;
  onConfigure(): void;
  onRecovery?(returnFocus?: HTMLElement | null): void;
  recoveryCount: number;
  onStopManaging?(returnFocus?: HTMLElement | null): void;
  onAdvancedSetup(): void;
  onTurnOff(): void;
  turnOffDisabled: boolean;
  onCapture(returnFocus?: HTMLElement | null): void;
  onManageSkills(): void;
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
    const width = 220;
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
    const menu = menuRef.current;
    if (menu) {
      const bounds = menu.getBoundingClientRect();
      if (bounds.bottom > window.innerHeight - 8) {
        setStyle((current) => ({ ...current, top: Math.max(8, window.innerHeight - bounds.height - 8) }));
      }
    }
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
    <ControlGroup density="compact" className="target-workflow-actions" aria-label={t("Agent actions")}>
      <IconButton
        ref={triggerRef}
        className="target-more-action"
        label={t("More actions for {{name}}", { name: target.name })}
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
          <ActionMenuItem onClick={() => run(onConfigure)}>
            <Layers3 size={15} aria-hidden="true" />
            <span>{configureLabel}</span>
          </ActionMenuItem>
          <ActionMenuItem
            disabled={!installed}
            title={installed ? undefined : t("{{name}} is not detected", { name: target.name })}
            onClick={() => run(onManageSkills)}
          >
            <ScanLine size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("Review local Skills")}</span>
          </ActionMenuItem>
          <ActionMenuItem
            disabled={!installed}
            title={installed ? undefined : t("{{name}} is not detected", { name: target.name })}
            onClick={() => run(() => onCapture(triggerRef.current))}
          >
            <CopyPlus size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("Capture")}</span>
          </ActionMenuItem>
          <ActionMenuItem
            aria-expanded={expanded}
            onClick={() => run(onToggleDiagnostics, true)}
          >
            <Activity size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t(expanded ? "Hide diagnostics" : "Diagnostics")}</span>
          </ActionMenuItem>
          <ActionMenuItem onClick={() => run(onAdvancedSetup)}>
            <Settings2 size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("Advanced setup")}</span>
          </ActionMenuItem>
          {onRecovery ? <ActionMenuItem
            disabled={recoveryCount === 0}
            title={recoveryCount === 0 ? t("No recovery points for this Agent.") : undefined}
            onClick={() => run(() => onRecovery(triggerRef.current))}
          >
            <ArchiveRestore size={15} aria-hidden="true" />
            <span>{t("Recovery")}</span>
          </ActionMenuItem> : null}
          {onStopManaging ? <ActionMenuItem className="target-row-action-menu__ownership" aria-label={t("Stop managing {{name}}", { name: target.name })} onClick={() => run(() => onStopManaging(triggerRef.current))}>
            <Unplug size={15} aria-hidden="true" />
            <span>{t("Stop AgentEnv management")}</span>
          </ActionMenuItem> : null}
          <ActionMenuItem
            disabled={turnOffDisabled}
            title={turnOffDisabled ? t("Resolve recovery before turning this Agent off") : undefined}
            onClick={() => run(onTurnOff)}
          >
            <Power size={15} aria-hidden="true" />
            <span>{t("Turn off Agent")}</span>
          </ActionMenuItem>
        </ActionMenu>,
        document.body
      ) : null}
    </ControlGroup>
  );
};

export const TargetWorkspace = ({
  targets,
  remoteDevices,
  remoteEndpoints,
  remoteTargets,
  remoteDeviceProbes,
  remoteDevicesBusy,
  remoteBusyDeviceIds,
  detectedDisabledAgentCount,
  targetStates,
  environmentReview,
  mcpConnections,
  backups,
  rollbackPreview,
  rollbackError,
  stopManagingPreview,
  isLoading,
  busy,
  freshness,
  suppressedAgentNames,
  configRoots,
  commandOverrides,
  onRefresh,
  onAddRemoteDevice,
  onListSshConfigHosts,
  onResolveSshConfigHost,
  onUpdateRemoteDevice,
  onRemoveRemoteDevice,
  onRefreshRemoteDevice,
  onReorder = () => undefined,
  onChooseAgents,
  onTurnOffAgent,
  onRestoreAgentSuggestions,
  onChooseConfigRoot,
  onResetConfigRoot,
  onSetCommandOverride,
  onConfigure,
  onReviewEnvironment,
  onReviewLocalSkills,
  onCreateProfileFromTarget,
  onManageSkills,
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
  const [reorderMode, setReorderMode] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryTargetId, setRecoveryTargetId] = useState<string>();
  const [stopManagingTargetId, setStopManagingTargetId] = useState<string>();
  const [stopManagingMode, setStopManagingMode] = useState<StopManagingMode>("keep-current");
  const [advancedTargetId, setAdvancedTargetId] = useState<string>();
  const [turnOffTargetId, setTurnOffTargetId] = useState<string>();
  const [suggestionPreferencesOpen, setSuggestionPreferencesOpen] = useState(false);
  const [restoringSuggestions, setRestoringSuggestions] = useState(false);
  const stopManagingReturnFocusRef = useRef<HTMLElement | null>(null);
  const stopManagingDialogRef = useRef<HTMLElement>(null);
  const stopManagingCancelRef = useRef<HTMLButtonElement>(null);
  const recoveryTriggerRef = useRef<HTMLElement>(null);
  const recoveryDialogRef = useRef<HTMLElement>(null);
  const recoveryCloseRef = useRef<HTMLButtonElement>(null);
  const turnOffDialogRef = useRef<HTMLElement>(null);
  const turnOffCancelRef = useRef<HTMLButtonElement>(null);
  const suggestionDialogRef = useRef<HTMLElement>(null);
  const suggestionCloseRef = useRef<HTMLButtonElement>(null);
  const remoteManagerRef = useRef<RemoteDeviceManagerHandle>(null);
  const statesByTarget = new Map(targetStates.map((state) => [state.targetId, state]));
  const recoveryBackups = recoveryTargetId
    ? backups.filter((backup) => backup.targetId === recoveryTargetId || backup.targetIds?.includes(recoveryTargetId))
    : backups;
  const showEnvironmentStatus = environmentReview.state === "unavailable";
  useModalDialog({
    open: Boolean(stopManagingTargetId),
    dialogRef: stopManagingDialogRef,
    initialFocusRef: stopManagingCancelRef,
    fallbackFocusRef: stopManagingReturnFocusRef,
    onDismiss: () => setStopManagingTargetId(undefined),
    dismissDisabled: busy
  });

  useModalDialog({
    open: Boolean(turnOffTargetId),
    dialogRef: turnOffDialogRef,
    initialFocusRef: turnOffCancelRef,
    onDismiss: () => setTurnOffTargetId(undefined),
    dismissDisabled: busy
  });

  useModalDialog({
    open: suggestionPreferencesOpen,
    dialogRef: suggestionDialogRef,
    initialFocusRef: suggestionCloseRef,
    onDismiss: () => setSuggestionPreferencesOpen(false),
    dismissDisabled: restoringSuggestions
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
      <h2 className="ui-visually-hidden">{t("Agents")}</h2>
      {showEnvironmentStatus ? (
        <div className="target-page__context">
          <EnvironmentStatusStrip
            summary={environmentReview}
            busy={busy}
            onRefresh={() => {
              void onRefresh();
            }}
          />
        </div>
      ) : null}

      <div className="target-list" aria-busy={isLoading}>
        <div className="target-list__header">
            <span title={t("Local Agents")} aria-label={t("Local Agents")}><Monitor size={16} aria-hidden="true" /></span>
            <span>{t("Agent")}</span>
            <span>{t("Profile")}</span>
            <div className="target-list__header-actions">
          <ControlGroup className="target-page-actions" aria-label={t("Agent actions")}>
            <Button
              size="compact"
              icon={<UserRoundPlus size={15} />}
              disabled={busy || isLoading}
              onClick={onChooseAgents}
            >
              {t("Choose Agents")}
            </Button>
            <RefreshAction
              disabled={busy || isLoading || freshness.status === "refreshing"}
              label={t("Refresh")}
              state={freshness}
              onRefresh={() => { void onRefresh(); }}
            />
            <ToolbarOverflowMenu
              disabled={busy || isLoading}
              items={[
                ...(environmentReview.state === "shared-review" ? [{ id: "shared-review", label: t("Shared Skills"), icon: <ScanLine size={15} />, onSelect: onReviewEnvironment }] : []),
                {
                  id: "local-skills",
                  icon: <ScanLine size={15} aria-hidden="true" />,
                  label: t("Local Skills"),
                  onSelect: onReviewLocalSkills
                },
                {
                  id: "recovery",
                  icon: <ArchiveRestore size={15} aria-hidden="true" />,
                  label: t("Recovery"),
                  onSelect: (trigger) => {
                    recoveryTriggerRef.current = trigger;
                    setRecoveryTargetId(undefined);
                    setIsRecoveryOpen(true);
                  }
                },
                ...(targets.length > 1 ? [{
                  id: "reorder-agents",
                  icon: reorderMode
                    ? <Check size={15} aria-hidden="true" />
                    : <GripVertical size={15} aria-hidden="true" />,
                  label: t(reorderMode ? "Done reordering" : "Reorder Agents"),
                  onSelect: () => setReorderMode((current) => !current)
                }] : []),
                ...(suppressedAgentNames.length > 0 ? [{
                  id: "agent-suggestions",
                  icon: <UserRoundPlus size={15} aria-hidden="true" />,
                  label: t("Ignored Agent suggestions ({{count}})", { count: suppressedAgentNames.length }),
                  onSelect: () => setSuggestionPreferencesOpen(true)
                }] : []),
                {
                  id: "add-ssh-device",
                  icon: <Server size={14} strokeWidth={2.1} aria-hidden="true" />,
                  label: t("Add SSH device"),
                  onSelect: (trigger) => remoteManagerRef.current?.openAdd(trigger)
                }
              ]}
              label={t("More Agent actions")}
              menuLabel={t("Agent actions")}
            />
          </ControlGroup></div>
          </div>
        {isLoading && targets.length === 0 && remoteDevices.length === 0 ? (
          <div className="target-loading-state" role="status">
            <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
            <span>{t("Detecting Agents")}</span>
          </div>
        ) : targets.length === 0 && remoteDevices.length === 0 ? (
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
          </div>
        ) : null}
        {targets.map((target) => {
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
                onReorder(reorderPreferenceByDrop(
                  targets.map((item) => item.id),
                  draggedTargetId,
                  target.id
                ));
                setDraggedTargetId(undefined);
                setDragOverTargetId(undefined);
              }}
            >
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
                    <span className={`target-health-status target-health-status--${target.health.status}`} title={t(targetStatusLabel[target.health.status])}>
                      <span className={target.health.status === "ready" ? "ui-visually-hidden" : undefined}>{t(targetStatusLabel[target.health.status])}</span>
                    </span>
                  </span>
                </span>
                <TargetEnvironmentSummary
                  lifecycleStatus={state?.lifecycleStatus}
                  lifecycle={t(state?.lifecycleStatus ? lifecycleLabel[state.lifecycleStatus] : isManaged ? "Managed by AgentEnv" : "Not managed")}
                  profileName={state?.activeProfileName}
                  emptyLabel={t("Not configured")}
                />
                {reorderMode ? (
                  <IconButton
                    appearance="inline"
                    className="target-workflow-reorder"
                    label={t("Reorder {{name}}", { name: target.name })}
                    draggable
                    disabled={busy}
                    onDragEnd={() => {
                      setDraggedTargetId(undefined);
                      setDragOverTargetId(undefined);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", target.id);
                      setDraggedTargetId(target.id);
                    }}
                    onKeyDown={(event) => {
                      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      onReorder(reorderPreferenceByOffset(
                        targets.map((item) => item.id),
                        target.id,
                        event.key === "ArrowUp" ? -1 : 1
                      ));
                    }}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </IconButton>
                ) : <TargetRowActions
                  target={target}
                  busy={busy}
                  expanded={isExpanded}
                  recoveryCount={backups.filter(
                    (backup) => backup.targetId === target.id || backup.targetIds?.includes(target.id)
                  ).length}
                  configureLabel={t(state?.activeProfileId ? "Open Profile" : "Configure")}
                  onConfigure={() => onConfigure(target.id)}
                  onRecovery={(returnFocus) => {
                    recoveryTriggerRef.current = returnFocus ?? null;
                    setRecoveryTargetId(target.id);
                    setIsRecoveryOpen(true);
                  }}
                  onStopManaging={isManaged ? (returnFocus) => {
                    stopManagingReturnFocusRef.current = returnFocus ?? null;
                    setStopManagingMode("keep-current");
                    setStopManagingTargetId(target.id);
                  } : undefined}
                  onCapture={(returnFocus) =>
                    onCreateProfileFromTarget(target.id, returnFocus)}
                  onManageSkills={() => onManageSkills(target.id)}
                  onToggleDiagnostics={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
                  onAdvancedSetup={() => setAdvancedTargetId(target.id)}
                  onTurnOff={() => setTurnOffTargetId(target.id)}
                  turnOffDisabled={state?.lifecycleStatus === "recovery-required"}
                />}
              </header>
              {isExpanded ? (
                <section className="target-diagnostics" role="region" aria-label={t("{{name}} diagnostics", { name: target.name })}>
                  <div className="target-checks">
                    {state?.lastAppliedAt ? <div className="target-check">
                      <span>{t("Last applied")}</span>
                      <span>{formatLastApplied(state.lastAppliedAt, localeTag, "")}</span>
                    </div> : null}
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
                        <span>{t("Runtime")}</span>
                        <OverflowTooltip
                          className="target-check-path"
                          displayText={
                            target.health.executableVersion && target.health.executablePath
                              ? `${target.health.executableVersion} · ${target.health.executablePath}`
                              : target.health.executablePath ??
                            target.health.executableOverride ??
                            target.health.executableCandidates.join(" · ")
                          }
                          text={[
                            target.health.executableOverride
                              ? `Override: ${target.health.executableOverride}`
                              : undefined,
                            `Candidates: ${target.health.executableCandidates.join(", ")}`,
                            target.health.executableSource
                              ? `Source: ${target.health.executableSource}`
                              : undefined,
                            target.health.executablePath
                              ? `Resolved: ${target.health.executablePath}`
                              : undefined,
                            target.health.executableVersion
                              ? `Version: ${target.health.executableVersion}`
                              : undefined,
                            target.health.executableError
                              ? `Error: ${target.health.executableError}`
                              : undefined
                          ].filter(Boolean).join("\n")}
                        />
                      </div>
                      <strong>{executableSourceLabel(target.health, t)}</strong>
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
                </section>
              ) : null}
            </article>
          );
        })}
        <RemoteDeviceManager
          ref={remoteManagerRef}
          devices={remoteDevices}
          endpoints={remoteEndpoints}
          probes={remoteDeviceProbes}
          remoteTargets={remoteTargets}
          targetStates={targetStates}
          busy={remoteDevicesBusy}
          busyDeviceIds={remoteBusyDeviceIds}
          onListSshConfigHosts={onListSshConfigHosts}
          onResolveSshConfigHost={onResolveSshConfigHost}
          onAdd={onAddRemoteDevice}
          onUpdate={onUpdateRemoteDevice}
          onRemove={onRemoveRemoteDevice}
          onRefreshDevice={onRefreshRemoteDevice}
          onOpenProfile={onConfigure}
        />
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
              description={recoveryTargetId ? targets.find((target) => target.id === recoveryTargetId)?.name : t("Backups created before managed applies.")}
              actions={<span>{t(recoveryBackups.length === 1 ? "{{count}} backup" : "{{count}} backups", { count: recoveryBackups.length })}</span>}
            />
            <DialogBody className="target-recovery-dialog__body">
              <HistoryView
                backups={recoveryBackups}
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
      <AgentAdvancedSetupDialog
        open={Boolean(advancedTargetId)}
        target={targets.find((target) => target.id === advancedTargetId)}
        busy={busy}
        configRoot={advancedTargetId ? configRoots[advancedTargetId] : undefined}
        commandOverride={advancedTargetId ? commandOverrides[advancedTargetId] : undefined}
        managementState={advancedTargetId ? statesByTarget.get(advancedTargetId) : undefined}
        onClose={() => setAdvancedTargetId(undefined)}
        onResolveOwnership={(targetId) => {
          const state = statesByTarget.get(targetId);
          setAdvancedTargetId(undefined);
          if (state?.lifecycleStatus === "recovery-required") {
            setRecoveryTargetId(targetId);
            setIsRecoveryOpen(true);
          } else {
            setStopManagingMode("keep-current");
            setStopManagingTargetId(targetId);
          }
        }}
        onChooseConfigRoot={onChooseConfigRoot}
        onResetConfigRoot={onResetConfigRoot}
        onSetCommandOverride={onSetCommandOverride}
      />
      {turnOffTargetId ? (
        <ModalFrame
          ariaLabel={t("Turn off {{name}}?", { name: targets.find((target) => target.id === turnOffTargetId)?.name ?? "" })}
          className="profile-form-dialog profile-form-dialog--compact ui-dialog-shell"
          dialogRef={turnOffDialogRef}
          dismissDisabled={busy}
          onDismiss={() => setTurnOffTargetId(undefined)}
        >
          <DialogHeader
            title={t("Turn off {{name}}?", { name: targets.find((target) => target.id === turnOffTargetId)?.name ?? "" })}
            description={t("Its files stay unchanged. AgentEnv will hide this Agent and stop checking or applying to it until you turn it on again.")}
          />
          <DialogFooter>
            <Button ref={turnOffCancelRef} disabled={busy} onClick={() => setTurnOffTargetId(undefined)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={busy}
              onClick={() => void onTurnOffAgent(turnOffTargetId).then((saved) => {
                if (saved) setTurnOffTargetId(undefined);
              })}
            >
              {t("Turn off Agent")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {suggestionPreferencesOpen ? (
        <ModalFrame
          ariaLabel={t("Agent suggestions")}
          className="profile-form-dialog profile-form-dialog--compact ui-dialog-shell"
          dialogRef={suggestionDialogRef}
          dismissDisabled={restoringSuggestions}
          onDismiss={() => setSuggestionPreferencesOpen(false)}
        >
          <DialogHeader
            title={t("Agent suggestions")}
            description={t("Choose whether AgentEnv may suggest Agents you previously ignored when they are detected again.")}
          />
          <DialogBody>
            <div className="agent-suggestion-summary">
              <span>{t("Ignored suggestions")}</span>
              <strong>{suppressedAgentNames.length > 0 ? suppressedAgentNames.join(", ") : t("None")}</strong>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button ref={suggestionCloseRef} disabled={restoringSuggestions} onClick={() => setSuggestionPreferencesOpen(false)}>{t("Close")}</Button>
            {suppressedAgentNames.length > 0 ? (
              <Button
                variant="primary"
                busy={restoringSuggestions}
                onClick={() => {
                  setRestoringSuggestions(true);
                  void onRestoreAgentSuggestions().finally(() => setRestoringSuggestions(false));
                }}
              >
                {t("Allow future suggestions")}
              </Button>
            ) : null}
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
