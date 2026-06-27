import type { BackupSummary } from "../../shared/types";

interface HistoryViewProps {
  backups: BackupSummary[];
}

export const HistoryView = ({ backups }: HistoryViewProps) => (
  <section className="history-view" aria-label="History">
    <div className="section-title">History</div>
    {backups.length === 0 ? <p className="muted">No backups</p> : null}
    {backups.map((backup) => (
      <div className="history-row" key={backup.id}>
        <span>{backup.id}</span>
        <small>{backup.fileCount} files</small>
      </div>
    ))}
  </section>
);
