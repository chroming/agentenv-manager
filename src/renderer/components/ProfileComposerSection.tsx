import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ProfileResourcePolicyControl,
  type ProfileResourcePolicy
} from "./ProfileResourcePolicyControl";

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
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const countId = `${generatedId}-count`;
  const summaryId = `${generatedId}-summary`;
  const panelId = `${generatedId}-panel`;
  const uniqueChipNames = [...new Set(chipNames)];
  const countLabel = countSummary ?? t("{{enabled}} of {{total}} enabled", {
      enabled: enabledCount,
      total: count
    });

  return (
    <section
      className={[
        "profile-composer-section",
        countSummary ? "has-scope-summary" : "",
        expanded ? "is-expanded" : "",
        policy === "disable" ? "is-resource-disabled" : "",
        policy === "ignore" ? "is-unmanaged" : ""
      ].filter(Boolean).join(" ")}
      data-profile-composer-id={id}
    >
      <div className="profile-composer-section__header">
        <button
          className="profile-composer-section__disclosure"
          type="button"
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={t(expanded ? "Collapse {{name}}" : "Expand {{name}}", { name: title })}
          onClick={onToggle}
        >
          <ChevronRight
            className="profile-composer-section__chevron"
            size={18}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </button>
        <button
          className="profile-composer-section__trigger"
          id={triggerId}
          type="button"
          aria-controls={panelId}
          aria-describedby={`${descriptionId} ${countId} ${summaryId}`}
          aria-expanded={expanded}
          aria-labelledby={titleId}
          onClick={onToggle}
        >
          <span className="profile-composer-section__icon" aria-hidden="true">
            {icon}
          </span>
          <span className="profile-composer-section__heading">
            <span className="profile-composer-section__title" id={titleId}>
              {title}
            </span>
            <OverflowTooltip
              className="profile-composer-section__description"
              focusable={false}
              id={descriptionId}
              text={description}
            />
          </span>
          <span
            className="profile-composer-section__count"
            id={countId}
            title={countLabel}
          >
            <span className="profile-composer-section__count-label ui-visually-hidden">
              {countLabel}
            </span>
            {countSummary ? (
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
          </span>
          <span className="ui-visually-hidden" id={summaryId}>
            {uniqueChipNames.join(", ")}
          </span>
        </button>
        <ProfileResourcePolicyControl
          disabled={policyDisabled}
          label={policyLabel}
          status={policyStatus}
          value={policy}
          onChange={onPolicyChange}
        />
      </div>
      {expanded ? (
        <div
          className="profile-composer-section__panel"
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
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
                "Saved in this Profile. Applying to {{name}} disables this section's Profile resources.",
                { name: targetName }
              )}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
};
