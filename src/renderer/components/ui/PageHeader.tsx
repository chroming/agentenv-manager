import type { ReactNode } from "react";
import { ControlDensityProvider } from "./controlDensity";

interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  help?: ReactNode;
  title: string;
}

export const PageHeader = ({
  actions,
  className = "",
  description,
  help,
  title
}: PageHeaderProps) => {
  const classes = Array.from(
    new Set(["ui-page-header", "page-header", ...className.split(/\s+/).filter(Boolean)])
  ).join(" ");

  return (
    <header className={classes}>
      <div className="ui-page-header__copy">
        <h2 aria-label={title}>
          <span>{title}</span>
          {help ? <span className="ui-page-header__help">{help}</span> : null}
        </h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <ControlDensityProvider density="default">
          <div className="ui-page-header__actions">{actions}</div>
        </ControlDensityProvider>
      ) : null}
    </header>
  );
};
