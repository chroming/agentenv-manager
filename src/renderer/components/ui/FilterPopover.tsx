import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { FilterTrigger } from "./FilterTrigger";

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
  const inModal = Boolean(triggerRef.current?.closest('[aria-modal="true"]'));

  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 12) {
      setStyle((current) => ({ ...current, top: Math.max(12, window.innerHeight - rect.height - 12) }));
    }
  }, [open]);

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
      if (event.key === "Tab" && panelRef.current?.contains(document.activeElement)) {
        const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('select, input, button:not(:disabled)'));
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        event.stopImmediatePropagation();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    const dismissForViewportChange = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [open]);

  return (
    <span className={`ui-filter-popover${className ? ` ${className}` : ""}`}>
      <FilterTrigger
        activeCount={activeCount}
        ref={triggerRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        label={label}
        onClick={() => open ? close() : show()}
      >
        {icon}
      </FilterTrigger>
      {open && style ? createPortal(
        <div
          aria-label={label}
          className={`ui-filter-popover__panel${inModal ? " ui-filter-popover__panel--modal" : ""}`}
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
