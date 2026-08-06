import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "./Button";
import { SearchField } from "./FormFields";
import { SelectableListRow } from "./WorkspacePatterns";

export interface ObjectSwitcherItem {
  ariaLabel?: string;
  id: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  searchText?: string;
  status?: ReactNode;
  disabled?: boolean;
  tooltip?: string;
  onContextMenu?(event: ReactMouseEvent<HTMLButtonElement>): void;
}

interface ObjectSwitcherProps {
  ariaLabel: string;
  className?: string;
  emptyMessage?: ReactNode;
  footerAction?: {
    icon?: ReactNode;
    label: string;
    onClick(returnFocus: HTMLButtonElement | null): void;
  };
  items: ObjectSwitcherItem[];
  open: boolean;
  query: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchLabel: string;
  searchPlaceholder: string;
  selectedId?: string;
  onOpenChange(open: boolean): void;
  onQueryChange(query: string): void;
  onSelect(id: string): void;
}

export const ObjectSwitcher = ({
  ariaLabel,
  className = "",
  emptyMessage,
  footerAction,
  items,
  open,
  query,
  searchInputRef,
  searchLabel,
  searchPlaceholder,
  selectedId,
  onOpenChange,
  onQueryChange,
  onSelect
}: ObjectSwitcherProps) => {
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fallbackSearchRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 320 });
  const selected = items.find((item) => item.id === selectedId);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? items.filter((item) => {
        const fallbackText = [item.title, item.description]
          .filter((value): value is string | number =>
            typeof value === "string" || typeof value === "number"
          )
          .join(" ");
        return (item.searchText ?? fallbackText).toLowerCase().includes(normalizedQuery);
      })
    : items;
  const activeSearchRef = searchInputRef ?? fallbackSearchRef;

  const close = (restoreFocus = true) => {
    onOpenChange(false);
    if (query) onQueryChange("");
    if (restoreFocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    activeSearchRef.current?.focus();
    activeSearchRef.current?.select();
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const margin = 10;
    const gap = 6;
    const width = Math.min(340, Math.max(280, window.innerWidth - margin * 2));
    const measuredHeight = popoverRef.current?.getBoundingClientRect().height ?? 360;
    const left = Math.min(
      Math.max(margin, trigger.left),
      Math.max(margin, window.innerWidth - width - margin)
    );
    const below = trigger.bottom + gap;
    const top = below + measuredHeight <= window.innerHeight - margin
      ? below
      : Math.max(margin, trigger.top - measuredHeight - gap);
    setPosition({ left, top, width });
  }, [activeSearchRef, items.length, open, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const handleViewportChange = () => close(false);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [open, query]);

  return (
    <div className={`ui-object-switcher ${className}`.trim()}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="ui-object-switcher__trigger"
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        {selected?.icon ? (
          <span className="ui-object-switcher__trigger-icon" aria-hidden="true">{selected.icon}</span>
        ) : null}
        <span className="ui-object-switcher__trigger-copy">
          <span className="ui-object-switcher__trigger-title">{selected?.title ?? ariaLabel}</span>
          {selected?.description ? (
            <span className="ui-object-switcher__trigger-description">{selected.description}</span>
          ) : null}
        </span>
        <ChevronDown className={open ? "is-open" : ""} size={15} strokeWidth={2.1} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div
          aria-label={ariaLabel}
          className="ui-object-switcher__popover"
          ref={popoverRef}
          role="dialog"
          style={position}
        >
          <div className="ui-object-switcher__search">
            <SearchField
              ref={activeSearchRef}
              icon={<Search size={14} strokeWidth={2} />}
              label={searchLabel}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
          </div>
          <div
            aria-label={ariaLabel}
            className="ui-object-switcher__list"
            id={popoverId}
            role="listbox"
          >
            {visibleItems.length > 0 ? visibleItems.map((item) => (
              <SelectableListRow
                aria-label={item.ariaLabel}
                aria-selected={item.id === selectedId}
                className="ui-object-switcher__row"
                description={item.description}
                disabled={item.disabled}
                icon={item.icon}
                key={item.id}
                role="option"
                selected={item.id === selectedId}
                status={item.id === selectedId ? <Check size={15} strokeWidth={2.4} /> : item.status}
                title={item.title}
                tooltip={item.tooltip}
                onContextMenu={item.onContextMenu}
                onSelect={() => {
                  if (item.id !== selectedId) onSelect(item.id);
                  close();
                }}
              />
            )) : (
              <div className="ui-object-switcher__empty">{emptyMessage}</div>
            )}
          </div>
          {footerAction ? (
            <div className="ui-object-switcher__footer">
              <Button
                icon={footerAction.icon}
                variant="ghost"
                onClick={() => {
                  close(false);
                  footerAction.onClick(triggerRef.current);
                }}
              >
                {footerAction.label}
              </Button>
            </div>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
};
