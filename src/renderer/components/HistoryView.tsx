import type { BackupSummary, RollbackPreview } from "../../shared/types";
import { useI18n } from "../i18n";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";

interface HistoryViewProps {
  backups: BackupSummary[];
  busy: boolean;
  rollbackPreview?: RollbackPreview;
  targetNames?: TargetNameIndex;
  onPreviewRollback(backupId: string): void;
  onRestoreRollback(): void;
}

export const HistoryView = ({
  backups,
  busy,
  rollbackPreview,
  targetNames = {},
  onPreviewRollback,
  onRestoreRollback
}: HistoryViewProps) => {
  const { t, formatDate } = useI18n();

  return (
  <section className="history-view" aria-label={t("History")}>
    <div className="section-title">{t("History")}</div>
    {backups.length === 0 ? <p className="muted">{t("No backups")}</p> : null}
    {backups.map((backup) => (
      <div
        className={`history-row${rollbackPreview?.backupId === backup.id ? " is-active" : ""}`}
        key={backup.id}
      >
        <div className="history-row__main">
          <span>{backup.profileName ? `${backup.profileName} → ${targetNameFor(backup.targetId, targetNames, "Local files")}` : t("System backup · {{target}}", { target: targetNameFor(backup.targetId, targetNames, "Local files") })}</span>
          <small>
            {backup.operation === "apply" ? t("Before Profile apply") : t("Filesystem snapshot")} · {t("{{count}} files", { count: backup.fileCount })} ·{" "}
            {formatDate(backup.createdAt)}
          </small>
        </div>
        <div className="history-actions">
          <button
            className="history-action"
            type="button"
            disabled={busy}
            aria-label={t("Preview restore {{name}}", { name: backup.profileName ?? backup.id })}
            onClick={() => onPreviewRollback(backup.id)}
          >
            {t("Preview")}
          </button>
          {rollbackPreview?.backupId === backup.id ? (
            <button
              className="restore-action"
              type="button"
              disabled={busy || rollbackPreview.errors.length > 0}
              onClick={onRestoreRollback}
            >
              {t("Restore backup")}
            </button>
          ) : null}
        </div>
        {rollbackPreview?.backupId === backup.id ? (
          <small className="history-status">
            {rollbackPreview.errors.length > 0
              ? t("Resolve rollback errors before restore")
              : t("{{count}} files ready to restore", { count: rollbackPreview.changes.length })}
          </small>
        ) : null}
      </div>
    ))}
  </section>
  );
};
