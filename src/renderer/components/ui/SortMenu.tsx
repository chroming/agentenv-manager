import { ArrowUpDown, Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ActionMenu, ActionMenuItem } from "./ActionMenu";
import { IconButton } from "./IconButton";

interface SortMenuProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  active?: boolean;
  onChange(value: T): void;
}

export const SortMenu = <T extends string>({
  label, value, options, active = false, onChange
}: SortMenuProps<T>) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const currentLabel = options.find((option) => option.value === value)?.label ?? options[0]?.label;
  const triggerLabel = `${label}: ${currentLabel}`;
  const inModal = Boolean(triggerRef.current?.closest('[aria-modal="true"]'));

  useLayoutEffect(() => {
    if (!open) return;
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(220, window.innerWidth - 24);
    const height = menuRef.current?.getBoundingClientRect().height ?? 48;
    setStyle({
      width,
      left: Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12)),
      top: box.bottom + 6 + height <= window.innerHeight - 12
        ? box.bottom + 6 : Math.max(12, box.top - height - 6)
    });
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) &&
          !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const dismissForViewportChange = () => setOpen(false);
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

  return <>
    <IconButton ref={triggerRef} variant="ghost" active={active} label={triggerLabel}
      title={triggerLabel} aria-haspopup="menu" aria-expanded={open} aria-pressed={active}
      onClick={() => setOpen((current) => !current)}>
      <ArrowUpDown size={15} aria-hidden="true" />
    </IconButton>
    {open ? createPortal(<ActionMenu ariaLabel={label} menuRef={menuRef} style={style}
      className={`ui-sort-menu${inModal ? " ui-sort-menu--modal" : ""}`}>
      {options.map((option) => <ActionMenuItem key={option.value} role="menuitemradio"
        aria-checked={option.value === value} onClick={() => {
          onChange(option.value);
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }}>
        <span>{option.label}</span>
        <Check size={14} aria-hidden="true" style={{ visibility: option.value === value ? "visible" : "hidden" }} />
      </ActionMenuItem>)}
    </ActionMenu>, document.body) : null}
  </>;
};
