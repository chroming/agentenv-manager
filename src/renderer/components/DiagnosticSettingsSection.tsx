import { Copy, FileDown, FolderOpen, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";

export const DiagnosticSettingsSection = ({
  busy,
  onCopyLatest,
  onExport,
  onOpenLogs
}: {
  busy: boolean;
  onCopyLatest(): Promise<void>;
  onExport(): Promise<void>;
  onOpenLogs(): Promise<void>;
}) => {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);

  const exportReport = async () => {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  return (
    <section
      className="resource-section settings-section diagnostics-settings-section"
      aria-labelledby="agentenv-diagnostics-heading"
    >
      <div className="settings-section-header">
        <div className="diagnostics-settings-copy">
          <div className="resource-heading" id="agentenv-diagnostics-heading">
            {t("Diagnostics")}
          </div>
          <p className="settings-muted">
            {t("Copy or export redacted operation details when troubleshooting another device. Logs stay on this Mac.")}
          </p>
        </div>
      </div>
      <div className="diagnostics-settings-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={() => void onCopyLatest()}
        >
          <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
          {t("Copy latest issue")}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy || exporting}
          aria-busy={exporting}
          onClick={() => void exportReport()}
        >
          {exporting ? (
            <LoaderCircle
              className="is-spinning"
              size={15}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          ) : (
            <FileDown size={15} strokeWidth={2.2} aria-hidden="true" />
          )}
          {t("Export report")}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={() => void onOpenLogs()}
        >
          <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />
          {t("Open logs")}
        </button>
      </div>
    </section>
  );
};
