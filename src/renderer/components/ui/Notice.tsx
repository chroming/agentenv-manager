import type { ReactNode } from "react";

type NoticeTone = "info" | "warning" | "danger";

interface NoticeProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  role?: "alert" | "status";
  title?: ReactNode;
  tone?: NoticeTone;
}

export const Notice = ({
  actions,
  children,
  className = "",
  icon,
  role,
  title,
  tone = "info"
}: NoticeProps) => (
  <div className={`ui-notice ui-notice--${tone} ${className}`.trim()} role={role}>
    {icon ? <span className="ui-notice__icon" aria-hidden="true">{icon}</span> : null}
    <div className="ui-notice__copy">
      {title ? <strong>{title}</strong> : null}
      <span>{children}</span>
    </div>
    {actions ? <div className="ui-notice__actions">{actions}</div> : null}
  </div>
);
