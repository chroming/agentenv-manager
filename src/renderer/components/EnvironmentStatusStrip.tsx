import {
  CheckCircle2,
  LoaderCircle,
  Monitor,
  TriangleAlert
} from "lucide-react";
import type { EnvironmentReviewSummary } from "../environmentReview";
import { useI18n } from "../i18n";
import { Button } from "./ui";

interface EnvironmentStatusStripProps {
  summary: EnvironmentReviewSummary;
  targetNames: Record<string, string>;
  busy: boolean;
  onConfigure(targetId: string): void;
  onRefresh(): void;
  onReviewShared(): void;
}

const statusCopy = (
  summary: EnvironmentReviewSummary,
  targetNames: Record<string, string>,
  t: ReturnType<typeof useI18n>["t"]
) => {
  const affectedNames = summary.affectedTargetIds
    .map((targetId) => targetNames[targetId] ?? targetId)
    .join(", ");

  switch (summary.state) {
    case "checking":
      return {
        title: t("Checking local Skills"),
        detail: t("Agents are available while the local scan finishes.")
      };
    case "unavailable":
      return {
        title: t("Environment check unavailable"),
        detail: t("Agent configuration is still available. Refresh to try again.")
      };
    case "shared-review":
      return {
        title: t(
          summary.sharedSkillCount === 1
            ? "{{count}} shared Skill needs review"
            : "{{count}} shared Skills need review",
          { count: summary.sharedSkillCount }
        ),
        detail: affectedNames
          ? t("Shared locations are used by {{agents}}.", { agents: affectedNames })
          : t("Shared locations can load Skills outside Profiles.")
      };
    case "setup":
      return {
        title: t("Set up your first Agent"),
        detail: t("Save its current environment as a Profile. Agent files change only after Apply.")
      };
    case "agent-review":
      return {
        title: t(
          summary.attentionTargetIds.length === 1
            ? "{{count}} Agent needs review"
            : "{{count}} Agents need review",
          { count: summary.attentionTargetIds.length }
        ),
        detail: t("Open the affected Profile before the next Apply.")
      };
    case "no-agents":
      return {
        title: t("No Agents detected"),
        detail: t("Enable or install an Agent, then Refresh.")
      };
    default:
      return {
        title: t("Environment ready"),
        detail: t("{{agents}} Agents detected · {{profiles}} Profiles", {
          agents: summary.installedAgentCount,
          profiles: summary.usableProfileCount
        })
      };
  }
};

export const EnvironmentStatusStrip = ({
  summary,
  targetNames,
  busy,
  onConfigure,
  onRefresh,
  onReviewShared
}: EnvironmentStatusStripProps) => {
  const { t } = useI18n();
  const copy = statusCopy(summary, targetNames, t);
  const firstSetupTargetId =
    summary.state === "setup" && summary.installedAgentCount === 1
      ? summary.installedTargetIds[0]
      : undefined;
  const reviewTargetId =
    summary.state === "agent-review" ? summary.attentionTargetIds[0] : undefined;
  const Icon =
    summary.state === "checking"
      ? LoaderCircle
      : summary.state === "ready"
        ? CheckCircle2
        : summary.state === "setup" || summary.state === "no-agents"
          ? Monitor
          : TriangleAlert;

  return (
    <section
      aria-label={t("Environment status")}
      aria-live="polite"
      className={`environment-status-strip environment-status-strip--${summary.state}`}
    >
      <span className="environment-status-strip__icon" aria-hidden="true">
        <Icon
          className={summary.state === "checking" ? "is-spinning" : undefined}
          size={17}
          strokeWidth={2.2}
        />
      </span>
      <span className="environment-status-strip__copy">
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </span>
      {summary.state === "shared-review" ? (
        <Button
          className="environment-status-strip__action"
          size="compact"
          disabled={busy}
          onClick={onReviewShared}
        >
          {t("Review")}
        </Button>
      ) : summary.state === "unavailable" ? (
        <Button
          className="environment-status-strip__action"
          size="compact"
          disabled={busy}
          onClick={onRefresh}
        >
          {t("Retry")}
        </Button>
      ) : firstSetupTargetId ? (
        <Button
          className="environment-status-strip__action"
          size="compact"
          disabled={busy}
          onClick={() => onConfigure(firstSetupTargetId)}
        >
          {t("Configure")}
        </Button>
      ) : reviewTargetId ? (
        <Button
          className="environment-status-strip__action"
          size="compact"
          disabled={busy}
          onClick={() => onConfigure(reviewTargetId)}
        >
          {t("Review")}
        </Button>
      ) : null}
    </section>
  );
};
