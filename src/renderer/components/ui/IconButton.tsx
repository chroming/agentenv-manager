import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  size?: Exclude<ButtonSize, "prominent">;
  variant?: ButtonVariant;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      children,
      className = "",
      label,
      size = "default",
      title = label,
      type = "button",
      variant = "secondary",
      ...props
    },
    ref
  ) => (
    <button
      {...props}
      ref={ref}
      aria-label={label}
      className={`ui-icon-button ui-icon-button--${variant} ui-icon-button--${size} ${className}`.trim()}
      title={title}
      type={type}
    >
      {children}
    </button>
  )
);

IconButton.displayName = "IconButton";
