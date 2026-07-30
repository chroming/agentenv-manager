import { useRef } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  LoaderCircle,
  TriangleAlert,
  XCircle
} from "lucide-react";
import { createPortal } from "react-dom";
import type {
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult
} from "../../shared/types";
import type { SkillUpdateRun } from "../skillUpdateQueue";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { Button } from "./ui";

interface BulkSkillUpdateDialogProps {
  plans: SkillUpdatePlan[];
  failures: SkillUpdatePreviewBatchResult["failed"];
  updateRun: SkillUpdateRun;
  isBusy: boolean;
  previewingAllUpdates: boolean;
  updateActivityBusy: boolean;
  onClose(): void;
  onPreview(ids: string[]): void;
  onUpdate(plans: SkillUpdatePlan[]): void;
}

export const BulkSkillUpdateDialog = ({
  plans,
  failures,
  updateRun,
  isBusy,
  previewingAllUpdates,
  updateActivityBusy,
  onClose,
  onPreview,
  onUpdate
}: BulkSkillUpdateDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const applicablePlans = plans.filter(
    (plan) => plan.changes.length > 0 && plan.errors.length === 0
  );
  const started = applicablePlans.some((plan) => updateRun[plan.id]);
  const running = applicablePlans.some((plan) => {
    const status = updateRun[plan.id]?.status;
    return status === "queued" || status === "updating";
  });
  const completedCount = applicablePlans.filter((plan) => {
    const status = updateRun[plan.id]?.status;
    return status === "updated" || status === "failed";
  }).length;
  const failedPlans = applicablePlans.filter(
    (plan) => updateRun[plan.id]?.status === "failed"
  );
  const finished =
    started &&
    !running &&
    completedCount === applicablePlans.length;
  const dismissDisabled = isBusy || previewingAllUpdates || running;

  useModalDialog({
    open: true,
    dialogRef,
    initialFocusRef,
    dismissDisabled,
    onDismiss: onClose
  });

  return createPortal(
    <div
      className="preview-modal-backdrop"
      data-dismiss-policy="standard"
      onClick={dismissDisabled ? undefined : onClose}
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog bulk-update-dialog ui-dialog-shell"
        role="dialog"
        aria-label={t("Update all skills")}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">{t("Update all skills")}</div>
            <p className="muted ui-dialog-description">
              {t("Review every tracked change before updating the shared library.")}
            </p>
          </div>
        </header>
        <div className="bulk-update-list ui-dialog-body">
          {failures.length > 0 ? (
            <section className="bulk-update-failures" aria-label={t("Preview failures")}>
              <div className="bulk-update-failures__heading">
                <TriangleAlert size={15} aria-hidden="true" />
                <strong>
                  {t("{{count}} update previews could not be prepared", {
                    count: failures.length
                  })}
                </strong>
              </div>
              {failures.map((failure) => (
                <div className="bulk-update-failure" key={failure.id}>
                  <strong>{failure.id}</strong>
                  <PreviewText
                    className="bulk-update-failure__error"
                    text={failure.error}
                  />
                </div>
              ))}
            </section>
          ) : null}
          {plans.map((plan) => {
            const progress = updateRun[plan.id];
            const progressLabel = progress?.status === "queued"
              ? t("Waiting")
              : progress?.status === "updating"
                ? t("Updating...")
                : progress?.status === "updated"
                  ? t("Done")
                  : progress?.status === "failed"
                    ? t("Failed")
                    : undefined;
            return (
              <details
                key={plan.id}
                open={plan.errors.length > 0 || progress?.status === "failed"}
              >
                <summary>
                  <span className="bulk-update-summary-identity">
                    <ChevronDown
                      className="bulk-update-disclosure"
                      size={15}
                      strokeWidth={2.2}
                    />
                    <strong>{plan.name}</strong>
                  </span>
                  <span className="bulk-update-summary-meta">
                    <span>
                      {plan.errors.length > 0
                        ? t("Blocked")
                        : t("{{count}} file changes", { count: plan.changes.length })}
                    </span>
                    {progress && progressLabel ? (
                      <span
                        className={`bulk-update-progress bulk-update-progress--${progress.status}`}
                        role="status"
                        aria-label={t("{{name}}: {{status}}", {
                          name: plan.name,
                          status: progressLabel
                        })}
                      >
                        {progress.status === "queued" ? (
                          <Circle size={13} aria-hidden="true" />
                        ) : progress.status === "updating" ? (
                          <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
                        ) : progress.status === "updated" ? (
                          <CheckCircle2 size={13} aria-hidden="true" />
                        ) : (
                          <XCircle size={13} aria-hidden="true" />
                        )}
                        {progressLabel}
                      </span>
                    ) : null}
                  </span>
                </summary>
                {plan.impact ? (
                  <p className="skill-update-impact">
                    {t("{{profiles}} Profiles · {{linked}} linked installs update now · {{copied}} copied installs update in this transaction", {
                      profiles: plan.impact.profileNames.length,
                      linked: plan.impact.linkedInstallCount,
                      copied: plan.impact.copiedInstallCount
                    })}
                  </p>
                ) : null}
                {plan.errors.map((error) => <p className="error" key={error}>{error}</p>)}
                {progress?.error ? (
                  <div className="bulk-update-run-error">
                    <PreviewText
                      className="bulk-update-run-error__message"
                      text={progress.error}
                    />
                    <Button
                      disabled={isBusy || running}
                      size="compact"
                      onClick={() => onUpdate([plan])}
                    >
                      {t("Retry")}
                    </Button>
                  </div>
                ) : null}
                {plan.changes.map((change) => <code key={change.path}>{change.path}</code>)}
              </details>
            );
          })}
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <button
            ref={initialFocusRef}
            className="secondary-action"
            type="button"
            disabled={dismissDisabled}
            onClick={onClose}
          >
            {t(started ? "Close" : "Cancel")}
          </button>
          {failures.length > 0 ? (
            <button
              className="secondary-action"
              type="button"
              disabled={isBusy || previewingAllUpdates || running}
              onClick={() => onPreview([
                ...plans.map((plan) => plan.id),
                ...failures.map((failure) => failure.id)
              ])}
            >
              {previewingAllUpdates ? (
                <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
              ) : null}
              {t(isBusy ? "Preparing..." : "Retry failed previews")}
            </button>
          ) : null}
          {finished && failedPlans.length > 0 ? (
            <button
              className="secondary-action"
              type="button"
              disabled={isBusy}
              onClick={() => onUpdate(failedPlans)}
            >
              {t("Retry failed updates")}
            </button>
          ) : null}
          {!finished ? (
            <button
              className="primary-action"
              type="button"
              aria-busy={running}
              disabled={
                isBusy ||
                updateActivityBusy ||
                applicablePlans.length === 0 ||
                running
              }
              onClick={() => onUpdate(applicablePlans)}
            >
              {running ? (
                <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
              ) : null}
              {running
                ? t("Updating {{completed}} of {{total}}", {
                    completed: completedCount,
                    total: applicablePlans.length
                  })
                : t(
                    applicablePlans.length === 1
                      ? "Update {{count}} skill"
                      : "Update {{count}} skills",
                    { count: applicablePlans.length }
                  )}
            </button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body
  );
};
