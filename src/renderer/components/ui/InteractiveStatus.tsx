import { LoaderCircle } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { SemanticStatusKind, SemanticStatusTone } from "./statusPresentation";

interface InteractiveStatusProps {
  busy?: boolean;
  busyLabel?: ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onReview?(event: MouseEvent<HTMLButtonElement>): void;
  reviewLabel?: string;
  statusKind?: SemanticStatusKind;
  tone?: SemanticStatusTone;
}

export const InteractiveStatus = ({
  busy = false,
  busyLabel,
  className = "",
  disabled = false,
  icon,
  label,
  onReview,
  reviewLabel,
  statusKind,
  tone = "neutral"
}: InteractiveStatusProps) => {
  const classes = [
    "ui-interactive-status",
    `ui-interactive-status--${tone}`,
    onReview ? "is-interactive" : "",
    className
  ].filter(Boolean).join(" ");
  const content = (
    <>
      {busy || icon ? (
        <span className="ui-interactive-status__icon" aria-hidden="true">
          {busy ? <LoaderCircle className="is-spinning" /> : icon}
        </span>
      ) : null}
      <span className="ui-interactive-status__label">{busyLabel ?? label}</span>
    </>
  );

  if (onReview) {
    return (
      <button
        aria-busy={busy}
        aria-label={reviewLabel}
        className={classes}
        data-status-kind={statusKind}
        data-tone={tone}
        disabled={disabled || busy}
        type="button"
        onClick={onReview}
      >
        {content}
      </button>
    );
  }

  return <strong className={classes} data-status-kind={statusKind} data-tone={tone}>{content}</strong>;
};
