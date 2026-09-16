import type { HTMLAttributes, ReactNode } from "react";

type ResourceRowDensity = "compact" | "default" | "comfortable";
type ResourceRowTone = "default" | "disabled" | "attention";

interface ResourceRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  actionsVisibility?: "always" | "contextual";
  density?: ResourceRowDensity;
  description?: ReactNode;
  icon: ReactNode;
  metadata?: ReactNode;
  state?: ReactNode;
  title: ReactNode;
  titleAside?: ReactNode;
  tone?: ResourceRowTone;
  appearance?: "default" | "plain";
}

export const ResourceRow = ({
  actions,
  actionsVisibility = "always",
  className = "",
  density = "default",
  description,
  icon,
  metadata,
  state,
  title,
  titleAside,
  tone = "default",
  appearance = "default",
  ...props
}: ResourceRowProps) => (
  <div
    {...props}
    className={`ui-resource-row ui-resource-row--${density} ui-resource-row--${tone} ui-resource-row--appearance-${appearance} ui-resource-row--actions-${actionsVisibility} ${className}`.trim()}
  >
    <span className="ui-resource-row__icon" aria-hidden="true">
      {icon}
    </span>
    <div className="ui-resource-row__identity">
      <strong className={titleAside ? "ui-resource-row__title-with-aside" : undefined}>
        {titleAside ? <><span>{title}</span>{titleAside}</> : title}
      </strong>
      {description ? <span>{description}</span> : null}
    </div>
    {metadata ? <div className="ui-resource-row__metadata">{metadata}</div> : null}
    {state ? <div className="ui-resource-row__state">{state}</div> : null}
    {actions ? <div className="ui-resource-row__actions">{actions}</div> : null}
  </div>
);
