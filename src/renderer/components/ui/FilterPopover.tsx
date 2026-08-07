import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

interface FilterPopoverProps {
  activeCount?: number;
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  label: string;
}

export const FilterPopover = ({
  activeCount = 0,
  children,
  className = "",
  icon,
  label
}: FilterPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerLabel = activeCount > 0 ? `${label}, ${activeCount} active` : label;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(288, window.innerWidth - 24);
    setStyle({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 160),
      width
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const dismissForViewportChange = () => close();
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [open]);

  return (
    <span className={`ui-filter-popover${activeCount > 0 ? " has-active-filters" : ""}${className ? ` ${className}` : ""}`}>
      <IconButton
        ref={triggerRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="ui-filter-popover__trigger"
        label={triggerLabel}
        onClick={() => open ? close() : show()}
      >
        {icon}
      </IconButton>
      {activeCount > 0 ? <span className="ui-filter-popover__indicator" aria-hidden="true" /> : null}
      {open && style ? createPortal(
        <div
          aria-label={label}
          className="ui-filter-popover__panel"
          id={panelId}
          ref={panelRef}
          role="dialog"
          style={style}
        >
          {children}
        </div>,
        document.body
      ) : null}
    </span>
  );
};
