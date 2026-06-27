import type { ActivationPreview, BackupSummary } from "../../shared/types";
import { HistoryView } from "./HistoryView";

interface ActivationPanelProps {
  selectedProfileId?: string;
  targetName?: string;
  preview?: ActivationPreview;
  backups: BackupSummary[];
  busy: boolean;
  onPreview(): void;
  onApply(): void;
}

export const ActivationPanel = ({
  selectedProfileId,
  targetName = "target",
  preview,
  backups,
  busy,
  onPreview,
  onApply
}: ActivationPanelProps) => {
  const canApply = Boolean(preview && preview.errors.length === 0);
  const isBlocked = Boolean(preview && preview.errors.length > 0);
  const statusLabel = isBlocked
    ? "Blocked"
    : canApply
      ? "Ready to apply"
      : "Preview required";
  const changedCount = preview?.changes.length ?? 0;

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
            {canApply
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
        {preview ? (
          <>
            <p className="muted">{changedCount} planned file updates</p>
            <div className="path-list">
              {preview.changes.map((change) => (
                <div className="path-row" key={change.path}>
                  <span>{change.path}</span>
                  <small>Modify</small>
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
          <strong>{preview ? "Fresh" : "Required"}</strong>
        </div>
      </section>
      <HistoryView backups={backups} />
    </aside>
  );
};
