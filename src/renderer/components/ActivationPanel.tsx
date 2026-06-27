import type { ActivationPreview, BackupSummary } from "../../shared/types";
import { HistoryView } from "./HistoryView";

interface ActivationPanelProps {
  selectedProfileId?: string;
  preview?: ActivationPreview;
  backups: BackupSummary[];
  busy: boolean;
  onPreview(): void;
  onApply(): void;
}

export const ActivationPanel = ({
  selectedProfileId,
  preview,
  backups,
  busy,
  onPreview,
  onApply
}: ActivationPanelProps) => {
  const canApply = Boolean(preview && preview.errors.length === 0);

  return (
    <aside className="activation-panel" aria-label="Activation">
      <h2>Activation</h2>
      <div className="status-card">
        <span className={`status-dot${canApply ? " is-ready" : ""}`} />
        <strong>{canApply ? "Ready" : "Preview required"}</strong>
      </div>
      <button type="button" disabled={!selectedProfileId || busy} onClick={onPreview}>
        Preview
      </button>
      <button type="button" disabled={!canApply || busy} onClick={onApply}>
        Apply
      </button>
      <HistoryView backups={backups} />
    </aside>
  );
};
