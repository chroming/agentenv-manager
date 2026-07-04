import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Monitor,
  MonitorCheck,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert
} from "lucide-react";
import { useState } from "react";
import type {
  BackupSummary,
  RollbackPreview,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { HistoryView } from "./HistoryView";
import { InfoTip } from "./InfoTip";
import { PreviewDialog } from "./PreviewDialog";
import { targetIconFor } from "./ProfileSidebar";

interface TargetWorkspaceProps {
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  backups: BackupSummary[];
  rollbackPreview?: RollbackPreview;
  rollbackError?: string;
  busy: boolean;
  onRefresh(): void;
  onManageTarget(targetId: string): void;
  onPreviewRollback(backupId: string): void;
  onCancelRollback(): void;
  onRestoreRollback(): void;
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

export const TargetWorkspace = ({
  targets,
  targetStates,
  backups,
  rollbackPreview,
  rollbackError,
  busy,
  onRefresh,
  onManageTarget,
  onPreviewRollback,
  onCancelRollback,
  onRestoreRollback
}: TargetWorkspaceProps) => {
  const [expandedTargetId, setExpandedTargetId] = useState<string>();
  const statesByTarget = new Map(targetStates.map((state) => [state.targetId, state]));
  const readyCount = targets.filter((target) => target.health.status === "ready").length;
  const managedCount = targetStates.filter((state) => state.status === "managed").length;
  const attentionCount = targets.filter((target) => {
    const state = statesByTarget.get(target.id);
    return (
      target.health.status !== "ready" ||
      Boolean(state && (state.warningCount > 0 || state.errorCount > 0))
    );
  }).length;

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
        <button className="secondary-action" type="button" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={15} strokeWidth={2.2} />
          Refresh targets
        </button>
      </header>

      <section className="target-summary" aria-label="Target summary">
        <span><MonitorCheck size={17} /><strong>{readyCount}</strong> ready</span>
        <span><ShieldCheck size={17} /><strong>{managedCount}</strong> managed</span>
        <span className={attentionCount > 0 ? "is-warning" : ""}>
          <TriangleAlert size={17} /><strong>{attentionCount}</strong> need attention
        </span>
      </section>

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
                <button
                  className="primary-inline-action"
                  type="button"
                  aria-label={`Open ${target.name} in Profiles`}
                  onClick={() => onManageTarget(target.id)}
                >
                  Open in Profiles
                  <ArrowRight size={14} strokeWidth={2.2} />
                </button>
              </header>

              <div className="target-state-grid">
                <span>
                  <small>Command</small>
                  <strong>{target.health.executableFound ? "Detected" : "Missing"}</strong>
                </span>
                <span>
                  <small>Management</small>
                  <strong>{isManaged ? "Managed by AgentEnv" : "Not managed"}</strong>
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
    </section>
  );
};
