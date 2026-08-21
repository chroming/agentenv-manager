import type { ReactNode } from "react";
import type { SemanticStatusKind, SemanticStatusTone } from "./statusPresentation";
import { statusToneFor } from "./statusPresentation";

interface OperationStatusBarProps {
  className?: string;
  detail?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  role?: "alert" | "status";
  statusKind?: SemanticStatusKind;
  tone?: SemanticStatusTone;
}

export const OperationStatusBar = ({
  className = "",
  detail,
  icon,
  label,
  role = "status",
  statusKind = "neutral",
  tone
}: OperationStatusBarProps) => {
  const effectiveTone = tone ?? statusToneFor(statusKind);

  return (
    <div
      aria-label={typeof label === "string" ? label : undefined}
      className={`ui-operation-status ui-operation-status--${effectiveTone} ${className}`.trim()}
      data-status-kind={statusKind}
      data-tone={effectiveTone}
      role={role}
    >
      {icon ? <span className="ui-operation-status__icon" aria-hidden="true">{icon}</span> : null}
      <span className="ui-operation-status__copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
};
