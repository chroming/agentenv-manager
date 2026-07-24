import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import type { SkillCleanupBucket } from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { Button, IconButton } from "./ui";

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
  return "Kept outside AgentEnv";
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

  return (
    <div className={`cleanup-bucket-heading cleanup-bucket-heading--${bucket}`}>
      <div className="cleanup-bucket-copy">
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      {showCleanup || collapsible ? (
        <div className="cleanup-bucket-actions">
          {showCleanup ? (
            <Button
              aria-label={t("Clean up {{count}} ready Skills", { count: readyCleanupCount })}
              className="cleanup-auto-action"
              disabled={actionDisabled}
              icon={(
                <Sparkles
                  className={actionWorking ? "is-spinning" : undefined}
                  size={15}
                  strokeWidth={2.2}
                />
              )}
              size="compact"
              variant="primary"
              onClick={onReviewCleanup}
            >
              {t(actionWorking ? "Cleaning up..." : "Clean up {{count}}", {
                count: readyCleanupCount
              })}
            </Button>
          ) : null}
          {collapsible ? (
            <IconButton
              aria-expanded={expanded}
              label={t(expanded ? "Collapse {{section}}" : "Expand {{section}}", {
                section: label
              })}
              size="compact"
              variant="ghost"
              onClick={onToggle}
            >
              {expanded
                ? <ChevronDown size={15} strokeWidth={2.2} />
                : <ChevronRight size={15} strokeWidth={2.2} />}
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
