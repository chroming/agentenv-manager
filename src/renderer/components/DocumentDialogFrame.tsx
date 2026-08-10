import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useI18n } from "../i18n";
import {
  DialogHeader,
  IconButton,
  ModalFrame,
  type ModalDismissPolicy
} from "./ui";

interface DocumentDialogFrameProps {
  ariaLabel: string;
  backdropClassName?: string;
  children: ReactNode;
  className?: string;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  description?: ReactNode;
  dialogRef?: RefObject<HTMLElement | null>;
  dismissDisabled?: boolean;
  dismissPolicy?: ModalDismissPolicy;
  resetKey: string;
  suspended?: boolean;
  title: ReactNode;
  onClose(): void;
}

export const DocumentDialogFrame = ({
  ariaLabel,
  backdropClassName,
  children,
  className = "",
  closeButtonRef,
  description,
  dialogRef,
  dismissDisabled = false,
  dismissPolicy = "standard",
  resetKey,
  suspended = false,
  title,
  onClose
}: DocumentDialogFrameProps) => {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => setMaximized(false), [resetKey]);

  return (
    <ModalFrame
      ariaLabel={ariaLabel}
      backdropClassName={backdropClassName}
      className={`document-dialog ${className}${maximized ? " is-maximized" : ""}`.trim()}
      dialogRef={dialogRef}
      dismissDisabled={dismissDisabled}
      dismissPolicy={dismissPolicy}
      onDismiss={onClose}
      suspended={suspended}
    >
      <DialogHeader
        title={title}
        description={description}
        actions={(
          <>
            <IconButton
              disabled={dismissDisabled}
              label={t(maximized ? "Restore preview size" : "Maximize preview")}
              variant="ghost"
              onClick={() => setMaximized((current) => !current)}
            >
              {maximized
                ? <Minimize2 size={16} strokeWidth={2.2} />
                : <Maximize2 size={16} strokeWidth={2.2} />}
            </IconButton>
            <IconButton
              ref={closeButtonRef}
              disabled={dismissDisabled}
              label={t("Close")}
              variant="ghost"
              onClick={onClose}
            >
              <X size={16} strokeWidth={2.2} />
            </IconButton>
          </>
        )}
      />
      {children}
    </ModalFrame>
  );
};
