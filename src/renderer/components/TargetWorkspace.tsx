import {
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

const formatLastApplied = (value?: string) => {
  if (!value) return "Never applied";
  return new Intl.DateTimeFormat(undefined, {
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
  const [expandedTargetId, setExpandedTargetId] = useState<string>();
  const [stopManagingTargetId, setStopManagingTargetId] = useState<string>();
  const [stopManagingMode, setStopManagingMode] = useState<StopManagingMode>("keep-current");
  const stopManagingReturnFocusRef = useRef<HTMLElement | null>(null);
  const stopManagingDialogRef = useRef<HTMLElement>(null);
  const stopManagingCancelRef = useRef<HTMLButtonElement>(null);
  const statesByTarget = new Map(targetStates.map((state) => [state.targetId, state]));

  useModalDialog({
    open: Boolean(stopManagingTargetId),
    dialogRef: stopManagingDialogRef,
    initialFocusRef: stopManagingCancelRef,
    fallbackFocusRef: stopManagingReturnFocusRef,
    onDismiss: () => setStopManagingTargetId(undefined),
    dismissDisabled: busy
  });

  return (
    <section className="target-page" aria-label="Targets">
      <header className="page-header workspace-page-header">
        <div>
          <h2 aria-label="Targets">
            Targets
            <InfoTip label="Targets are local agent runtimes. Manage profiles from Profiles and inspect runtime paths here only when diagnosing a problem." />
          </h2>
          <p>Inspect local agent runtimes, management state, and recovery points.</p>
        </div>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={() => { void onRefresh(); }}
        >
          <RefreshCw size={15} strokeWidth={2.2} />
          {busy ? "Refreshing..." : "Refresh targets"}
        </button>
      </header>

      <div className="target-list">
        {targets.length === 0 ? (
          <div className="inline-state inline-state--panel">
            <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
            <span>No supported targets detected</span>
          </div>
        ) : null}
        {targets.map((target) => {
          const state = statesByTarget.get(target.id);
          const isManaged = state?.status === "managed";
          const isExpanded = expandedTargetId === target.id;
          const icon = targetIconFor(target);
          return (
            <article aria-label={`Target ${target.name}`} className="target-card target-card--workflow" key={target.id}>
              <header className="target-workflow-header">
                <span className={`target-workflow-icon target-workflow-icon--${icon.flavor}`} aria-hidden="true">
                  {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <TerminalSquare size={20} />}
                </span>
                <span className="target-workflow-title">
                  <strong>{target.name}</strong>
                  <small>{target.description}</small>
                </span>
                <span className={`target-badge target-badge--${target.health.status}`}>
                  {targetStatusLabel[target.health.status]}
                </span>
                <span className="target-workflow-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    aria-label={`Create profile from ${target.name}`}
                    disabled={busy || !target.health.executableFound}
                    title={target.health.executableFound ? undefined : `${target.name} command is missing`}
                    onClick={() => onCreateProfileFromTarget(target.id)}
                  >
                    <Plus size={14} strokeWidth={2.2} />
                    Create Profile
                  </button>
                  <button
                    className="primary-inline-action"
                    type="button"
                    aria-label={`Open ${target.name} in Profiles`}
                    onClick={() => onManageTarget(target.id)}
                  >
                    Open
                    <ArrowRight size={14} strokeWidth={2.2} />
                  </button>
                </span>
              </header>

              <div className="target-state-grid">
                <span>
                  <small>Command</small>
                  <strong>{target.health.executableFound ? "Detected" : "Missing"}</strong>
                </span>
                <span>
                  <small>Management</small>
                  <strong>{state?.lifecycleStatus ? lifecycleLabel[state.lifecycleStatus] : isManaged ? "Managed by AgentEnv" : "Not managed"}</strong>
                </span>
                <span>
                  <small>Active profile</small>
                  <strong>{state?.activeProfileName ?? "None"}</strong>
                </span>
                <span>
                  <small>Last applied</small>
                  <strong><Clock3 size={13} />{formatLastApplied(state?.lastAppliedAt)}</strong>
                </span>
              </div>

              <button
                className="target-diagnostics-toggle"
                type="button"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Hide" : "Show"} ${target.name} diagnostics`}
                onClick={() => setExpandedTargetId(isExpanded ? undefined : target.id)}
              >
                Diagnostics
                {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {isExpanded ? (
                <section className="target-diagnostics" role="region" aria-label={`${target.name} diagnostics`}>
                  <div className="target-config-path">
                    <span>Config directory</span>
                    <code title={target.paths.configDir}>{target.paths.configDir}</code>
                  </div>
                  <div className="target-checks">
                    {target.health.checks.map((check) => (
                      <div className="target-check" key={check.id}>
                        <div><span>{check.label}</span><code title={check.path}>{check.path}</code></div>
                        <strong>{check.exists ? (check.writable ? "Writable" : "Read-only") : "Missing"}</strong>
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
                        Stop managing {target.name}
                      </button>
                    </footer>
                  ) : null}
                </section>
              ) : null}
            </article>
          );
        })}
      </div>

      <section className="target-recovery" aria-label="Recovery">
        <div className="target-recovery__header">
          <div><strong>Recovery</strong><small>Backups created before managed applies.</small></div>
          <span>{backups.length} backups</span>
        </div>
        <HistoryView
          backups={backups}
          busy={busy}
          rollbackPreview={undefined}
          onPreviewRollback={onPreviewRollback}
          onRestoreRollback={onRestoreRollback}
        />
      </section>
      {rollbackPreview ? (
        <PreviewDialog
          preview={rollbackPreview}
          title="Rollback preview"
          confirmLabel="Restore backup"
          confirmDisabled={busy || rollbackPreview.errors.length > 0}
          cancelDisabled={busy}
          errorMessage={rollbackError}
          onCancel={busy ? undefined : onCancelRollback}
          onConfirm={onRestoreRollback}
        />
      ) : null}
      {stopManagingTargetId ? (
        <div className="preview-modal-backdrop" onClick={() => setStopManagingTargetId(undefined)}>
          <section ref={stopManagingDialogRef} className="profile-form-dialog stop-managing-dialog" role="dialog" aria-modal="true" aria-label="Stop managing Target" onClick={(event) => event.stopPropagation()}>
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Stop managing {targets.find((target) => target.id === stopManagingTargetId)?.name}</div>
                <p className="muted">Choose what should happen to the current Target environment.</p>
              </div>
            </header>
            <div className="stop-managing-options" role="radiogroup" aria-label="Stop managing behavior">
              <label>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "keep-current"} onChange={() => setStopManagingMode("keep-current")} />
                <span><strong>Keep current environment</strong><small>Detach AgentEnv ownership and turn linked Skills into independent files.</small></span>
              </label>
              <label>
                <input type="radio" name="stop-managing-mode" checked={stopManagingMode === "restore-pre-takeover"} onChange={() => setStopManagingMode("restore-pre-takeover")} />
                <span><strong>Restore environment before takeover</strong><small>Replace current managed files with the earliest pre-takeover backup.</small></span>
              </label>
            </div>
            <footer className="preview-actions">
              <button ref={stopManagingCancelRef} className="secondary-action" type="button" onClick={() => setStopManagingTargetId(undefined)}>Cancel</button>
              <button className="danger-action" type="button" disabled={busy} onClick={() => {
                onPreviewStopManaging(stopManagingTargetId, stopManagingMode);
                setStopManagingTargetId(undefined);
              }}>Review changes</button>
            </footer>
          </section>
        </div>
      ) : null}
      {stopManagingPreview ? (
        <PreviewDialog
          preview={stopManagingPreview}
          title={`Stop managing ${stopManagingPreview.targetName}`}
          confirmLabel={stopManagingPreview.mode === "keep-current" ? "Keep files and detach" : "Restore and detach"}
          confirmDisabled={busy || stopManagingPreview.errors.length > 0}
          cancelDisabled={busy}
          onCancel={onCancelStopManaging}
          onConfirm={onStopManaging}
        />
      ) : null}
    </section>
  );
};
