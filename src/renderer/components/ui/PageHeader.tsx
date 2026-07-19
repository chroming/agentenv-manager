import type { ReactNode } from "react";

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
}: PageHeaderProps) => (
  <header className={`ui-page-header ${className}`.trim()}>
    <div className="ui-page-header__copy">
      <h2 aria-label={title}>
        <span>{title}</span>
        {help}
      </h2>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
  </header>
);
