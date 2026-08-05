import { Copy, FileDown, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Button, IconButton } from "./ui";

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
  const [hasLatestIssue, setHasLatestIssue] = useState(false);

  useEffect(() => {
    let active = true;
    void window.agentEnv.readLatestDiagnosticIssue()
      .then((issue) => {
        if (active) setHasLatestIssue(Boolean(issue));
      })
      .catch(() => {
        if (active) setHasLatestIssue(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
            {t("Logs & diagnostics")}
          </div>
          <p className="settings-muted">
            {t("Normal operations, decisions, timing, and failures are recorded locally. Exported reports are redacted and never uploaded automatically.")}
          </p>
        </div>
      </div>
      <div className="diagnostics-settings-actions settings-row-actions">
        <Button
          busy={exporting}
          disabled={busy || exporting}
          icon={<FileDown size={15} strokeWidth={2.2} aria-hidden="true" />}
          onClick={() => void exportReport()}
        >
          {t("Export report")}
        </Button>
        <Button
          disabled={busy}
          icon={<FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />}
          onClick={() => void onOpenLogs()}
        >
          {t("Open logs")}
        </Button>
        {hasLatestIssue ? (
          <IconButton
            disabled={busy || exporting}
            label={t("Copy latest issue")}
            onClick={() => void onCopyLatest()}
          >
            <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </section>
  );
};
