import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionMenu, ActionMenuItem } from "./ActionMenu";
import { focusInitialActionMenuItem } from "./actionMenuKeyboard";

export interface ContextMenuAnchor { x: number; y: number; returnFocus: HTMLElement }
export function ContextMenu({ label, anchor, items, onClose }: {
  label: string; anchor: ContextMenuAnchor;
  items: Array<{ id: string; label: string; icon?: ReactNode; danger?: boolean; onSelect(): void }>;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu) {
      const box = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - box.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - box.height - 8))}px`;
      focusInitialActionMenuItem(menu);
    }
    const dismiss = () => closeRef.current();
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) dismiss(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); anchor.returnFocus.focus({ preventScroll: true }); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", keyboard, true);
    window.addEventListener("scroll", dismiss, true); window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", keyboard, true); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); };
  }, [anchor, label]);
  return createPortal(<ActionMenu ariaLabel={label} menuRef={ref} className={`toolbar-overflow-menu${anchor.returnFocus.closest('[aria-modal="true"]') ? " toolbar-overflow-menu--modal" : ""}`}
    style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 220 }}>
    {items.map((item) => <ActionMenuItem key={item.id} tone={item.danger ? "danger" : "default"} onClick={() => { onClose(); item.onSelect(); }}>{item.icon}<span>{item.label}</span></ActionMenuItem>)}
  </ActionMenu>, document.body);
}
