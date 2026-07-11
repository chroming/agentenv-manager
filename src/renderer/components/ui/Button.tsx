import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "compact" | "default" | "prominent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      icon,
      size = "default",
      type = "button",
      variant = "secondary",
      ...props
    },
    ref
  ) => (
    <button
      {...props}
      ref={ref}
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      type={type}
    >
      {icon ? <span className="ui-button__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  )
);

Button.displayName = "Button";
