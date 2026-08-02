import { type RefObject, useLayoutEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

interface ModalDialogOptions {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onDismiss(): void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  dismissDisabled?: boolean;
  focusKey?: string;
}

export const useModalDialog = ({
  open,
  dialogRef,
  onDismiss,
  initialFocusRef,
  fallbackFocusRef,
  dismissDisabled = false,
  focusKey = "default"
}: ModalDialogOptions) => {
  const onDismissRef = useRef(onDismiss);
  const dismissDisabledRef = useRef(dismissDisabled);
  onDismissRef.current = onDismiss;
  dismissDisabledRef.current = dismissDisabled;

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const invokingControl =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialControl = initialFocusRef?.current;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialControl ?? firstControl ?? dialogRef.current)?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      const modalDialogs = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-modal="true"]'
      );
      if (!dialog || modalDialogs.item(modalDialogs.length - 1) !== dialog) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!dismissDisabledRef.current) {
          onDismissRef.current();
        }
        return;
      }

      const focusableControls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      const firstControl = focusableControls[0];
      const lastControl = focusableControls.at(-1);
      if (!firstControl || !lastControl) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (!focusableControls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? lastControl : firstControl).focus();
      } else if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const fallbackControl = fallbackFocusRef?.current;
      const returnTarget = fallbackControl?.isConnected ? fallbackControl : invokingControl;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
      if (fallbackFocusRef) {
        fallbackFocusRef.current = null;
      }
    };
  }, [dialogRef, fallbackFocusRef, focusKey, initialFocusRef, open]);
};
