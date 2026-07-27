import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import type { PlannedFileChange, SkillUpdatePlan } from "../../shared/types";
import type { SkillUpdateRunItem } from "../skillUpdateQueue";
import { useModalDialog } from "../hooks/useModalDialog";
import { DiffViewer } from "./DiffViewer";
import { Button, ModalFrame } from "./ui";
import { useI18n } from "../i18n";

interface SkillUpdateDialogProps {
  plan?: SkillUpdatePlan;
  impact?: string;
  busy?: boolean;
  progress?: SkillUpdateRunItem;
  onClose(): void;
  onConfirm(plan: SkillUpdatePlan): void;
}

const SkillUpdateChange = ({
  change,
  initiallyOpen
}: {
  change: PlannedFileChange;
  initiallyOpen: boolean;
}) => {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{change.path}</summary>
      {open ? <DiffViewer path={change.path} diff={change.diff} /> : null}
    </details>
  );
};

export const SkillUpdateDialog = ({
  plan,
  impact,
  busy = false,
  progress,
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
  const progressLabel = progress?.status === "queued"
    ? t("Waiting")
    : progress?.status === "updating"
      ? t("Updating...")
      : progress?.status === "updated"
        ? t("Done")
        : progress?.status === "failed"
          ? t("Failed")
          : undefined;
  const running = progress?.status === "queued" || progress?.status === "updating";
  const finished = progress?.status === "updated" || progress?.status === "failed";

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
            {progressLabel ? (
              <div
                className={`skill-update-progress skill-update-progress--${progress!.status}`}
                role="status"
                aria-label={t("{{name}}: {{status}}", {
                  name: plan.name,
                  status: progressLabel
                })}
              >
                {progress!.status === "queued" ? (
                  <Clock3 size={15} aria-hidden="true" />
                ) : progress!.status === "updating" ? (
                  <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                ) : progress!.status === "updated" ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
                <span>
                  <strong>{progressLabel}</strong>
                  {progress?.error ? <small>{progress.error}</small> : null}
                </span>
              </div>
            ) : null}
          </div>
        </header>
        <div className="update-change-list ui-dialog-body">
          {plan.changes.map((change, index) => (
            <SkillUpdateChange
              change={change}
              initiallyOpen={index === 0}
              key={change.path}
            />
          ))}
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <Button
            ref={initialFocusRef}
            disabled={running || (busy && !finished)}
            size="prominent"
            onClick={onClose}
          >
            {t(finished ? "Close" : "Cancel")}
          </Button>
          {progress?.status !== "updated" ? (
            <Button
              aria-label={t(
                running
                  ? "Updating {{id}}"
                  : progress?.status === "failed"
                    ? "Retry update {{id}}"
                    : "Apply update {{id}}",
                { id: plan.id }
              )}
              aria-busy={running}
              disabled={running || (busy && progress?.status !== "failed")}
              icon={running
                ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                : undefined}
              size="prominent"
              variant="primary"
              onClick={() => onConfirm(plan)}
            >
              {t(
                running
                  ? "Updating..."
                  : progress?.status === "failed"
                    ? "Retry"
                    : "Update skill"
              )}
            </Button>
          ) : null}
        </footer>
    </ModalFrame>
  );
};
