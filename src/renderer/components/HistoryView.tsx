import type { BackupSummary, RollbackPreview } from "../../shared/types";

interface HistoryViewProps {
  backups: BackupSummary[];
  busy: boolean;
  rollbackPreview?: RollbackPreview;
  onPreviewRollback(backupId: string): void;
  onRestoreRollback(): void;
}

export const HistoryView = ({
  backups,
  busy,
  rollbackPreview,
  onPreviewRollback,
  onRestoreRollback
}: HistoryViewProps) => (
  <section className="history-view" aria-label="History">
    <div className="section-title">History</div>
    {backups.length === 0 ? <p className="muted">No backups</p> : null}
    {backups.map((backup) => (
      <div
        className={`history-row${rollbackPreview?.backupId === backup.id ? " is-active" : ""}`}
        key={backup.id}
      >
        <div className="history-row__main">
          <span>{backup.id}</span>
          <small>{backup.fileCount} files</small>
        </div>
        <div className="history-actions">
          <button
            className="history-action"
            type="button"
            disabled={busy}
            aria-label={`Preview rollback ${backup.id}`}
            onClick={() => onPreviewRollback(backup.id)}
          >
            Preview rollback
          </button>
          {rollbackPreview?.backupId === backup.id ? (
            <button
              className="restore-action"
              type="button"
              disabled={busy || rollbackPreview.errors.length > 0}
              onClick={onRestoreRollback}
            >
              Restore backup
            </button>
          ) : null}
        </div>
        {rollbackPreview?.backupId === backup.id ? (
          <small className="history-status">
            {rollbackPreview.errors.length > 0
              ? "Resolve rollback errors before restore"
              : `${rollbackPreview.changes.length} files ready to restore`}
          </small>
        ) : null}
      </div>
    ))}
  </section>
);
