import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
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
