import type { EnvironmentReviewSummary } from "../environmentReview";
import { useI18n } from "../i18n";
import { Button, Notice } from "./ui";

export const EnvironmentStatusStrip = ({ summary, busy, onRefresh }: {
  summary: EnvironmentReviewSummary;
  busy: boolean;
  onRefresh(): void;
}) => {
  const { t } = useI18n();
  // Routine setup and pending work belong to Agent rows, not a global task list.
  if (summary.state !== "unavailable") return null;
  return (
    <section aria-label={t("Profile status")}>
      <Notice tone="warning" role="status" actions={(
        <Button size="compact" disabled={busy} onClick={onRefresh}>
          {t("Retry check")}
        </Button>
      )}>
        {t("Profile check unavailable")}
      </Notice>
    </section>
  );
};
