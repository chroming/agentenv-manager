import { useRef } from "react";
import type { SkillUpdatePlan } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { DiffViewer } from "./DiffViewer";
import { Button, ModalFrame } from "./ui";
import { useI18n } from "../i18n";

interface SkillUpdateDialogProps {
  plan?: SkillUpdatePlan;
  impact?: string;
  busy?: boolean;
  onClose(): void;
  onConfirm(id: string): void;
}

export const SkillUpdateDialog = ({
  plan,
  impact,
  busy = false,
  onClose,
  onConfirm
}: SkillUpdateDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useModalDialog({
    open: Boolean(plan),
    dialogRef,
    initialFocusRef,
    onDismiss: onClose,
    dismissDisabled: busy,
    focusKey: plan?.id
  });

  if (!plan || plan.changes.length === 0) {
    return null;
  }

  return (
    <ModalFrame
      ariaLabel={t("Update preview for {{id}}", { id: plan.id })}
      className="skill-update-dialog"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onClose}
    >
        <header className="profile-dialog-header">
          <div>
            <div className="section-title">{t("Update {{name}}", { name: plan.name })}</div>
            <p className="muted">
              {t("{{count}} file changes", { count: plan.changes.length })}
              {plan.latestRevision
                ? ` · ${(plan.currentRevision ?? "current").slice(0, 7)} → ${plan.latestRevision.slice(0, 7)}`
                : ""}
            </p>
            {impact ? <p className="skill-update-impact">{impact}</p> : null}
          </div>
        </header>
        <div className="update-change-list">
          {plan.changes.map((change) => (
            <details key={change.path} open>
              <summary>{change.path}</summary>
              <DiffViewer path={change.path} diff={change.diff} />
            </details>
          ))}
        </div>
        <footer className="preview-actions">
          <Button
            ref={initialFocusRef}
            disabled={busy}
            size="prominent"
            onClick={onClose}
          >
            {t("Cancel")}
          </Button>
          <Button
            aria-label={t("Apply update {{id}}", { id: plan.id })}
            disabled={busy}
            size="prominent"
            variant="primary"
            onClick={() => onConfirm(plan.id)}
          >
            {t(busy ? "Updating..." : "Update skill")}
          </Button>
        </footer>
    </ModalFrame>
  );
};
