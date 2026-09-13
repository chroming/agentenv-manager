import type { ReactNode } from "react";
import { ControlDensityProvider } from "./controlDensity";

interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  help?: ReactNode;
  navigation?: ReactNode;
  title: string;
}

export const PageHeader = ({
  actions,
  className = "",
  description,
  help,
  navigation,
  title
}: PageHeaderProps) => {
  if (!actions && !navigation && !help && !description) return null;
  const classes = Array.from(
    new Set(["ui-page-header", "page-header", ...className.split(/\s+/).filter(Boolean)])
  ).join(" ");

  return (
    <header className={classes} aria-label={title}>
      <h2 className="ui-visually-hidden">{title}</h2>
      {description ? <div className="ui-page-header__copy"><p>{description}</p></div> : null}
      {navigation ? <div className="ui-page-header__navigation">{navigation}</div> : null}
      {actions || help ? (
        <ControlDensityProvider density="default">
          <div className="ui-page-header__actions">
            {help ? <span className="ui-page-header__help">{help}</span> : null}
            {actions}
          </div>
        </ControlDensityProvider>
      ) : null}
    </header>
  );
};
