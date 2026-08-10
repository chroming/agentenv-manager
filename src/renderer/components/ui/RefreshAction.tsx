import { CircleAlert, RefreshCw } from "lucide-react";
import type { FreshnessState } from "../../freshness";
import { useI18n } from "../../i18n";
import type { ButtonSize, ButtonVariant } from "./Button";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

interface RefreshActionProps {
  ariaLabel?: string;
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  presentation?: "button" | "icon";
  size?: Exclude<ButtonSize, "prominent">;
  state?: FreshnessState;
  variant?: ButtonVariant;
  onRefresh(): void;
}

export const RefreshAction = ({
  ariaLabel,
  busy,
  className = "",
  disabled = false,
  label,
  presentation = "button",
  size = "default",
  state,
  variant = presentation === "icon" ? "ghost" : "secondary",
  onRefresh
}: RefreshActionProps) => {
  const { formatDate, t } = useI18n();
  const refreshing = busy ?? state?.status === "refreshing";
  const issue = state?.status === "error" || state?.status === "partial";
  const statusLabel = state?.status === "error"
    ? t("Refresh failed")
    : state?.status === "partial"
      ? t("Updated with issues")
      : undefined;
  const title = [
    statusLabel,
    state?.error,
    state?.lastSuccessAt
      ? t("Last successful refresh: {{date}}", {
          date: formatDate(new Date(state.lastSuccessAt).toISOString())
        })
      : undefined
  ].filter(Boolean).join("\n") || ariaLabel || label;
  const icon = issue
    ? <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
    : <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />;
  const classes = `ui-refresh-action${issue ? " ui-refresh-action--issue" : ""} ${className}`.trim();

  if (presentation === "icon") {
    return (
      <IconButton
        className={classes}
        label={ariaLabel ?? label}
        busy={refreshing}
        disabled={disabled}
        size={size}
        title={title}
        variant={variant}
        onClick={onRefresh}
      >
        {icon}
      </IconButton>
    );
  }

  return (
    <Button
      aria-label={ariaLabel}
      busy={refreshing}
      busyLabel={label}
      className={classes}
      disabled={disabled}
      icon={icon}
      size={size}
      title={title}
      variant={variant}
      onClick={onRefresh}
    >
      {label}
    </Button>
  );
};
