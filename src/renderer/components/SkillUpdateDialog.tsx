import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
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
  onConfirm(plan: SkillUpdatePlan): void;
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

  const planImpact = plan.impact ?? {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  };
  const impactSummary = impact ?? (() => {
    const parts: string[] = [];
    if (planImpact.profileNames.length > 0) {
      parts.push(t("Used by {{count}} Profiles", { count: planImpact.profileNames.length }));
    }
    if (planImpact.linkedInstallCount > 0) {
      parts.push(t("{{count}} linked Agent installs change immediately", {
        count: planImpact.linkedInstallCount
      }));
    }
    if (planImpact.copiedInstallCount > 0) {
      parts.push(t("{{count}} copied Agent installs update with this Library change", {
        count: planImpact.copiedInstallCount
      }));
    }
    return parts.length > 0
      ? parts.join(" · ")
      : t("No Profiles or managed Agent installs currently use this Skill");
  })();

  return (
    <ModalFrame
      ariaLabel={t("Update preview for {{id}}", { id: plan.id })}
      className="skill-update-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onClose}
    >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">{t("Update {{name}}", { name: plan.name })}</div>
            <p className="muted ui-dialog-description">
              {t("{{count}} file changes", { count: plan.changes.length })}
              {plan.latestRevision
                ? ` · ${(plan.currentRevision ?? "current").slice(0, 7)} → ${plan.latestRevision.slice(0, 7)}`
                : ""}
            </p>
            <p className="skill-update-impact">{impactSummary}</p>
          </div>
        </header>
        <div className="update-change-list ui-dialog-body">
          {plan.changes.map((change) => (
            <details key={change.path} open>
              <summary>{change.path}</summary>
              <DiffViewer path={change.path} diff={change.diff} />
            </details>
          ))}
        </div>
        <footer className="preview-actions ui-dialog-footer">
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
            aria-busy={busy}
            disabled={busy}
            icon={busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : undefined}
            size="prominent"
            variant="primary"
            onClick={() => onConfirm(plan)}
          >
            {t(busy ? "Updating..." : "Update skill")}
          </Button>
        </footer>
    </ModalFrame>
  );
};
