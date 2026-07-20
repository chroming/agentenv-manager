import { ChevronDown } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { Switch } from "./ui";

export interface ProfileComposerSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  enabledCount: number;
  chipNames: string[];
  managed: boolean;
  managementDisabled?: boolean;
  managementLabel: string;
  managementStatus?: string;
  expanded: boolean;
  onToggle(): void;
  onManagementChange(managed: boolean): void;
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
  managed,
  managementDisabled = false,
  managementLabel,
  managementStatus,
  expanded,
  onToggle,
  onManagementChange,
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
            <span className="profile-composer-section__description" id={descriptionId}>
              {description}
            </span>
          </span>
          <span
            className="profile-composer-section__count"
            id={countId}
            title={countLabel}
          >
            <span className="profile-composer-section__count-label">{countLabel}</span>
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
                <span
                  className="resource-chip"
                  data-testid="profile-composer-chip"
                  title={chipName}
                >
                  {chipName}
                </span>
              </Fragment>
            ))}
            {overflowCount > 0 ? (
              <>
                {visibleChipNames.length > 0 ? " " : null}
                <span className="resource-chip resource-chip--muted">+{overflowCount}</span>
              </>
            ) : null}
          </span>
        </button>
        <Switch
          checked={managed}
          className="profile-composer-section__management"
          disabled={managementDisabled}
          label={managementLabel}
          onClick={() => onManagementChange(!managed)}
        >
          {managementStatus ?? t("Manage")}
        </Switch>
        <button
          className="profile-composer-section__disclosure"
          type="button"
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={t(expanded ? "Collapse {{name}}" : "Expand {{name}}", { name: title })}
          onClick={onToggle}
        >
          <ChevronDown
            className="profile-composer-section__chevron"
            size={18}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded ? (
        <div
          className="profile-composer-section__panel"
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
