import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { focusInitialActionMenuItem } from "./actionMenuKeyboard";
import { IconButton } from "./IconButton";

export interface ToolbarOverflowMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect(): void;
}

interface ToolbarOverflowMenuProps {
  label: string;
  menuLabel: string;
  disabled?: boolean;
  items: ToolbarOverflowMenuItem[];
}

const menuWidth = 220;
const viewportInset = 8;
const anchorGap = 6;

export const ToolbarOverflowMenu = forwardRef<HTMLButtonElement, ToolbarOverflowMenuProps>(
  ({ label, menuLabel, disabled = false, items }, forwardedRef) => {
    const [open, setOpen] = useState(false);
    const [style, setStyle] = useState<CSSProperties>();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const positionMenu = () => {
      const triggerBox = triggerRef.current?.getBoundingClientRect();
      if (!triggerBox) return;
      const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 48;
      const left = Math.max(
        viewportInset,
        Math.min(triggerBox.right - menuWidth, window.innerWidth - menuWidth - viewportInset)
      );
      const preferredTop = triggerBox.bottom + anchorGap;
      const top = preferredTop + menuHeight <= window.innerHeight - viewportInset
        ? preferredTop
        : Math.max(viewportInset, triggerBox.top - menuHeight - anchorGap);
      setStyle({ left, position: "fixed", top, width: menuWidth });
    };

    useLayoutEffect(() => {
      if (!open) return;
      positionMenu();
      focusInitialActionMenuItem(menuRef.current);
    }, [open, items.length]);

    useEffect(() => {
      if (!open) return;
      const dismiss = (event: MouseEvent) => {
        if (
          event.target instanceof Node &&
          !menuRef.current?.contains(event.target) &&
          !triggerRef.current?.contains(event.target)
        ) setOpen(false);
      };
      const dismissWithEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      };
      const dismissForViewportChange = () => setOpen(false);
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("keydown", dismissWithEscape);
      window.addEventListener("resize", dismissForViewportChange);
      window.addEventListener("scroll", dismissForViewportChange, true);
      return () => {
        document.removeEventListener("mousedown", dismiss);
        document.removeEventListener("keydown", dismissWithEscape);
        window.removeEventListener("resize", dismissForViewportChange);
        window.removeEventListener("scroll", dismissForViewportChange, true);
      };
    }, [open]);

    return (
      <>
        <IconButton
          ref={(node) => {
            triggerRef.current = node;
            if (typeof forwardedRef === "function") forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
          }}
          label={label}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((current) => !current)}
        >
          <MoreHorizontal size={16} strokeWidth={2.2} aria-hidden="true" />
        </IconButton>
        {open ? createPortal(
          <ActionMenu
            ariaLabel={menuLabel}
            className="toolbar-overflow-menu"
            menuRef={menuRef}
            style={style}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </ActionMenu>,
          document.body
        ) : null}
      </>
    );
  }
);

ToolbarOverflowMenu.displayName = "ToolbarOverflowMenu";
