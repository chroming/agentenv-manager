import { useId, type HTMLAttributes, type ReactNode } from "react";
import { DisclosureIcon } from "./DisclosureIcon";

export interface ResourceDisclosureSectionProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  expanded: boolean;
  icon?: ReactNode;
  id: string;
  onToggle(): void;
  nested?: boolean;
  muted?: boolean;
  summary?: ReactNode;
  summaryLabel?: string;
  summaryTitle?: string;
  summaryWidth?: "compact" | "wide";
  title: string;
  toggleLabel: string;
}

export const ResourceDisclosureSection = ({
  actions,
  children,
  className = "",
  description,
  expanded,
  icon,
  id,
  onToggle,
  nested = false,
  muted = false,
  summary,
  summaryLabel,
  summaryTitle,
  summaryWidth = "compact",
  title,
  toggleLabel,
  ...props
}: ResourceDisclosureSectionProps) => {
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const descriptionId = `${generatedId}-description`;
  const summaryId = `${generatedId}-summary`;
  const panelId = `${generatedId}-panel`;
  const describedBy = [description ? descriptionId : undefined, summary ? summaryId : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <section
      {...props}
      aria-label={props["aria-label"] ?? title}
      className={`ui-resource-disclosure${expanded ? " is-expanded" : ""}${nested ? " is-nested" : ""}${muted ? " is-muted" : ""}${summaryWidth === "wide" ? " has-wide-summary" : ""} ${className}`.trim()}
      data-resource-disclosure-id={id}
    >
      <header className="ui-resource-disclosure__header">
        <button
          aria-controls={panelId}
          aria-describedby={describedBy}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="ui-resource-disclosure__trigger"
          id={triggerId}
          onClick={onToggle}
          type="button"
        >
          <DisclosureIcon
            className="ui-resource-disclosure__chevron"
            open={expanded}
            size={17}
          />
          {icon ? (
            <span
              aria-hidden="true"
              className="ui-resource-disclosure__icon"
            >
              {icon}
            </span>
          ) : null}
          <span className="ui-resource-disclosure__heading">
            <strong className="ui-resource-disclosure__title">
              {title}
            </strong>
            {description ? (
              <span className="ui-resource-disclosure__description" id={descriptionId}>
                {description}
              </span>
            ) : null}
          </span>
          {summary ? (
            <span
              className="ui-resource-disclosure__summary"
              id={summaryId}
              title={summaryTitle}
            >
              {summaryLabel ? (
                <>
                  <span className="ui-visually-hidden">{summaryLabel}</span>
                  <span aria-hidden="true">{summary}</span>
                </>
              ) : summary}
            </span>
          ) : null}
        </button>
        {actions ? (
          <div className="ui-resource-disclosure__actions">
            {actions}
          </div>
        ) : null}
      </header>
      {expanded ? (
        <div
          aria-labelledby={triggerId}
          className="ui-resource-disclosure__panel"
          id={panelId}
          role="group"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
