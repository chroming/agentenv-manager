import type { HTMLAttributes, ReactNode } from "react";

interface DialogHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

export const DialogHeader = ({
  actions,
  className = "",
  description,
  title,
  ...props
}: DialogHeaderProps) => (
  <header {...props} className={`ui-dialog-header ${className}`.trim()}>
    <div className="ui-dialog-header__copy">
      <div className="ui-dialog-title">{title}</div>
      {description ? <p className="ui-dialog-description">{description}</p> : null}
    </div>
    {actions ? <div className="ui-dialog-header__actions">{actions}</div> : null}
  </header>
);

export const DialogBody = ({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={`ui-dialog-body ${className}`.trim()}>
    {children}
  </div>
);

export const DialogFooter = ({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) => (
  <footer {...props} className={`ui-dialog-footer ${className}`.trim()}>
    {children}
  </footer>
);
