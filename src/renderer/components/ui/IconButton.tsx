import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  busy?: boolean;
  label: string;
  size?: Exclude<ButtonSize, "prominent">;
  variant?: ButtonVariant;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      children,
      busy = false,
      className = "",
      label,
      size = "default",
      title = label,
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
        aria-label={label}
        className={`ui-icon-button ui-icon-button--${variant} ui-icon-button--${size} ${className}`.trim()}
        disabled={props.disabled || effectiveBusy}
        title={title}
        type={type}
      >
        <span className="ui-icon-button__content">{children}</span>
        {effectiveBusy ? (
          <span className="ui-icon-button__busy" aria-hidden="true">
            <LoaderCircle className="is-spinning" />
          </span>
        ) : null}
      </button>
    );
  }
);

IconButton.displayName = "IconButton";
