import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { Check, ChevronDown, GripVertical, Search } from "lucide-react";
import { reorderPreferenceByDrop, reorderPreferenceByOffset } from "../../../shared/uiState";
import { useI18n } from "../../i18n";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
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
  onContextMenu?(event: ReactMouseEvent<HTMLElement>): void;
}

interface ObjectSwitcherProps {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
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
  fullWidth?: boolean;
  showTriggerIcon?: boolean;
  showTriggerTitle?: boolean;
  showTriggerDescription?: boolean;
  triggerVariant?: "default" | "icon" | "inline";
  onOpenChange(open: boolean): void;
  onQueryChange(query: string): void;
  onReorder?(ids: string[]): void;
  onSelect(id: string): void;
}

export const ObjectSwitcher = ({
  ariaLabel,
  className = "",
  disabled = false,
  emptyMessage,
  footerAction,
  items,
  open,
  query,
  searchInputRef,
  searchLabel,
  searchPlaceholder,
  selectedId,
  fullWidth = false,
  showTriggerIcon = true,
  showTriggerTitle = true,
  showTriggerDescription = true,
  triggerVariant = "default",
  onOpenChange,
  onQueryChange,
  onReorder,
  onSelect
}: ObjectSwitcherProps) => {
  const { t } = useI18n();
  const Root = triggerVariant === "inline" ? "span" : "div";
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fallbackSearchRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 320 });
  const [dragState, setDragState] = useState<{
    id: string;
    overId?: string;
    edge?: "before" | "after";
  }>();
  const selected = items.find((item) => item.id === selectedId);
  const hasTriggerIcon = Boolean(showTriggerIcon && selected?.icon);
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
  const canReorder = Boolean(onReorder && !normalizedQuery && items.length > 1);

  const reorder = (draggedId: string, targetId: string) => {
    if (!canReorder || draggedId === targetId) return;
    const ids = items.map((item) => item.id);
    onReorder?.(reorderPreferenceByDrop(ids, draggedId, targetId));
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>, targetId: string) => {
    if (!dragState || !canReorder || targetId === dragState.id) return;
    event.preventDefault();
    const draggedIndex = items.findIndex((item) => item.id === dragState.id);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    const edge = targetIndex > draggedIndex ? "after" : "before";
    event.dataTransfer.dropEffect = "move";
    setDragState((current) => current ? { ...current, overId: targetId, edge } : current);
  };

  const handleReorderKey = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!canReorder || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const index = items.findIndex((item) => item.id === id);
    const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    event.preventDefault();
    onReorder?.(reorderPreferenceByOffset(
      items.map((item) => item.id),
      id,
      event.key === "ArrowUp" ? -1 : 1
    ));
  };

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
    <Root
      className={`ui-object-switcher${fullWidth ? " ui-object-switcher--full-width" : ""}${
        triggerVariant === "icon"
          ? " ui-object-switcher--icon-trigger"
          : triggerVariant === "inline"
            ? " ui-object-switcher--inline-trigger"
            : ""
      }${hasTriggerIcon ? " ui-object-switcher--with-icon" : ""} ${className}`.trim()}
    >
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="ui-object-switcher__trigger"
        disabled={disabled}
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
        {hasTriggerIcon ? (
          <span className="ui-object-switcher__trigger-icon" aria-hidden="true">{selected?.icon}</span>
        ) : null}
        {showTriggerTitle ? (
          <span className="ui-object-switcher__trigger-copy">
            <span className="ui-object-switcher__trigger-title">{selected?.title ?? ariaLabel}</span>
            {showTriggerDescription && selected?.description ? (
              <span className="ui-object-switcher__trigger-description">{selected.description}</span>
            ) : null}
          </span>
        ) : null}
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
                as="div"
                aria-label={item.ariaLabel}
                aria-selected={item.id === selectedId}
                className={`ui-object-switcher__row${
                  dragState?.id === item.id ? " is-dragging" : ""
                }${dragState?.overId === item.id ? ` is-drop-${dragState.edge}` : ""}`}
                description={item.description}
                disabled={item.disabled}
                icon={item.icon}
                key={item.id}
                role="option"
                selected={item.id === selectedId}
                status={item.id === selectedId ? <Check size={15} strokeWidth={2.4} /> : item.status}
                trailingAction={canReorder && !item.disabled ? (
                  <IconButton
                    className="ui-object-switcher__drag-handle"
                    draggable
                    label={t("Reorder")}
                    size="compact"
                    variant="ghost"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDragEnd={(event) => {
                      event.stopPropagation();
                      setDragState(undefined);
                    }}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                      setDragState({ id: item.id });
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      handleReorderKey(event, item.id);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                ) : undefined}
                title={item.title}
                tooltip={item.tooltip}
                onContextMenu={item.onContextMenu}
                onDragOver={(event) => handleDragOver(event, item.id)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragState?.overId === item.id && dragState.edge) {
                    reorder(dragState.id, item.id);
                  }
                  setDragState(undefined);
                }}
                onClick={(event) => {
                  const selection = window.getSelection();
                  if (selection && !selection.isCollapsed && selection.toString()) {
                    event.preventDefault();
                  }
                }}
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
    </Root>
  );
};
