import { useRef } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, DialogBody, DialogFooter, DialogHeader, ModalFrame } from "./ui";

interface SkillManagementMigrationDialogProps {
  busy: boolean;
  legacyMarkerCount: number;
  open: boolean;
  onDismiss(): void;
  onReview(): void;
}

export const SkillManagementMigrationDialog = ({
  busy,
  legacyMarkerCount,
  open,
  onDismiss,
  onReview
}: SkillManagementMigrationDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: continueRef,
    dismissDisabled: busy,
    onDismiss
  });

  if (!open) return null;
  return (
    <ModalFrame
      ariaLabel={t("Upgrade Skill management")}
      className="skill-management-migration-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onDismiss}
    >
      <DialogHeader
        title={t("Upgrade Skill management")}
        description={t("Move legacy ownership records into AgentEnv's private data and remove old marker files through the existing backup workflow.")}
      />
      <DialogBody>
        <p className="ui-dialog-description">
          {t("{{count}} legacy ownership files need review.", { count: legacyMarkerCount })}
        </p>
        <p className="muted ui-dialog-description">
          {t("This upgrade does not change Skill content, timestamps, or whether an existing install is a link or copy. Your current deployment preference is preserved.")}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button disabled={busy} onClick={onDismiss}>{t("Not now")}</Button>
        <Button
          ref={continueRef}
          busy={busy}
          disabled={busy}
          variant="primary"
          onClick={onReview}
        >
          {t("Review local Skills")}
        </Button>
      </DialogFooter>
    </ModalFrame>
  );
};
