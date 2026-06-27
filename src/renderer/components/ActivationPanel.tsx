import type { ActivationPreview, BackupSummary, RollbackPreview } from "../../shared/types";
import { HistoryView } from "./HistoryView";

interface ActivationPanelProps {
  selectedProfileId?: string;
  targetName?: string;
  preview?: ActivationPreview;
  rollbackPreview?: RollbackPreview;
  backups: BackupSummary[];
  busy: boolean;
  targetCanWrite: boolean;
  targetWriteSummary?: string;
  onPreview(): void;
  onApply(): void;
  onPreviewRollback(backupId: string): void;
  onRestoreRollback(): void;
}

export const ActivationPanel = ({
  selectedProfileId,
  targetName = "target",
  preview,
  rollbackPreview,
  backups,
  busy,
  targetCanWrite,
  targetWriteSummary,
  onPreview,
  onApply,
  onPreviewRollback,
  onRestoreRollback
}: ActivationPanelProps) => {
  const activePreview = rollbackPreview ?? preview;
  const targetBlocked = Boolean(preview && !rollbackPreview && !targetCanWrite);
  const canApply = Boolean(preview && preview.errors.length === 0 && !rollbackPreview && targetCanWrite);
  const canRestore = Boolean(rollbackPreview && rollbackPreview.errors.length === 0);
  const isBlocked = Boolean(activePreview && activePreview.errors.length > 0) || targetBlocked;
  const statusLabel = targetBlocked
    ? "Target blocked"
    : isBlocked
    ? "Blocked"
    : canRestore
      ? "Rollback ready"
      : canApply
      ? "Ready to apply"
      : "Preview required";
  const changedCount = activePreview?.changes.length ?? 0;

  return (
    <aside className="activation-panel" aria-label="Activation">
      <div className="activation-header">
        <p className="section-title">Activation Console</p>
        <h2>{targetName}</h2>
      </div>
      <div className={`status-card${isBlocked ? " is-blocked" : ""}`}>
        <span className={`status-dot${canApply ? " is-ready" : ""}`} />
        <div>
          <strong>{statusLabel}</strong>
          <small>
            {targetBlocked
              ? targetWriteSummary ?? "Target is not writable"
              : canRestore
              ? `${changedCount} files will restore`
              : canApply
              ? `${changedCount} files will change`
              : isBlocked
                ? "Resolve conflicts before applying"
                : "Review changes before applying"}
          </small>
        </div>
      </div>
      <button className="primary-action" type="button" disabled={!selectedProfileId || busy} onClick={onPreview}>
        Preview changes
      </button>
      <button className="apply-action" type="button" disabled={!canApply || busy} onClick={onApply}>
        Apply to {targetName}
      </button>
      <section className="will-touch" aria-label="Files to modify">
        <div className="section-title">Change Set</div>
        {activePreview ? (
          <>
            <p className="muted">
              {rollbackPreview ? `${changedCount} planned restores` : `${changedCount} planned file updates`}
            </p>
            <div className="path-list">
              {activePreview.changes.map((change) => (
                <div className="path-row" key={change.path}>
                  <span>{change.path}</span>
                  <small>{rollbackPreview ? "Restore" : "Modify"}</small>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">No changes will be made until Preview runs.</p>
        )}
      </section>
      <section className="safety-checks" aria-label="Safety checks">
        <div className="section-title">Safety Gates</div>
        <div className="check-row">
          <span>Automatic backup</span>
          <strong>Enabled</strong>
        </div>
        <div className="check-row">
          <span>Scoped changes</span>
          <strong>Enforced</strong>
        </div>
        <div className="check-row">
          <span>Preview freshness</span>
          <strong>{activePreview ? "Fresh" : "Required"}</strong>
        </div>
        <div className={`check-row${targetCanWrite ? "" : " check-row--error"}`}>
          <span>Target access</span>
          <strong>{targetCanWrite ? "Writable" : "Blocked"}</strong>
        </div>
      </section>
      <HistoryView
        backups={backups}
        busy={busy}
        rollbackPreview={rollbackPreview}
        onPreviewRollback={onPreviewRollback}
        onRestoreRollback={onRestoreRollback}
      />
    </aside>
  );
};
