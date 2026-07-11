import type { MouseEvent, ReactNode, RefObject } from "react";

interface ModalFrameProps {
  ariaLabel: string;
  backdropClassName?: string;
  children: ReactNode;
  className?: string;
  dialogRef?: RefObject<HTMLElement | null>;
  dismissDisabled?: boolean;
  onDismiss(): void;
}

export const ModalFrame = ({
  ariaLabel,
  backdropClassName = "",
  children,
  className = "",
  dialogRef,
  dismissDisabled = false,
  onDismiss
}: ModalFrameProps) => {
  const stopPropagation = (event: MouseEvent<HTMLElement>) => event.stopPropagation();

  return (
    <div
      className={`preview-modal-backdrop ui-modal-backdrop ${backdropClassName}`.trim()}
      onClick={dismissDisabled ? undefined : onDismiss}
    >
      <section
        ref={dialogRef}
        className={`profile-form-dialog ui-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={stopPropagation}
      >
        {children}
      </section>
    </div>
  );
};
