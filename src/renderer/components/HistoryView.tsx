import type { BackupSummary, RollbackPreview } from "../../shared/types";

const targetName = (targetId?: string) => {
  if (targetId === "opencode") return "OpenCode";
  if (targetId === "codex") return "Codex";
  if (targetId === "claude-code") return "Claude Code";
  return "Local files";
};

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
          <span>{backup.profileName ? `${backup.profileName} → ${targetName(backup.targetId)}` : `System backup · ${targetName(backup.targetId)}`}</span>
          <small>
            {backup.operation === "apply" ? "Before Profile apply" : "Filesystem snapshot"} · {backup.fileCount} files ·{" "}
            {new Date(backup.createdAt).toLocaleString()}
          </small>
        </div>
        <div className="history-actions">
          <button
            className="history-action"
            type="button"
            disabled={busy}
            aria-label={`Preview restore ${backup.profileName ?? backup.id}`}
            onClick={() => onPreviewRollback(backup.id)}
          >
            Preview
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
