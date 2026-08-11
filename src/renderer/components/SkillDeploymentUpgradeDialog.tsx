import { useLayoutEffect, useRef, useState } from "react";
import type { SkillSyncMethod } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ChoiceInput, DialogBody, DialogFooter, DialogHeader, ModalFrame } from "./ui";

interface SkillDeploymentUpgradeDialogProps {
  busy: boolean;
  currentMethod: SkillSyncMethod;
  linkedInstallCount: number;
  open: boolean;
  onDismiss(): void;
  onDecide(method: "copy" | "symlink"): Promise<void>;
}

export const SkillDeploymentUpgradeDialog = ({
  busy,
  currentMethod,
  linkedInstallCount,
  open,
  onDismiss,
  onDecide
}: SkillDeploymentUpgradeDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [method, setMethod] = useState<"copy" | "symlink">(
    currentMethod === "symlink" ? "symlink" : "copy"
  );

  useLayoutEffect(() => {
    if (open) setMethod(currentMethod === "symlink" ? "symlink" : "copy");
  }, [currentMethod, open]);

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
      ariaLabel={t("Choose Skill deployment")}
      className="skill-deployment-upgrade-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onDismiss}
    >
      <DialogHeader
        title={t("Choose how AgentEnv installs Skills")}
        description={t("AgentEnv now recommends ordinary managed copies so Library updates cannot change an Agent before Preview and Apply.")}
      />
      <DialogBody>
        <div className="ui-choice-list">
          <label className={`ui-choice-card${method === "copy" ? " is-selected" : ""}`}>
            <ChoiceInput
              checked={method === "copy"}
              name="skill-deployment-upgrade"
              type="radio"
              onChange={() => setMethod("copy")}
            />
            <span>
              <strong>{t("Managed copy (recommended)")}</strong>
              <small>{t("Future Apply operations install ordinary folders. Library updates wait for confirmation.")}</small>
            </span>
          </label>
          <label className={`ui-choice-card${method === "symlink" ? " is-selected" : ""}`}>
            <ChoiceInput
              checked={method === "symlink"}
              name="skill-deployment-upgrade"
              type="radio"
              onChange={() => setMethod("symlink")}
            />
            <span>
              <strong>{t("Live link (advanced)")}</strong>
              <small>{t("Library updates immediately change linked Agent Skills without another Apply preview.")}</small>
            </span>
          </label>
        </div>
        <p className="muted ui-dialog-description">
          {linkedInstallCount > 0
            ? t("{{count}} existing live links stay unchanged now. Choosing Managed copy converts them only when you next Preview and Apply the affected Profiles.", { count: linkedInstallCount })
            : t("No existing live links were detected. This choice controls future Profile Apply operations.")}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button disabled={busy} onClick={onDismiss}>{t("Not now")}</Button>
        <Button
          ref={continueRef}
          busy={busy}
          disabled={busy}
          variant="primary"
          onClick={() => void onDecide(method)}
        >
          {t("Use this deployment")}
        </Button>
      </DialogFooter>
    </ModalFrame>
  );
};
