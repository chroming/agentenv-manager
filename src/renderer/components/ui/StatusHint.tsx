import type { ReactNode } from "react";
import { HoverDetail } from "../HoverDetail";

/** Non-command metadata: keyboard-readable without looking like a disabled button. */
export const StatusHint = ({ icon, label, detail, value, className = "" }: {
  icon: ReactNode;
  label: string;
  detail?: string;
  value?: ReactNode;
  className?: string;
}) => (
  <HoverDetail
    ariaLabel={label}
    className={`ui-status-hint ${className}`.trim()}
    content={detail ? `${label}\n${detail}` : label}
    interactive={false}
    maxWidth={360}
    preferredPlacement="top"
  >
    <span className="ui-status-hint__icon" aria-hidden="true">{icon}</span>
    {value !== undefined ? <span aria-hidden="true">{value}</span> : null}
    <span className="ui-visually-hidden">{label}</span>
  </HoverDetail>
);
