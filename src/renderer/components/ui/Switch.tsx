import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-checked" | "role"> {
  checked: boolean;
  label: string;
  children?: ReactNode;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, children, className = "", label, onClick, type = "button", ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      aria-checked={checked}
      aria-label={label}
      className={`ui-switch${checked ? " is-on" : ""} ${className}`.trim()}
      role="switch"
      type={type}
      onClick={onClick}
    >
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      {children ? <span className="ui-switch__label">{children}</span> : null}
    </button>
  )
);

Switch.displayName = "Switch";
