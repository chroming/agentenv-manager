import { ChevronRight } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ProfileResourcePolicyMenu,
  type ProfileResourcePolicy
} from "./ProfileResourcePolicyMenu";

export interface ProfileComposerSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  enabledCount: number;
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
  const visibleChipNames = uniqueChipNames.slice(0, 2);
  const hiddenChipNames = uniqueChipNames.slice(visibleChipNames.length);
  const overflowCount = Math.max(0, uniqueChipNames.length - visibleChipNames.length);
  const countLabel = t("{{enabled}} of {{total}} enabled", {
    enabled: enabledCount,
    total: count
  });

  return (
    <section
      className={`profile-composer-section${expanded ? " is-expanded" : ""}`}
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
            <span className="profile-composer-section__count-visual" aria-hidden="true">
              <strong>{enabledCount}</strong>
              <span>/</span>
              <span>{count}</span>
            </span>
          </span>
          <span className="profile-composer-section__summary" id={summaryId}>
            {visibleChipNames.map((chipName, index) => (
              <Fragment key={chipName}>
                {index > 0 ? " " : null}
                <OverflowTooltip
                  className="resource-chip"
                  focusable={false}
                  testId="profile-composer-chip"
                  text={chipName}
                />
              </Fragment>
            ))}
            {overflowCount > 0 ? (
              <>
                {visibleChipNames.length > 0 ? " " : null}
                <OverflowTooltip
                  className="resource-chip resource-chip--muted"
                  displayText={`+${overflowCount}`}
                  focusable={false}
                  text={hiddenChipNames.join(", ")}
                />
              </>
            ) : null}
          </span>
        </button>
        <ProfileResourcePolicyMenu
          disabled={policyDisabled}
          label={policyLabel}
          resourceName={title}
          status={policyStatus}
          targetName={targetName}
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
          {!policyDisabled && policy === "leave-unchanged" ? (
            <p className="profile-composer-section__policy-note">
              {t(
                "Saved in this Profile. Applying to {{name}} leaves this section unchanged.",
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
