import type { MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

export type ModalDismissPolicy = "standard" | "intentional";

interface ModalFrameProps {
  ariaLabel: string;
  backdropClassName?: string;
  children: ReactNode;
  className?: string;
  dialogRef?: RefObject<HTMLElement | null>;
  dismissPolicy?: ModalDismissPolicy;
  dismissDisabled?: boolean;
  onDismiss(): void;
  suspended?: boolean;
}

export const ModalFrame = ({
  ariaLabel,
  backdropClassName = "",
  children,
  className = "",
  dialogRef,
  dismissPolicy = "standard",
  dismissDisabled = false,
  onDismiss,
  suspended = false
}: ModalFrameProps) => {
  const stopPropagation = (event: MouseEvent<HTMLElement>) => event.stopPropagation();

  return createPortal(
    <div
      className={`preview-modal-backdrop ui-modal-backdrop${suspended ? " is-suspended" : ""} ${backdropClassName}`.trim()}
      data-dismiss-policy={dismissPolicy}
      onClick={
        dismissDisabled || suspended || dismissPolicy === "intentional"
          ? undefined
          : onDismiss
      }
    >
      <section
        ref={dialogRef}
        className={`profile-form-dialog ui-modal ${className}`.trim()}
        role="dialog"
        aria-hidden={suspended || undefined}
        aria-modal={suspended ? undefined : "true"}
        aria-label={ariaLabel}
        inert={suspended}
        onClick={stopPropagation}
      >
        {children}
      </section>
    </div>,
    document.body
  );
};
