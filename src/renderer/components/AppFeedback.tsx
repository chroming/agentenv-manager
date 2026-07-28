import { CheckCircle2, Copy, RefreshCw, Settings2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDiagnosticIssue } from "../diagnostics";
import { useI18n } from "../i18n";

export type AppFeedbackKind = "loading" | "success" | "warning" | "error" | "info";

export interface AppFeedbackMessage {
  kind: AppFeedbackKind;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick(): void;
  };
  diagnosticReference?: string;
}

export const AppFeedback = ({
  feedback,
  onDismiss,
  onViewDiagnostic
}: {
  feedback?: AppFeedbackMessage;
  onDismiss(): void;
  onViewDiagnostic?(reference: string): void;
}) => {
  const { t } = useI18n();
  const onDismissRef = useRef(onDismiss);
  const [copied, setCopied] = useState(false);
  onDismissRef.current = onDismiss;
  const feedbackKey = feedback
    ? `${feedback.kind}\u0000${feedback.title}\u0000${feedback.message ?? ""}\u0000${feedback.diagnosticReference ?? ""}`
    : "";

  useEffect(() => {
    if (!feedback || (feedback.kind !== "success" && feedback.kind !== "info")) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => onDismissRef.current(), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [feedbackKey, feedback?.kind]);

  useEffect(() => {
    setCopied(false);
  }, [feedbackKey]);

  if (!feedback) return null;

  const dismissible = feedback.kind === "error" || feedback.kind === "warning";
  const Icon =
    dismissible
      ? TriangleAlert
      : feedback.kind === "loading"
        ? RefreshCw
        : feedback.kind === "success"
          ? CheckCircle2
          : Settings2;
  const copyFeedback = async () => {
    const issue = feedback.diagnosticReference
      ? await window.agentEnv.readDiagnosticIssue(feedback.diagnosticReference)
          .catch(() => undefined)
      : undefined;
    const text = issue
      ? formatDiagnosticIssue(issue)
      : [
          feedback.title,
          feedback.message,
          feedback.diagnosticReference
            ? `Reference: ${feedback.diagnosticReference}`
            : undefined
        ].filter(Boolean).join("\n");
    await window.agentEnv.copyText(text);
    setCopied(true);
  };

  return (
    <div
      className={`app-feedback app-feedback--${feedback.kind}${
        dismissible ? " app-feedback--dismissible" : ""
      }`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <Icon
        className={feedback.kind === "loading" ? "is-spinning" : undefined}
        size={15}
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <div>
        <strong>{t(feedback.title)}</strong>
        {feedback.message ? <span>{t(feedback.message)}</span> : null}
        {feedback.diagnosticReference ? (
          <span className="app-feedback__reference">
            {t("Reference")}: {feedback.diagnosticReference}
          </span>
        ) : null}
        {feedback.action ? (
          <button className="app-feedback__action" type="button" onClick={feedback.action.onClick}>
            {t(feedback.action.label)}
          </button>
        ) : null}
        {feedback.diagnosticReference && onViewDiagnostic ? (
          <button
            className="app-feedback__action"
            type="button"
            onClick={() => onViewDiagnostic(feedback.diagnosticReference!)}
          >
            {t("View details")}
          </button>
        ) : null}
      </div>
      <div className="app-feedback__controls">
        <button
          type="button"
          aria-label={t(copied ? "Message copied" : "Copy message")}
          title={t(copied ? "Copied" : "Copy message")}
          onClick={() => void copyFeedback()}
        >
          {copied ? (
            <CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
          )}
        </button>
        {dismissible ? (
          <button type="button" aria-label={t("Dismiss message")} onClick={onDismiss}>
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
