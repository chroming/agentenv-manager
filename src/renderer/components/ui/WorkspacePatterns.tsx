import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode
} from "react";
import { ControlDensityProvider } from "./controlDensity";

type MasterDetailWidth = "compact" | "default" | "wide";

interface MasterDetailLayoutProps extends HTMLAttributes<HTMLDivElement> {
  listWidth?: MasterDetailWidth;
}

export const MasterDetailLayout = ({
  children,
  className = "",
  listWidth = "default",
  ...props
}: MasterDetailLayoutProps) => (
  <div
    {...props}
    className={`ui-master-detail ui-master-detail--${listWidth} ${className}`.trim()}
  >
    {children}
  </div>
);

export const MasterListPane = ({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) => (
  <aside {...props} className={`ui-master-list ${className}`.trim()}>
    {children}
  </aside>
);

export const MasterDetailPane = ({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) => (
  <section {...props} className={`ui-master-detail__pane ${className}`.trim()}>
    {children}
  </section>
);

export const SingleObjectWorkspace = ({
  children,
  className = "",
  surface = "framed",
  ...props
}: HTMLAttributes<HTMLElement> & { surface?: "framed" | "open" }) => (
  <section
    {...props}
    className={`ui-single-object-workspace ui-single-object-workspace--${surface} ${className}`.trim()}
  >
    {children}
  </section>
);

interface SelectableListRowProps
  extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick" | "onKeyDown"> {
  as?: "button" | "div";
  description?: ReactNode;
  descriptionClassName?: string;
  disabled?: boolean;
  icon?: ReactNode;
  iconClassName?: string;
  identityClassName?: string;
  selected?: boolean;
  status?: ReactNode;
  trailingAction?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  titleEmphasis?: "always" | "selected";
  tooltip?: string;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  onClick?(event: MouseEvent<HTMLElement>): void;
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  onSelect?(): void;
}

export const SelectableListRow = ({
  as = "button",
  className = "",
  description,
  descriptionClassName = "",
  disabled = false,
  icon,
  iconClassName = "",
  identityClassName = "",
  onClick,
  onKeyDown,
  onSelect,
  selected = false,
  status,
  trailingAction,
  title,
  titleClassName = "",
  titleEmphasis = "always",
  tooltip,
  type = "button",
  ...props
}: SelectableListRowProps) => {
  const generatedLabel = [title, description]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .join(" ");
  const content = (
    <>
      {icon ? <span className={`ui-selectable-row__icon ${iconClassName}`.trim()} aria-hidden="true">{icon}</span> : null}
      <span className={`ui-selectable-row__identity ${identityClassName}`.trim()}>
        <span className={`ui-selectable-row__title ${titleClassName}`.trim()}>{title}</span>
        {description ? <span className={`ui-selectable-row__description ${descriptionClassName}`.trim()}>{description}</span> : null}
      </span>
      {status ? <span className="ui-selectable-row__status">{status}</span> : null}
      {trailingAction ? <span className="ui-selectable-row__trailing">{trailingAction}</span> : null}
    </>
  );
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (disabled) return;
    onClick?.(event);
    if (!event.defaultPrevented) onSelect?.();
  };
  const classes = `ui-selectable-row${selected ? " is-selected" : ""}${
    trailingAction ? " has-trailing-action" : ""
  }${
    titleEmphasis === "selected" ? " ui-selectable-row--selected-emphasis" : ""
  } ${className}`.trim();
  const label = props["aria-label"] ?? (generatedLabel || undefined);

  if (as === "div") {
    return (
      <div
        {...props}
        aria-current={selected ? "page" : props["aria-current"]}
        aria-disabled={disabled || undefined}
        aria-label={label}
        className={classes}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (disabled) return;
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onSelect?.();
          }
        }}
        tabIndex={disabled ? -1 : (props.tabIndex ?? 0)}
        title={tooltip}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      {...props}
      aria-current={selected ? "page" : props["aria-current"]}
      aria-label={label}
      className={classes}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={onKeyDown}
      title={tooltip}
      type={type}
    >
      {content}
    </button>
  );
};

interface InspectorHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  responsive?: "inline" | "stack";
  title: ReactNode;
  titleLabel?: string;
}

export const InspectorHeader = ({
  actions,
  className = "",
  description,
  icon,
  responsive = "inline",
  title,
  titleLabel,
  ...props
}: InspectorHeaderProps) => (
  <header
    {...props}
    className={`ui-inspector-header ui-inspector-header--responsive-${responsive} ${className}`.trim()}
  >
    <div className="ui-inspector-header__identity">
      {icon ? <span className="ui-inspector-header__icon" aria-hidden="true">{icon}</span> : null}
      <div className="ui-inspector-header__copy">
        <h3 aria-label={titleLabel}>{title}</h3>
        {description ? <span>{description}</span> : null}
      </div>
    </div>
    {actions ? (
      <ControlDensityProvider density="default">
        <div className="ui-inspector-header__actions">{actions}</div>
      </ControlDensityProvider>
    ) : null}
  </header>
);

interface ResourceSectionProps extends HTMLAttributes<HTMLElement> {
  actions?: ReactNode;
  icon?: ReactNode;
  summary?: ReactNode;
  title: string;
}

export const ResourceSection = ({
  actions,
  children,
  className = "",
  icon,
  summary,
  title,
  ...props
}: ResourceSectionProps) => (
  <section
    {...props}
    aria-label={props["aria-label"] ?? title}
    className={`ui-resource-section ${className}`.trim()}
  >
    <header className="ui-resource-section__header">
      {icon ? <span className="ui-resource-section__icon" aria-hidden="true">{icon}</span> : null}
      <div className="ui-resource-section__copy">
        <strong>{title}</strong>
        {summary ? <span className="ui-resource-section__summary">{summary}</span> : null}
      </div>
      {actions ? (
        <ControlDensityProvider density="compact">
          <div className="ui-resource-section__actions">{actions}</div>
        </ControlDensityProvider>
      ) : null}
    </header>
    {children ? <div className="ui-resource-section__content">{children}</div> : null}
  </section>
);

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

export const EmptyState = ({
  actions,
  className = "",
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) => (
  <div {...props} className={`ui-empty-state ${className}`.trim()}>
    {icon ? <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span> : null}
    <strong>{title}</strong>
    {description ? <span>{description}</span> : null}
    {actions ? <div className="ui-empty-state__actions">{actions}</div> : null}
  </div>
);
