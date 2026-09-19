import type { ReactNode } from "react";
import { parseDiagnosticErrorMessage } from "../../diagnostics";
import { DiagnosticCopyButton } from "./DiagnosticCopyButton";

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
}: NoticeProps) => {
  const diagnosticMessage = typeof children === "string" && parseDiagnosticErrorMessage(children).reference ? children : undefined;
  return (
  <div className={`ui-notice ui-notice--${tone} ${className}`.trim()} role={role}>
    {icon ? <span className="ui-notice__icon" aria-hidden="true">{icon}</span> : null}
    <div className="ui-notice__copy">
      {title ? <strong>{title}</strong> : null}
      <span>{children}</span>
    </div>
    {actions || diagnosticMessage ? <div className="ui-notice__actions">
      {diagnosticMessage ? <DiagnosticCopyButton message={diagnosticMessage} /> : null}
      {actions}
    </div> : null}
  </div>
  );
};
