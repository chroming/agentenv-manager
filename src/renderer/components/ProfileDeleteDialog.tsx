import type { RefObject } from "react";
import { useI18n } from "../i18n";
import { Button } from "./ui";

interface ProfileDeleteDialogProps {
  open: boolean;
  busy: boolean;
  active: boolean;
  profileName: string;
  activeTargetNames: string[];
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onDelete(): void;
  onOpenAgents(): void;
}

export const ProfileDeleteDialog = ({
  open,
  busy,
  active,
  profileName,
  activeTargetNames,
  dialogRef,
  initialFocusRef,
  onClose,
  onDelete,
  onOpenAgents
}: ProfileDeleteDialogProps) => {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div
      className="preview-modal-backdrop"
      data-dismiss-policy="standard"
      onClick={busy ? undefined : onClose}
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog profile-form-dialog--compact"
        role="dialog"
        aria-label={t("Delete Profile")}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">
              {t("Delete Profile")}
            </div>
            <p className="muted ui-dialog-description">
              {active
                ? t(
                    "{{name}} is active on {{targets}}. Apply another Profile or stop managing each Agent before removing it.",
                    {
                      name: profileName,
                      targets: activeTargetNames.join(", ")
                    }
                  )
                : t(
                    "Remove {{name}}? Applied Agent files and backups are not removed.",
                    { name: profileName }
                  )}
            </p>
          </div>
        </header>
        <footer className="preview-actions">
          <Button
            ref={initialFocusRef}
            disabled={busy}
            onClick={onClose}
          >
            {t("Cancel")}
          </Button>
          {active ? (
            <Button
              variant="primary"
              onClick={onOpenAgents}
            >
              {t("Open Agents")}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy}
              onClick={onDelete}
            >
              {t("Remove Profile")}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
};
