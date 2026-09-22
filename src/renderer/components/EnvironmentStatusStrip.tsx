import type { EnvironmentReviewSummary } from "../environmentReview";
import { parseDiagnosticErrorMessage } from "../diagnostics";
import { useI18n } from "../i18n";
import { Button, Notice } from "./ui";
import { DiagnosticCopyButton } from "./ui/DiagnosticCopyButton";

export const EnvironmentStatusStrip = ({ summary, busy, onRefresh }: {
  summary: EnvironmentReviewSummary;
  busy: boolean;
  onRefresh(): void;
}) => {
  const { t } = useI18n();
  // Routine setup and pending work belong to Agent rows, not a global task list.
  if (summary.state !== "unavailable") return null;
  const reason = summary.unavailableReason
    ? parseDiagnosticErrorMessage(summary.unavailableReason).message.split("\n")[0]
    : t("Local Skills could not be read.");
  return (
    <section aria-label={t("Agent status")}>
      <Notice title={t("Agent status could not be checked")} tone="warning" role="status" actions={(
        <>
          {summary.unavailableReason ? (
            <DiagnosticCopyButton message={summary.unavailableReason} />
          ) : null}
          <Button size="compact" disabled={busy} onClick={onRefresh}>
            {t("Retry check")}
          </Button>
        </>
      )}>
        <span title={reason}>{reason}</span>
      </Notice>
    </section>
  );
};
