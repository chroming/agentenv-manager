import type { KeyboardEvent } from "react";

const actionMenuItemSelector = '[role^="menuitem"]:not(:disabled)';

export const focusInitialActionMenuItem = (
  menu: HTMLElement | null,
  preferredSelector?: string
) => {
  const preferred = preferredSelector
    ? menu?.querySelector<HTMLElement>(preferredSelector)
    : undefined;
  const fallback = menu?.querySelector<HTMLElement>(actionMenuItemSelector);
  (preferred ?? fallback)?.focus({ preventScroll: true });
};

export const handleActionMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(actionMenuItemSelector)
  );
  if (items.length === 0) return;

  const eventItem = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>(actionMenuItemSelector)
    : null;
  const currentIndex = items.findIndex(
    (item) => item === document.activeElement || item === eventItem
  );
  let nextIndex: number | undefined;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  }

  if (nextIndex === undefined) return;
  event.preventDefault();
  items[nextIndex]?.focus();
};
