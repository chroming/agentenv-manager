import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref
} from "react";
import { handleActionMenuKeyDown } from "./actionMenuKeyboard";

interface ActionMenuProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  ariaLabel: string;
  children: ReactNode;
  menuRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}

export const ActionMenu = ({
  ariaLabel,
  children,
  className = "",
  menuRef,
  onKeyDown,
  ...props
}: ActionMenuProps) => (
  <div
    {...props}
    ref={menuRef}
    className={`ui-action-menu ${className}`.trim()}
    role="menu"
    aria-label={ariaLabel}
    onKeyDown={(event) => {
      handleActionMenuKeyDown(event);
      onKeyDown?.(event);
    }}
  >
    {children}
  </div>
);

interface ActionMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "danger";
}

export const ActionMenuItem = ({
  children,
  className = "",
  role = "menuitem",
  tone = "default",
  type = "button",
  ...props
}: ActionMenuItemProps) => (
  <button
    {...props}
    className={`ui-action-menu__item ui-action-menu__item--${tone} ${className}`.trim()}
    role={role}
    type={type}
  >
    {children}
  </button>
);
