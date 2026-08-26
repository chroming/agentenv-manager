import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ProfileResourcePolicyControl,
  type ProfileResourcePolicy
} from "./ProfileResourcePolicyControl";
import {
  InteractiveStatus,
  ResourceDisclosureSection,
  type SemanticStatusKind
} from "./ui";

export interface ProfileComposerSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description?: string;
  count: number;
  enabledCount: number;
  countSummary?: string;
  countStatusKind?: SemanticStatusKind;
  chipNames: string[];
  policy: ProfileResourcePolicy;
  policyDisabled?: boolean;
  policyLabel: string;
  policyStatus?: string;
  expanded: boolean;
  onToggle(): void;
  onPolicyChange(policy: ProfileResourcePolicy): void;
  children: ReactNode;
}

export const ProfileComposerSection = ({
  id,
  icon,
  title,
  description,
  count,
  enabledCount,
  countSummary,
  countStatusKind,
  chipNames,
  policy,
  policyDisabled = false,
  policyLabel,
  policyStatus,
  expanded,
  onToggle,
  onPolicyChange,
  children
}: ProfileComposerSectionProps) => {
  const { t } = useI18n();
  const uniqueChipNames = [...new Set(chipNames)];
  const countLabel = countSummary ?? t("{{enabled}} of {{total}} enabled", {
      enabled: enabledCount,
      total: count
    });
  const accessibleSummary = [countLabel, uniqueChipNames.join(", ")]
    .filter(Boolean)
    .join(" ");

  return (
    <ResourceDisclosureSection
      className={[
        "profile-composer-section",
        countSummary ? "has-scope-summary" : "",
        !policyDisabled && policy === "disable" ? "is-resource-disabled" : "",
        policyDisabled ? "is-agent-controlled" : "",
        !policyDisabled && policy === "ignore" ? "is-unmanaged" : ""
      ].filter(Boolean).join(" ")}
      data-profile-composer-id={id}
      density="compact"
      description={description ? (
        <OverflowTooltip
          className="profile-composer-section__description"
          focusable={false}
          text={description}
        />
      ) : undefined}
      expanded={expanded}
      icon={icon}
      id={id}
      onToggle={onToggle}
      nested={id === "instructions" || id === "skills" || id === "mcp"}
      muted={policyDisabled || policy !== "manage"}
      summary={countSummary && countStatusKind ? (
        <InteractiveStatus
          className="profile-composer-section__count-scope"
          label={countSummary}
          size="metadata"
          statusKind={countStatusKind}
        />
      ) : countSummary ? (
        <span className="profile-composer-section__count-scope" aria-hidden="true">
          {countSummary}
        </span>
      ) : (
        <span className="profile-composer-section__count-visual" aria-hidden="true">
          <strong>{enabledCount}</strong>
          <span>/</span>
          <span>{count}</span>
        </span>
      )}
      summaryLabel={accessibleSummary}
      summaryTitle={countLabel}
      summaryWidth={countSummary ? "wide" : "compact"}
      title={title}
      toggleLabel={title}
      actions={(
        <ProfileResourcePolicyControl
          disabled={policyDisabled}
          label={policyLabel}
          status={policyStatus}
          value={policy}
          onChange={onPolicyChange}
        />
      )}
    >
      {children}
    </ResourceDisclosureSection>
  );
};
