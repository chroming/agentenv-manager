import { ChevronRight } from "lucide-react";
import { useId, type HTMLAttributes, type ReactNode } from "react";

interface ResourceDisclosureSlotClassNames {
  header?: string;
  trigger?: string;
  chevron?: string;
  icon?: string;
  heading?: string;
  title?: string;
  description?: string;
  summary?: string;
  actions?: string;
  panel?: string;
}

export interface ResourceDisclosureSectionProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  descriptionMode?: "always" | "collapsed";
  expanded: boolean;
  icon?: ReactNode;
  id: string;
  onToggle(): void;
  nested?: boolean;
  slotClassNames?: ResourceDisclosureSlotClassNames;
  summary?: ReactNode;
  summaryLabel?: string;
  summaryTitle?: string;
  title: string;
  toggleLabel: string;
}

const withSlotClass = (base: string, extra?: string) =>
  `${base}${extra ? ` ${extra}` : ""}`;

export const ResourceDisclosureSection = ({
  actions,
  children,
  className = "",
  description,
  descriptionMode = "always",
  expanded,
  icon,
  id,
  onToggle,
  nested = false,
  slotClassNames = {},
  summary,
  summaryLabel,
  summaryTitle,
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
      className={`ui-resource-disclosure${expanded ? " is-expanded" : ""}${nested ? " is-nested" : ""} ${className}`.trim()}
      data-resource-disclosure-id={id}
    >
      <header className={withSlotClass("ui-resource-disclosure__header", slotClassNames.header)}>
        <button
          aria-controls={panelId}
          aria-describedby={describedBy}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className={withSlotClass("ui-resource-disclosure__trigger", slotClassNames.trigger)}
          id={triggerId}
          onClick={onToggle}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={withSlotClass("ui-resource-disclosure__chevron", slotClassNames.chevron)}
            size={17}
            strokeWidth={2.2}
          />
          {icon ? (
            <span
              aria-hidden="true"
              className={withSlotClass("ui-resource-disclosure__icon", slotClassNames.icon)}
            >
              {icon}
            </span>
          ) : null}
          <span className={withSlotClass("ui-resource-disclosure__heading", slotClassNames.heading)}>
            <strong className={withSlotClass("ui-resource-disclosure__title", slotClassNames.title)}>
              {title}
            </strong>
            {description ? (
              <span
                className={withSlotClass(
                  `ui-resource-disclosure__description${descriptionMode === "collapsed" && expanded ? " ui-visually-hidden" : ""}`,
                  slotClassNames.description
                )}
                id={descriptionId}
              >
                {description}
              </span>
            ) : null}
          </span>
          {summary ? (
            <span
              className={withSlotClass("ui-resource-disclosure__summary", slotClassNames.summary)}
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
          <div className={withSlotClass("ui-resource-disclosure__actions", slotClassNames.actions)}>
            {actions}
          </div>
        ) : null}
      </header>
      {expanded ? (
        <div
          aria-labelledby={triggerId}
          className={withSlotClass("ui-resource-disclosure__panel", slotClassNames.panel)}
          id={panelId}
          role="group"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
