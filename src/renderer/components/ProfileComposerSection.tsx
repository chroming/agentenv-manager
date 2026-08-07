import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ProfileResourcePolicyControl,
  type ProfileResourcePolicy
} from "./ProfileResourcePolicyControl";
import { ResourceDisclosureSection } from "./ui";

export interface ProfileComposerSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  enabledCount: number;
  countSummary?: string;
  chipNames: string[];
  policy: ProfileResourcePolicy;
  policyDisabled?: boolean;
  policyLabel: string;
  policyStatus?: string;
  targetName: string;
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
  chipNames,
  policy,
  policyDisabled = false,
  policyLabel,
  policyStatus,
  targetName,
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
        expanded ? "is-expanded" : "",
        !policyDisabled && policy === "disable" ? "is-resource-disabled" : "",
        policyDisabled ? "is-agent-controlled" : "",
        !policyDisabled && policy === "ignore" ? "is-unmanaged" : ""
      ].filter(Boolean).join(" ")}
      data-profile-composer-id={id}
      description={(
        <OverflowTooltip
          className="profile-composer-section__description"
          focusable={false}
          text={description}
        />
      )}
      expanded={expanded}
      icon={icon}
      id={id}
      onToggle={onToggle}
      nested={id === "skills" || id === "mcp"}
      slotClassNames={{
        actions: "profile-composer-section__actions",
        chevron: "profile-composer-section__chevron",
        description: "profile-composer-section__description-slot",
        header: "profile-composer-section__header",
        heading: "profile-composer-section__heading",
        icon: "profile-composer-section__icon",
        panel: "profile-composer-section__panel",
        summary: "profile-composer-section__count",
        title: "profile-composer-section__title",
        trigger: "profile-composer-section__trigger"
      }}
      summary={countSummary ? (
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
      {!policyDisabled && policy === "ignore" ? (
        <p className="profile-composer-section__policy-note">
          {t(
            "Saved in this Profile. Applying to {{name}} leaves this section unchanged.",
            { name: targetName }
          )}
        </p>
      ) : null}
      {!policyDisabled && policy === "disable" ? (
        <p className="profile-composer-section__policy-note">
          {t(
            "Saved in this Profile. Applying to {{name}} turns off this Profile's resources in the Agent.",
            { name: targetName }
          )}
        </p>
      ) : null}
      {children}
    </ResourceDisclosureSection>
  );
};
