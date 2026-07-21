import type { MouseEvent, ReactNode, RefObject } from "react";

interface ModalFrameProps {
  ariaLabel: string;
  backdropClassName?: string;
  children: ReactNode;
  className?: string;
  dialogRef?: RefObject<HTMLElement | null>;
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
  dismissDisabled = false,
  onDismiss,
  suspended = false
}: ModalFrameProps) => {
  const stopPropagation = (event: MouseEvent<HTMLElement>) => event.stopPropagation();

  return (
    <div
      className={`preview-modal-backdrop ui-modal-backdrop${suspended ? " is-suspended" : ""} ${backdropClassName}`.trim()}
      onClick={dismissDisabled || suspended ? undefined : onDismiss}
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
    </div>
  );
};
