import { ChevronDown } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";

export interface ProfileComposerSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  chipNames: string[];
  expanded: boolean;
  onToggle(): void;
  children: ReactNode;
}

export const ProfileComposerSection = ({
  id,
  icon,
  title,
  description,
  count,
  chipNames,
  expanded,
  onToggle,
  children
}: ProfileComposerSectionProps) => {
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const countId = `${generatedId}-count`;
  const summaryId = `${generatedId}-summary`;
  const panelId = `${generatedId}-panel`;
  const uniqueChipNames = [...new Set(chipNames)];
  const visibleChipNames = uniqueChipNames.slice(0, 3);
  const overflowCount = Math.max(0, uniqueChipNames.length - visibleChipNames.length);

  return (
    <section
      className={`profile-composer-section${expanded ? " is-expanded" : ""}`}
      data-profile-composer-id={id}
    >
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
        <span className="profile-composer-section__count" id={countId}>
          {count}
        </span>
        <span className="profile-composer-section__summary" id={summaryId}>
          {visibleChipNames.map((chipName, index) => (
            <Fragment key={chipName}>
              {index > 0 ? " " : null}
              <span className="resource-chip" data-testid="profile-composer-chip">
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
        <ChevronDown
          className="profile-composer-section__chevron"
          size={18}
          strokeWidth={2.2}
          aria-hidden="true"
        />
      </button>
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
