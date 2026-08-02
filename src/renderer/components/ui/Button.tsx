import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "compact" | "default" | "prominent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  icon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      busy = false,
      className = "",
      icon,
      size = "default",
      type = "button",
      variant = "secondary",
      "aria-busy": ariaBusy,
      ...props
    },
    ref
  ) => {
    const effectiveBusy = busy || ariaBusy === true || ariaBusy === "true";
    return (
      <button
        {...props}
        ref={ref}
        aria-busy={effectiveBusy}
        className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
        disabled={props.disabled || effectiveBusy}
        type={type}
      >
        <span className="ui-button__content">
          {icon ? (
            <span className="ui-button__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="ui-button__label">{children}</span>
        </span>
        {effectiveBusy ? (
          <span className="ui-button__busy" aria-hidden="true">
            <LoaderCircle className="is-spinning" />
          </span>
        ) : null}
      </button>
    );
  }
);

Button.displayName = "Button";
