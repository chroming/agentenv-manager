import { useRef, useState } from "react";
import { CheckCircle2, Copy, FileDown, TriangleAlert } from "lucide-react";
import type { DiagnosticIssueDetail } from "../../shared/types";
import { formatDiagnosticIssue } from "../diagnostics";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button } from "./ui";

export const DiagnosticIssueDialog = ({
  issue,
  onDismiss
}: {
  issue?: DiagnosticIssueDetail;
  onDismiss(): void;
}) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState("");

  useModalDialog({
    open: Boolean(issue),
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss
  });

  if (!issue) return null;

  const copyIssue = async () => {
    setActionError("");
    try {
      await window.agentEnv.copyText(formatDiagnosticIssue(issue));
      setCopied(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };
  const exportIssue = async () => {
    setExporting(true);
    setActionError("");
    try {
      await window.agentEnv.exportDiagnostics(issue.reference);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="preview-modal-backdrop"
      data-dismiss-policy="standard"
      onClick={onDismiss}
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog diagnostic-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostic-issue-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header">
          <span className="diagnostic-issue-icon" aria-hidden="true">
            <TriangleAlert size={18} />
          </span>
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title" id="diagnostic-issue-title">
              {t("Diagnostic details")}
            </div>
            <p className="muted ui-dialog-description">
              {issue.action} · {formatDate(issue.occurredAt)}
            </p>
          </div>
        </header>
        <div className="diagnostic-issue-summary">
          <div>
            <span>{t("Reference")}</span>
            <code>{issue.reference}</code>
          </div>
          {issue.durationMs !== undefined ? (
            <div>
              <span>{t("Duration")}</span>
              <strong>{issue.durationMs} ms</strong>
            </div>
          ) : null}
        </div>
        <div className="diagnostic-issue-content">
          {actionError ? (
            <div className="diagnostic-issue-error" role="alert">{actionError}</div>
          ) : null}
          <section>
            <h3>{t("Original error")}</h3>
            <pre>{`${issue.error.name}: ${issue.error.message}`}</pre>
          </section>
          {issue.context ? (
            <section>
              <h3>{t("Operation context")}</h3>
              <pre>{JSON.stringify(issue.context, null, 2)}</pre>
            </section>
          ) : null}
          {issue.error.stack ? (
            <section>
              <h3>{t("Stack trace")}</h3>
              <pre>{issue.error.stack}</pre>
            </section>
          ) : null}
          {issue.error.causes.map((cause, index) => (
            <section key={`${cause.name}:${index}`}>
              <h3>{t("Cause {{count}}", { count: index + 1 })}</h3>
              <pre>{[
                `${cause.name}: ${cause.message}`,
                cause.code ? `Code: ${cause.code}` : undefined,
                cause.errno === undefined ? undefined : `Errno: ${cause.errno}`,
                cause.stack
              ].filter(Boolean).join("\n")}</pre>
            </section>
          ))}
        </div>
        <footer className="preview-actions">
          <Button
            icon={copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
            onClick={() => void copyIssue()}
          >
            {t(copied ? "Copied" : "Copy details")}
          </Button>
          <Button
            busy={exporting}
            icon={<FileDown size={15} />}
            onClick={() => void exportIssue()}
          >
            {t(exporting ? "Exporting..." : "Export report")}
          </Button>
          <Button ref={closeRef} onClick={onDismiss}>
            {t("Close")}
          </Button>
        </footer>
      </section>
    </div>
  );
};
