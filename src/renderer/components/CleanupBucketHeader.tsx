import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import type { SkillCleanupBucket } from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { Button } from "./ui";

interface CleanupBucketHeaderProps {
  bucket: SkillCleanupBucket;
  count: number;
  readyCleanupCount: number;
  actionDisabled: boolean;
  actionWorking: boolean;
  collapsible: boolean;
  expanded: boolean;
  onReviewCleanup(): void;
  onToggle(): void;
}

const bucketLabel = (bucket: SkillCleanupBucket) => {
  if (bucket === "decision") return "Needs your decision";
  if (bucket === "ready") return "Ready to clean up";
  if (bucket === "managed") return "Managed";
  return "Left unmanaged";
};

export const CleanupBucketHeader = ({
  bucket,
  count,
  readyCleanupCount,
  actionDisabled,
  actionWorking,
  collapsible,
  expanded,
  onReviewCleanup,
  onToggle
}: CleanupBucketHeaderProps) => {
  const { t } = useI18n();
  const label = t(bucketLabel(bucket));
  const showCleanup = bucket === "ready" && readyCleanupCount > 0;

  if (collapsible) {
    return (
      <button
        aria-expanded={expanded}
        aria-label={t(expanded ? "Collapse {{section}}" : "Expand {{section}}", {
          section: label
        })}
        className={`cleanup-bucket-heading cleanup-bucket-heading--${bucket} cleanup-bucket-disclosure`}
        type="button"
        onClick={onToggle}
      >
        <span className="cleanup-bucket-marker" aria-hidden="true" />
        <span className="cleanup-bucket-copy">
          <strong>{label}</strong>
          <span>{count}</span>
        </span>
        <span className="cleanup-bucket-disclosure__icon" aria-hidden="true">
          {expanded
            ? <ChevronDown size={15} strokeWidth={2.2} />
            : <ChevronRight size={15} strokeWidth={2.2} />}
        </span>
      </button>
    );
  }

  return (
    <div className={`cleanup-bucket-heading cleanup-bucket-heading--${bucket}`}>
      <span className="cleanup-bucket-marker" aria-hidden="true" />
      <div className="cleanup-bucket-copy">
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      {showCleanup ? (
        <div className="cleanup-bucket-actions">
          <Button
            aria-label={t("Clean up {{count}} ready Skills", { count: readyCleanupCount })}
            busy={actionWorking}
            className="cleanup-auto-action"
            disabled={actionDisabled}
            icon={<ListChecks size={15} strokeWidth={2.2} />}
            size="compact"
            variant="secondary"
            onClick={onReviewCleanup}
          >
            {t(actionWorking ? "Cleaning up..." : "Clean up {{count}}", {
              count: readyCleanupCount
            })}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
