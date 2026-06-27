import type { ActivationPreview, BackupSummary, RollbackPreview } from "../../shared/types";
import { HistoryView } from "./HistoryView";

interface ActivationPanelProps {
  selectedProfileId?: string;
  targetName?: string;
  preview?: ActivationPreview;
  rollbackPreview?: RollbackPreview;
  backups: BackupSummary[];
  busy: boolean;
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
  onPreview,
  onApply,
  onPreviewRollback,
  onRestoreRollback
}: ActivationPanelProps) => {
  const activePreview = rollbackPreview ?? preview;
  const canApply = Boolean(preview && preview.errors.length === 0 && !rollbackPreview);
  const canRestore = Boolean(rollbackPreview && rollbackPreview.errors.length === 0);
  const isBlocked = Boolean(activePreview && activePreview.errors.length > 0);
  const statusLabel = isBlocked
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
        <p className="section-title">Activation</p>
        <h2>{targetName}</h2>
      </div>
      <div className={`status-card${isBlocked ? " is-blocked" : ""}`}>
        <span className={`status-dot${canApply ? " is-ready" : ""}`} />
        <div>
          <strong>{statusLabel}</strong>
          <small>
            {canRestore
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
        <div className="section-title">Will touch</div>
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
        <div className="section-title">Safety</div>
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
